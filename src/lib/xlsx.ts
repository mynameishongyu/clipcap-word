import JSZip from "jszip";
import * as XLSX from "xlsx";
import { blobToArrayBuffer } from "./blob";
import { makeId } from "./id";
import { toIsoNow } from "./time";
import type { DatasetDraft, DatasetRowDraft, ImagePackEntry, TemplateVersionRecord } from "../types";

export const DATASET_FILE_NAME_COLUMN = "file_name";

const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

function extOf(fileName: string) {
  const match = /\.[^./\\]+$/.exec(fileName.toLowerCase());
  return match?.[0] ?? "";
}

function guessMimeType(fileName: string, fallback = "application/octet-stream") {
  return IMAGE_MIME_TYPES[extOf(fileName)] ?? fallback;
}

function sanitizeExportFileName(value: string) {
  const sanitized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return sanitized || "template";
}

export function createTemplateWorkbookFileName(templateName: string) {
  return `${sanitizeExportFileName(templateName)}-批量生成模板.xlsx`;
}

function buildInstructionsSheet(template: TemplateVersionRecord) {
  const hasDynamicSlots = template.slots.length > 0;
  const slotNames = hasDynamicSlots ? template.slots.map((slot) => slot.name).join("、") : "无";

  return XLSX.utils.aoa_to_sheet([
    ["项目", "说明"],
    ["模板名称", template.name],
    ["使用方式", "请填写第一张工作表后，直接上传到“批量生成”页面。"],
    ["文本槽位", "填写实际替换文本；若单元格留空且模板配置了默认值，生成时会回退到默认值。"],
    ["图片槽位", "填写图片压缩包中的文件名，例如 avatar.png。"],
    ["输出文件名", "系统会按“模板名-行号”自动命名输出文件。"],
    ["动态槽位", hasDynamicSlots ? slotNames : "当前模板没有动态槽位。"],
  ]);
}

export function exportTemplateWorkbook(template: TemplateVersionRecord) {
  const columns = template.slots.map((slot) => slot.name);
  const workbook = XLSX.utils.book_new();
  const templateSheet = XLSX.utils.aoa_to_sheet([columns]);
  const instructionsSheet = buildInstructionsSheet(template);

  XLSX.utils.book_append_sheet(workbook, templateSheet, "批量生成模板");
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, "填写说明");

  const buffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  });

  return new Blob([buffer], { type: XLSX_MIME_TYPE });
}

export async function parseWorkbook(file: File) {
  const buffer = await blobToArrayBuffer(file);
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error("表格文件中没有可读取的工作表。");
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    raw: false,
    blankrows: false,
    defval: "",
  });

  const [headerRow = [], ...body] = rows;
  const now = toIsoNow();
  const columns = headerRow.map((value, index) => {
    const normalized = String(value ?? "").trim();
    return normalized || `第 ${index + 1} 列`;
  });

  const parsedRows: DatasetRowDraft[] = body.map((rawRow) => ({
    id: makeId("row"),
    cells: columns.map((_, index) => String(rawRow[index] ?? "")),
  }));

  const dataset: DatasetDraft = {
    id: makeId("dataset"),
    name: file.name.replace(/\.[^.]+$/, ""),
    sourceXlsxBlob: file,
    columns,
    rows: parsedRows,
    imagePackEntries: [],
    validationIssues: [],
    createdAt: now,
    updatedAt: now,
  };

  return dataset;
}

export async function parseImagePack(file: File) {
  const zip = await JSZip.loadAsync(await blobToArrayBuffer(file));
  const entries: ImagePackEntry[] = [];

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) {
      continue;
    }

    const name = path.split("/").pop();
    if (!name) {
      continue;
    }

    const blob = await entry.async("blob");
    entries.push({
      id: makeId("image"),
      name,
      normalizedName: name.trim().toLowerCase(),
      blob,
      mimeType: guessMimeType(name, blob.type || "application/octet-stream"),
      size: blob.size,
    });
  }

  return entries;
}
