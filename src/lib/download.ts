import JSZip from "jszip";

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

function sanitizeArchiveFileName(value: string) {
  const sanitized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return sanitized || "download";
}

function ensureZipExtension(fileName: string) {
  return fileName.toLowerCase().endsWith(".zip") ? fileName : `${fileName}.zip`;
}

function makeUniqueFileName(fileName: string, used: Map<string, number>) {
  const count = used.get(fileName) ?? 0;
  used.set(fileName, count + 1);

  if (count === 0) {
    return fileName;
  }

  const match = /^(.*?)(\.[^.]+)?$/.exec(fileName);
  const baseName = match?.[1] ?? fileName;
  const extension = match?.[2] ?? "";
  return `${baseName}-${count + 1}${extension}`;
}

export async function downloadFilesAsZip(
  files: Array<{ fileName: string; blob: Blob }>,
  archiveName: string,
) {
  const zip = new JSZip();
  const usedFileNames = new Map<string, number>();

  files.forEach((file) => {
    const nextFileName = makeUniqueFileName(file.fileName, usedFileNames);
    zip.file(nextFileName, file.blob);
  });

  const archive = await zip.generateAsync({ type: "blob" });
  downloadBlob(archive, ensureZipExtension(sanitizeArchiveFileName(archiveName)));
}
