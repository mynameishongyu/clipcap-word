import { describe, expect, it } from "vitest";
import { validateDataset } from "./validation";
import type { DatasetDraft, TemplateVersionRecord } from "../types";

function createTemplate(): TemplateVersionRecord {
  return {
    id: "template_version",
    templateId: "template",
    name: "Contract",
    version: 1,
    sourceDocxBlob: new Blob(["x"]),
    sourceDocxName: "contract.docx",
    createdAt: new Date().toISOString(),
    slots: [
      {
        id: "slot_name",
        name: "name",
        type: "text",
        required: true,
        occurrences: [],
      },
      {
        id: "slot_avatar",
        name: "avatar",
        type: "image",
        required: true,
        occurrences: [],
      },
    ],
  };
}

function createDataset(columns: string[], row: string[]): DatasetDraft {
  return {
    id: "dataset",
    name: "sheet",
    sourceXlsxBlob: new Blob(["x"]),
    columns,
    rows: [{ id: "row_1", cells: row }],
    imagePackEntries: [],
    validationIssues: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("validateDataset", () => {
  it("reports missing slot columns", () => {
    const issues = validateDataset(createTemplate(), createDataset(["name"], ["Alice"]));
    expect(issues.some((issue) => issue.message.includes('缺少与槽位 "avatar"'))).toBe(true);
  });

  it("reports row-level image lookup errors", () => {
    const issues = validateDataset(
      createTemplate(),
      createDataset(["name", "avatar"], ["Alice", "alice.png"]),
    );
    expect(issues.some((issue) => issue.message.includes("不在图片包中"))).toBe(true);
  });
});
