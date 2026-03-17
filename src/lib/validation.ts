import { makeId } from "./id";
import type { DatasetDraft, Slot, TemplateVersionRecord, ValidationIssue } from "../types";

export function normalizeToken(value: string) {
  return value.trim();
}

export function normalizeFileName(value: string) {
  return value.trim().toLowerCase();
}

function makeIssue(
  partial: Omit<ValidationIssue, "id">,
): ValidationIssue {
  return { id: makeId("issue"), ...partial };
}

function findColumnIndex(columns: string[], slotName: string) {
  const normalizedSlot = normalizeToken(slotName);
  return columns.findIndex((column) => normalizeToken(column) === normalizedSlot);
}

function buildImageIndex(dataset: DatasetDraft) {
  return dataset.imagePackEntries.reduce<Map<string, number>>((map, entry) => {
    map.set(entry.normalizedName, (map.get(entry.normalizedName) ?? 0) + 1);
    return map;
  }, new Map());
}

function validateColumns(templateSlots: Slot[], dataset: DatasetDraft, issues: ValidationIssue[]) {
  const normalizedColumns = dataset.columns.map(normalizeToken);

  normalizedColumns.forEach((column, index) => {
    if (!column) {
      issues.push(
        makeIssue({
          scope: "dataset",
          severity: "error",
          message: `第 ${index + 1} 列的列名为空。`,
        }),
      );
    }
  });

  const duplicateColumns = normalizedColumns.filter(
    (column, index) => column && normalizedColumns.indexOf(column) !== index,
  );

  [...new Set(duplicateColumns)].forEach((column) => {
    issues.push(
      makeIssue({
        scope: "dataset",
        severity: "error",
        message: `表格文件中存在重复列名：${column}。`,
      }),
    );
  });

  templateSlots.forEach((slot) => {
    if (findColumnIndex(dataset.columns, slot.name) === -1) {
      issues.push(
        makeIssue({
          scope: "dataset",
          severity: "error",
          slotName: slot.name,
          message: `缺少与槽位 "${slot.name}" 对应的列。`,
        }),
      );
    }
  });
}

function validateImagePack(dataset: DatasetDraft, issues: ValidationIssue[]) {
  const duplicates = dataset.imagePackEntries.filter(
    (entry, index, list) =>
      list.findIndex((candidate) => candidate.normalizedName === entry.normalizedName) !== index,
  );

  [...new Set(duplicates.map((entry) => entry.name.trim().toLowerCase()))].forEach((name) => {
    issues.push(
      makeIssue({
        scope: "dataset",
        severity: "error",
        message: `图片包中存在重复文件名：${name}。`,
      }),
    );
  });
}

function getEffectiveValue(slot: Slot, rawValue: string) {
  const value = rawValue.trim();
  if (value) {
    return value;
  }

  if (slot.type === "text" && slot.defaultValue?.trim()) {
    return slot.defaultValue.trim();
  }

  return "";
}

export function validateDataset(template: TemplateVersionRecord, dataset: DatasetDraft) {
  const issues: ValidationIssue[] = [];
  const imageIndex = buildImageIndex(dataset);

  validateColumns(template.slots, dataset, issues);
  validateImagePack(dataset, issues);

  template.slots.forEach((slot) => {
    const columnIndex = findColumnIndex(dataset.columns, slot.name);
    if (columnIndex === -1) {
      return;
    }

    dataset.rows.forEach((row, rowIndex) => {
      const rawValue = String(row.cells[columnIndex] ?? "");
      const effectiveValue = getEffectiveValue(slot, rawValue);

      if (slot.required && !effectiveValue) {
        issues.push(
          makeIssue({
            scope: "row",
            severity: "error",
            slotName: slot.name,
            rowNumber: rowIndex + 2,
            message: `第 ${rowIndex + 2} 行的槽位 "${slot.name}" 不能为空。`,
          }),
        );
      }

      if (slot.type === "image" && effectiveValue) {
        const normalizedFileName = normalizeFileName(effectiveValue);
        if (!imageIndex.has(normalizedFileName)) {
          issues.push(
            makeIssue({
              scope: "row",
              severity: "error",
              slotName: slot.name,
              rowNumber: rowIndex + 2,
              message: `第 ${rowIndex + 2} 行引用的图片 "${effectiveValue}" 不在图片包中。`,
            }),
          );
        } else if ((imageIndex.get(normalizedFileName) ?? 0) > 1) {
          issues.push(
            makeIssue({
              scope: "row",
              severity: "error",
              slotName: slot.name,
              rowNumber: rowIndex + 2,
              message: `第 ${rowIndex + 2} 行引用的图片 "${effectiveValue}" 在图片包中不唯一。`,
            }),
          );
        }
      }
    });
  });

  return issues;
}

export function datasetHasBlockingIssues(issues: ValidationIssue[]) {
  return issues.some((issue) => issue.severity === "error" && issue.scope !== "artifact");
}
