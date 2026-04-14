import JSZip from "jszip";
import { blobToArrayBuffer } from "../blob";
import { DATASET_FILE_NAME_COLUMN } from "../xlsx";
import type {
  DatasetDraft,
  GenerationResult,
  ImagePackEntry,
  ImageSlotOccurrence,
  Slot,
  TextLocator,
  TemplateVersionRecord,
  ValidationIssue,
} from "../../types";
import { normalizeFileName, normalizeToken, validateDataset } from "../validation";
import {
  findDescendants,
  getAttributeLocal,
  getElementChildren,
  hasLeadingOrTrailingWhitespace,
  localNameOf,
  parseXml,
  resolveElementPath,
  serializeXml,
} from "./xml";

const WORD_ML_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";

function contentTypeForExtension(extension: string) {
  switch (extension.toLowerCase()) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function extensionFromFileName(fileName: string) {
  const match = /\.([^.]+)$/.exec(fileName);
  return match?.[1]?.toLowerCase() ?? "png";
}

function replaceRange(source: string, start: number, end: number, replacement: string) {
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

function getInlineTextFromChild(child: Element) {
  const name = localNameOf(child);
  if (name === "t") {
    return child.textContent ?? "";
  }

  if (name === "tab") {
    return "\t";
  }

  if (name === "br" || name === "cr") {
    return "\n";
  }

  return "";
}

function getSegmentText(run: Element, childStart: number, childEnd: number) {
  return getElementChildren(run)
    .slice(childStart, childEnd + 1)
    .map(getInlineTextFromChild)
    .join("");
}

function replaceSegmentText(
  run: Element,
  locator: TextLocator,
  nextText: string,
) {
  const children = getElementChildren(run);
  const targetChildren = children.slice(locator.childStart, locator.childEnd + 1);
  const referenceNode = children[locator.childEnd + 1] ?? null;

  targetChildren.forEach((child) => {
    run.removeChild(child);
  });

  const textNode = run.ownerDocument.createElementNS(WORD_ML_NS, "w:t");
  if (hasLeadingOrTrailingWhitespace(nextText)) {
    textNode.setAttribute("xml:space", "preserve");
  }

  textNode.appendChild(run.ownerDocument.createTextNode(nextText));

  if (referenceNode) {
    run.insertBefore(textNode, referenceNode);
  } else {
    run.appendChild(textNode);
  }
}

function groupTextOccurrences(slots: Slot[], valueMap: Map<string, string>) {
  const groups = new Map<
    string,
    Array<{ locator: TextLocator; startOffset: number; endOffset: number; value: string }>
  >();

  slots
    .filter((slot) => slot.type === "text")
    .forEach((slot) => {
      const replacementValue = valueMap.get(slot.name) ?? slot.defaultValue ?? "";

      slot.occurrences.forEach((occurrence) => {
        if (occurrence.kind !== "textRange") {
          return;
        }

        const fragments = occurrence.fragments?.length
          ? occurrence.fragments.map((fragment, index) => ({
              locator: fragment.locator,
              startOffset: fragment.startOffset,
              endOffset: fragment.endOffset,
              value: index === 0 ? replacementValue : "",
            }))
          : [
              {
                locator: occurrence.locator,
                startOffset: occurrence.startOffset,
                endOffset: occurrence.endOffset,
                value: replacementValue,
              },
            ];

        fragments.forEach((fragment) => {
          const key = `${fragment.locator.path.join(".")}:${fragment.locator.childStart}:${fragment.locator.childEnd}`;
          const bucket = groups.get(key) ?? [];
          bucket.push(fragment);
          groups.set(key, bucket);
        });
      });
    });

  return groups;
}

function uniqueFileName(rawFileName: string, used: Map<string, number>) {
  const ext = rawFileName.toLowerCase().endsWith(".docx") ? "" : ".docx";
  const normalized = `${rawFileName}${ext}`;
  const counter = used.get(normalized) ?? 0;
  used.set(normalized, counter + 1);

  if (counter === 0) {
    return normalized;
  }

  return normalized.replace(/\.docx$/i, `-${counter + 1}.docx`);
}

function sanitizeFileName(value: string) {
  const sanitized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return sanitized || "generated";
}

function ensureContentType(contentTypesDocument: XMLDocument, extension: string, mimeType: string) {
  const root = contentTypesDocument.documentElement;
  const defaults = getElementChildren(root).filter((child) => localNameOf(child) === "Default");
  const exists = defaults.some(
    (child) => getAttributeLocal(child, "Extension").toLowerCase() === extension.toLowerCase(),
  );

  if (exists) {
    return;
  }

  const entry = contentTypesDocument.createElementNS(CONTENT_TYPES_NS, "Default");
  entry.setAttribute("Extension", extension);
  entry.setAttribute("ContentType", mimeType);
  root.appendChild(entry);
}

function buildValueMap(template: TemplateVersionRecord, dataset: DatasetDraft, rowIndex: number) {
  const map = new Map<string, string>();

  template.slots.forEach((slot) => {
    const columnIndex = dataset.columns.findIndex(
      (column) => normalizeToken(column) === normalizeToken(slot.name),
    );
    const rawValue = columnIndex === -1 ? "" : String(dataset.rows[rowIndex].cells[columnIndex] ?? "");
    const value = rawValue.trim() || slot.defaultValue?.trim() || "";
    map.set(slot.name, value);
  });

  return map;
}

function findImageEntry(entries: ImagePackEntry[], fileName: string) {
  const normalized = normalizeFileName(fileName);
  return entries.find((entry) => entry.normalizedName === normalized);
}

function fileNameForRow(templateName: string, dataset: DatasetDraft, rowIndex: number) {
  const columnIndex = dataset.columns.findIndex(
    (column) => normalizeToken(column) === DATASET_FILE_NAME_COLUMN,
  );
  const rawValue = columnIndex === -1 ? "" : String(dataset.rows[rowIndex].cells[columnIndex] ?? "");
  const baseName = rawValue.trim() || `${templateName}-${rowIndex + 1}`;
  return sanitizeFileName(baseName);
}

async function applyImageReplacement(
  zip: JSZip,
  relsDocument: XMLDocument,
  contentTypesDocument: XMLDocument,
  occurrence: ImageSlotOccurrence,
  image: ImagePackEntry,
  rowIndex: number,
) {
  const relationships = findDescendants(relsDocument, "Relationship");
  const relationship = relationships.find(
    (candidate) => getAttributeLocal(candidate, "Id") === occurrence.locator.relId,
  );

  if (!relationship) {
    throw new Error(`找不到图片关系 ${occurrence.locator.relId}。`);
  }

  const extension = extensionFromFileName(image.name || occurrence.originalTarget);
  const mimeType = image.blob.type || image.mimeType || contentTypeForExtension(extension);
  const mediaFileName = `generated-${rowIndex + 1}-${occurrence.id}.${extension}`;
  const target = `media/${mediaFileName}`;
  zip.file(`word/${target}`, image.blob);
  relationship.setAttribute("Target", target);
  ensureContentType(contentTypesDocument, extension, mimeType);
}

async function buildRowDocument(
  sourceBuffer: ArrayBuffer,
  template: TemplateVersionRecord,
  dataset: DatasetDraft,
  rowIndex: number,
) {
  const zip = await JSZip.loadAsync(sourceBuffer.slice(0));
  const documentXml = await zip.file("word/document.xml")?.async("string");
  const relsXml = await zip.file("word/_rels/document.xml.rels")?.async("string");
  const contentTypesXml = await zip.file("[Content_Types].xml")?.async("string");

  if (!documentXml || !relsXml || !contentTypesXml) {
    throw new Error("模板文件缺少必要的 DOCX 结构。");
  }

  const document = parseXml(documentXml);
  const relsDocument = parseXml(relsXml);
  const contentTypesDocument = parseXml(contentTypesXml);
  const root = document.documentElement;
  const valueMap = buildValueMap(template, dataset, rowIndex);
  const textGroups = groupTextOccurrences(template.slots, valueMap);

  for (const bucket of textGroups.values()) {
    const [first] = bucket;
    const run = resolveElementPath(root, first.locator.path);
    if (!run) {
      throw new Error("找不到文本槽位的定位节点。");
    }

    const segmentText = getSegmentText(
      run,
      first.locator.childStart,
      first.locator.childEnd,
    );

    let nextText = segmentText;
    const sorted = [...bucket].sort((left, right) => right.startOffset - left.startOffset);

    sorted.forEach(({ startOffset, endOffset, value }) => {
      nextText = replaceRange(nextText, startOffset, endOffset, value);
    });

    replaceSegmentText(run, first.locator, nextText);
  }

  for (const slot of template.slots.filter((candidate) => candidate.type === "image")) {
    const value = valueMap.get(slot.name) ?? "";
    if (!value) {
      continue;
    }

    const image = findImageEntry(dataset.imagePackEntries, value);
    if (!image) {
      throw new Error(`找不到图片槽位 "${slot.name}" 对应的图片资源：${value}`);
    }

    for (const occurrence of slot.occurrences) {
      if (occurrence.kind !== "imageNode") {
        continue;
      }

      await applyImageReplacement(zip, relsDocument, contentTypesDocument, occurrence, image, rowIndex);
    }
  }

  zip.file("word/document.xml", serializeXml(document));
  zip.file("word/_rels/document.xml.rels", serializeXml(relsDocument));
  zip.file("[Content_Types].xml", serializeXml(contentTypesDocument));

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

function structuralErrors(issues: ValidationIssue[]) {
  return issues.filter((issue) => issue.severity === "error" && issue.scope !== "row");
}

export async function generateDocuments(
  template: TemplateVersionRecord,
  dataset: DatasetDraft,
): Promise<GenerationResult> {
  const issues = validateDataset(template, dataset);
  const blockingIssues = structuralErrors(issues);

  if (blockingIssues.length > 0) {
    return {
      status: "failed",
      successFiles: [],
      errors: blockingIssues.map((issue) => ({
        rowNumber: issue.rowNumber ?? 0,
        fileName: "",
        message: issue.message,
      })),
      summary: {
        rowCount: dataset.rows.length,
        successCount: 0,
        failedCount: dataset.rows.length,
        errorCount: blockingIssues.length,
      },
    };
  }

  const rowErrors = issues.filter((issue) => issue.severity === "error" && issue.scope === "row");
  const sourceBuffer = await blobToArrayBuffer(template.sourceDocxBlob);
  const usedNames = new Map<string, number>();
  const successFiles: Array<{ fileName: string; blob: Blob }> = [];
  const errors: Array<{ rowNumber: number; fileName: string; message: string }> = [];

  for (let rowIndex = 0; rowIndex < dataset.rows.length; rowIndex += 1) {
    const rowNumber = rowIndex + 2;
    const fileName = uniqueFileName(fileNameForRow(template.name, dataset, rowIndex), usedNames);
    const currentRowErrors = rowErrors.filter((issue) => issue.rowNumber === rowNumber);

    if (currentRowErrors.length > 0) {
      errors.push({
        rowNumber,
        fileName,
        message: currentRowErrors.map((issue) => issue.message).join("；"),
      });
      continue;
    }

    try {
      const blob = await buildRowDocument(sourceBuffer, template, dataset, rowIndex);
      successFiles.push({ fileName, blob });
    } catch (error) {
      errors.push({
        rowNumber,
        fileName,
        message: error instanceof Error ? error.message : "生成失败。",
      });
    }
  }

  const status =
    errors.length === 0 ? "completed" : successFiles.length > 0 ? "partial_failed" : "failed";

  return {
    status,
    successFiles,
    errors,
    summary: {
      rowCount: dataset.rows.length,
      successCount: successFiles.length,
      failedCount: errors.length,
      errorCount: errors.length,
    },
  };
}
