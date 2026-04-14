import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { blobToArrayBuffer } from "./blob";
import { parseWorkbook, exportTemplateWorkbook } from "./xlsx";
import type { TemplateVersionRecord } from "../types";

function createTemplate(slotNames: string[]): TemplateVersionRecord {
  return {
    id: "template_version",
    templateId: "template",
    name: "批量合同",
    version: 1,
    sourceDocxBlob: new Blob(["x"]),
    sourceDocxName: "contract.docx",
    createdAt: new Date().toISOString(),
    slots: slotNames.map((name, index) => ({
      id: `slot_${index + 1}`,
      name,
      type: index % 2 === 0 ? "text" : "image",
      required: true,
      occurrences: [],
    })),
  };
}

async function readWorkbook(blob: Blob) {
  return XLSX.read(await blobToArrayBuffer(blob), { type: "array", cellDates: false });
}

describe("exportTemplateWorkbook", () => {
  it("keeps slot order without appending extra system columns", async () => {
    const workbook = await readWorkbook(exportTemplateWorkbook(createTemplate(["乙方", "甲方", "证件照"])));
    const sheet = workbook.Sheets[workbook.SheetNames[0]!];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
      blankrows: false,
      defval: "",
    });

    expect(workbook.SheetNames[0]).toBe("批量生成模板");
    expect(rows[0]).toEqual(["乙方", "甲方", "证件照"]);
  });

  it("keeps the import sheet first so parseWorkbook can read it back", async () => {
    const blob = exportTemplateWorkbook(createTemplate(["姓名", "头像"]));
    const parsed = await parseWorkbook(
      new File([blob], "template.xlsx", {
        type: blob.type,
      }),
    );

    expect(parsed.columns).toEqual(["姓名", "头像"]);
    expect(parsed.rows).toHaveLength(0);
  });

  it("adds a separate instructions sheet without affecting the import sheet", async () => {
    const workbook = await readWorkbook(exportTemplateWorkbook(createTemplate(["姓名"])));
    const instructionSheet = workbook.Sheets[workbook.SheetNames[1]!];
    const rows = XLSX.utils.sheet_to_json<string[]>(instructionSheet, {
      header: 1,
      raw: false,
      blankrows: false,
      defval: "",
    });

    expect(workbook.SheetNames).toEqual(["批量生成模板", "填写说明"]);
    expect(rows).toContainEqual(["输出文件名", "系统会按“模板名-行号”自动命名输出文件。"]);
  });

  it("exports an empty import sheet when the template has no dynamic slots", async () => {
    const blob = exportTemplateWorkbook(createTemplate([]));
    const parsed = await parseWorkbook(
      new File([blob], "template.xlsx", {
        type: blob.type,
      }),
    );

    expect(parsed.columns).toEqual([]);
    expect(parsed.rows).toEqual([]);
  });
});
