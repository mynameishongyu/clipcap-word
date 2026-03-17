import JSZip from "jszip";
import * as XLSX from "xlsx";
import { blobToArrayBuffer } from "./blob";
import { makeId } from "./id";
import { toIsoNow } from "./time";
import type { DatasetDraft, DatasetRowDraft, ImagePackEntry } from "../types";

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
