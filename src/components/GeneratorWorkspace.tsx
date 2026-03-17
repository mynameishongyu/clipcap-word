import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  FileInput,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { db } from "../db";
import { generateDocuments } from "../lib/docx/generate";
import { makeId } from "../lib/id";
import { showErrorNotification, showSuccessNotification } from "../lib/notifications";
import {
  createTask,
  replaceTaskArtifacts,
  saveDataset,
  updateTask,
} from "../lib/repository";
import { createTaskFolderName, formatDateTime, toIsoNow } from "../lib/time";
import { parseImagePack, parseWorkbook } from "../lib/xlsx";
import { datasetHasBlockingIssues, validateDataset } from "../lib/validation";
import type {
  ArtifactRecord,
  DatasetDraft,
  DatasetRowDraft,
  TaskRecord,
  TemplateRecord,
  TemplateVersionRecord,
  ValidationIssue,
} from "../types";

export interface TemplateBundle {
  template: TemplateRecord;
  version: TemplateVersionRecord;
}

interface GeneratorWorkspaceProps {
  templates: TemplateBundle[];
  onTaskCreated: (taskId: string) => void;
}

function blankRow(columnCount: number): DatasetRowDraft {
  return {
    id: makeId("row"),
    cells: Array.from({ length: columnCount }, () => ""),
  };
}

function applyPastedCells(
  dataset: DatasetDraft,
  rowIndex: number,
  columnIndex: number,
  text: string,
) {
  const rows = text.replaceAll("\r", "").split("\n").filter((row) => row.length > 0);
  if (rows.length === 0) {
    return dataset;
  }

  const nextRows = dataset.rows.map((row) => ({ ...row, cells: [...row.cells] }));

  while (nextRows.length < rowIndex + rows.length) {
    nextRows.push(blankRow(dataset.columns.length));
  }

  rows.forEach((rawRow, pastedRowIndex) => {
    const cells = rawRow.split("\t");
    cells.forEach((value, pastedColumnIndex) => {
      const targetColumn = columnIndex + pastedColumnIndex;
      if (targetColumn < dataset.columns.length) {
        nextRows[rowIndex + pastedRowIndex].cells[targetColumn] = value;
      }
    });
  });

  return {
    ...dataset,
    rows: nextRows,
    updatedAt: toIsoNow(),
  };
}

export function GeneratorWorkspace(props: GeneratorWorkspaceProps) {
  const { templates, onTaskCreated } = props;
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [dataset, setDataset] = useState<DatasetDraft | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState("");

  const selectedBundle = useMemo(
    () => templates.find((bundle) => bundle.template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );

  const validationIssues = useMemo<ValidationIssue[]>(() => {
    if (!dataset || !selectedBundle) {
      return [];
    }

    return validateDataset(selectedBundle.version, dataset);
  }, [dataset, selectedBundle]);

  async function handleWorkbookImport(file: File) {
    setIsImporting(true);
    setError("");

    try {
      const nextDataset = await parseWorkbook(file);
      setDataset(nextDataset);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "表格文件导入失败。");
    } finally {
      setIsImporting(false);
    }
  }

  async function handleImagePackImport(file: File) {
    if (!dataset) {
      setError("请先导入表格文件再添加图片包。");
      return;
    }

    setIsImporting(true);
    setError("");

    try {
      const imagePackEntries = await parseImagePack(file);
      setDataset({
        ...dataset,
        imagePackEntries,
        updatedAt: toIsoNow(),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "图片包解析失败。");
    } finally {
      setIsImporting(false);
    }
  }

  async function handleGenerate() {
    if (!selectedBundle || !dataset) {
      setError("请先选择模板并导入数据。");
      return;
    }

    const now = toIsoNow();
    const folderName = createTaskFolderName();
    const taskId = makeId("task");
    const datasetRecord = await saveDataset({
      ...dataset,
      validationIssues,
      updatedAt: now,
    });

    const task: TaskRecord = {
      id: taskId,
      templateId: selectedBundle.template.id,
      templateName: selectedBundle.version.name,
      templateVersionId: selectedBundle.version.id,
      templateVersion: selectedBundle.version.version,
      datasetId: datasetRecord.id,
      folderName,
      status: "running",
      createdAt: now,
      startedAt: now,
      summary: {
        rowCount: dataset.rows.length,
        successCount: 0,
        failedCount: 0,
        errorCount: 0,
      },
      errors: [],
    };

    await createTask(task, []);
    setIsGenerating(true);
    setError("");

    try {
      const result = await generateDocuments(selectedBundle.version, datasetRecord);
      const finishedAt = toIsoNow();

      const artifacts: ArtifactRecord[] = result.successFiles.map((file) => ({
        id: makeId("artifact"),
        taskId,
        kind: "docx" as const,
        fileName: file.fileName,
        blob: file.blob,
        size: file.blob.size,
        createdAt: finishedAt,
      }));

      await replaceTaskArtifacts(taskId, artifacts);
      await updateTask(taskId, {
        finishedAt,
        status: result.status,
        summary: result.summary,
        errors: result.errors,
      });
      await db.templates.update(selectedBundle.template.id, {
        lastUsedAt: finishedAt,
      });

      if (result.status === "completed") {
        showSuccessNotification("生成完成", "任务已完成。");
      } else if (result.status === "partial_failed") {
        notifications.show({
          title: "部分完成",
          message: "任务已完成，但有部分数据行失败。",
          color: "yellow",
          autoClose: 4000,
        });
      } else {
        showErrorNotification("生成失败", "任务创建成功，但没有生成任何有效文件。");
      }
      onTaskCreated(taskId);
    } catch (reason) {
      const finishedAt = toIsoNow();
      await updateTask(taskId, {
        finishedAt,
        status: "failed",
        summary: {
          rowCount: dataset.rows.length,
          successCount: 0,
          failedCount: dataset.rows.length,
          errorCount: 1,
        },
        errors: [
          {
            rowNumber: 0,
            fileName: "",
            message: reason instanceof Error ? reason.message : "任务生成失败。",
          },
        ],
      });
      const message = reason instanceof Error ? reason.message : "任务生成失败。";
      setError(message);
      showErrorNotification("生成失败", message);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <Stack gap="lg">
      <Group align="flex-end" justify="space-between" wrap="wrap">
        <Stack gap={4}>
          <Text c="dimmed" fw={700} size="xs" tt="uppercase">
            批量处理
          </Text>
          <Title order={2}>批量生成文档</Title>
          <Text c="dimmed">导入表格文件和图片压缩包，在浏览器里完成校验、替换、生成和任务归档。</Text>
        </Stack>
        <Button
          disabled={!selectedBundle || !dataset}
          loading={isGenerating}
          onClick={() => void handleGenerate()}
        >
          开始生成任务
        </Button>
      </Group>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Paper p="lg" radius="lg" withBorder>
          <Stack gap="md">
            <Title order={4}>输入资源</Title>

            <Select
              data={templates.map((bundle) => ({
                value: bundle.template.id,
                label: `${bundle.template.name} · 版本 ${bundle.version.version}`,
              }))}
              label="选择模板"
              placeholder="请选择模板"
              searchable
              value={selectedTemplateId}
              onChange={setSelectedTemplateId}
            />

            <FileInput
              accept=".xlsx"
              label="上传表格文件 (.xlsx)"
              placeholder="选择表格文件"
              onChange={(file) => {
                if (file) {
                  void handleWorkbookImport(file);
                }
              }}
            />

            <Text c="dimmed" size="sm">
              当前数据集：{dataset?.name ?? "未导入数据"}
            </Text>

            <FileInput
              accept=".zip"
              label="上传图片压缩包 (.zip)"
              placeholder="选择压缩包文件"
              onChange={(file) => {
                if (file) {
                  void handleImagePackImport(file);
                }
              }}
            />

            <SimpleGrid cols={2} spacing="sm">
              <Paper p="sm" radius="md" withBorder>
                <Stack gap={4}>
                  <Text c="dimmed" size="xs">
                    数据行数
                  </Text>
                  <Text ff="monospace" fw={700}>
                    {dataset?.rows.length ?? 0}
                  </Text>
                </Stack>
              </Paper>
              <Paper p="sm" radius="md" withBorder>
                <Stack gap={4}>
                  <Text c="dimmed" size="xs">
                    图片数量
                  </Text>
                  <Text ff="monospace" fw={700}>
                    {dataset?.imagePackEntries.length ?? 0}
                  </Text>
                </Stack>
              </Paper>
            </SimpleGrid>

            <Text c="dimmed" size="sm">
              最近修改：{formatDateTime(dataset?.updatedAt)}
            </Text>

            {error ? (
              <Alert color="red" title="处理失败" variant="light">
                {error}
              </Alert>
            ) : null}

            {isImporting ? (
              <Alert title="正在读取文件" variant="light">
                请稍候，导入完成后会自动更新数据视图。
              </Alert>
            ) : null}
          </Stack>
        </Paper>

        <Paper p="lg" radius="lg" withBorder>
          <Stack gap="md">
            <Group justify="space-between">
              <Title order={4}>校验结果</Title>
              <Badge variant="default">{validationIssues.length} 条</Badge>
            </Group>

            {validationIssues.length === 0 ? (
              <Text c="dimmed" size="sm">
                {selectedBundle && dataset
                  ? "当前数据通过校验，可以直接生成。"
                  : "选择模板并导入数据后，这里会显示校验结果。"}
              </Text>
            ) : (
              <Stack gap="sm">
                {validationIssues.map((issue) => (
                  <Alert
                    key={issue.id}
                    color={issue.severity === "error" ? "red" : "yellow"}
                    title={issue.scope === "row" ? `第 ${issue.rowNumber} 行` : issue.scope}
                    variant="light"
                  >
                    {issue.message}
                  </Alert>
                ))}
              </Stack>
            )}

            {datasetHasBlockingIssues(validationIssues) ? (
              <Alert color="red" title="存在结构性错误" variant="light">
                当前任务将无法成功生成任何文档。
              </Alert>
            ) : null}
          </Stack>
        </Paper>
      </SimpleGrid>

      <Paper p="lg" radius="lg" withBorder>
        <Stack gap="md">
          <Group align="flex-end" justify="space-between" wrap="wrap">
            <div>
              <Title order={4}>数据编辑器</Title>
              <Text c="dimmed" size="sm">
                导入表格文件后可在这里修改列头和数据行。
              </Text>
            </div>

            <Button
              disabled={!dataset}
              variant="default"
              onClick={() => {
                if (!dataset) {
                  return;
                }

                setDataset({
                  ...dataset,
                  rows: [...dataset.rows, blankRow(dataset.columns.length)],
                  updatedAt: toIsoNow(),
                });
              }}
            >
              新增一行
            </Button>
          </Group>

          {!dataset ? (
            <Text c="dimmed">导入表格文件后可在这里修改列头和数据行。</Text>
          ) : (
            <div className="table-shell">
              <table className="data-grid">
                <thead>
                  <tr>
                    <th className="index-col">#</th>
                    {dataset.columns.map((column, columnIndex) => (
                      <th key={`${columnIndex}-${column}`}>
                        <input
                          className="grid-input"
                          value={column}
                          onChange={(event) => {
                            const nextColumns = [...dataset.columns];
                            nextColumns[columnIndex] = event.currentTarget.value;
                            setDataset({
                              ...dataset,
                              columns: nextColumns,
                              updatedAt: toIsoNow(),
                            });
                          }}
                        />
                      </th>
                    ))}
                    <th className="action-col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {dataset.rows.map((row, rowIndex) => (
                    <tr key={row.id}>
                      <td className="index-col">{rowIndex + 2}</td>
                      {row.cells.map((cell, columnIndex) => {
                        const cellIssue = validationIssues.find(
                          (issue) => issue.rowNumber === rowIndex + 2 && issue.severity === "error",
                        );
                        return (
                          <td key={`${row.id}-${columnIndex}`} className={cellIssue ? "has-error" : ""}>
                            <input
                              className="grid-input"
                              value={cell}
                              onChange={(event) => {
                                const nextRows = dataset.rows.map((candidate) => ({
                                  ...candidate,
                                  cells: [...candidate.cells],
                                }));
                                nextRows[rowIndex].cells[columnIndex] = event.currentTarget.value;
                                setDataset({
                                  ...dataset,
                                  rows: nextRows,
                                  updatedAt: toIsoNow(),
                                });
                              }}
                              onPaste={(event) => {
                                const pasted = event.clipboardData.getData("text/plain");
                                if (!pasted.includes("\t") && !pasted.includes("\n")) {
                                  return;
                                }

                                event.preventDefault();
                                setDataset(applyPastedCells(dataset, rowIndex, columnIndex, pasted));
                              }}
                            />
                          </td>
                        );
                      })}
                      <td className="action-col">
                        <Button
                          size="xs"
                          variant="subtle"
                          onClick={() => {
                            setDataset({
                              ...dataset,
                              rows: dataset.rows.filter((candidate) => candidate.id !== row.id),
                              updatedAt: toIsoNow(),
                            });
                          }}
                        >
                          删除
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
