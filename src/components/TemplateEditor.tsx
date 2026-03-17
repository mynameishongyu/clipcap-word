import { startTransition, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  FileInput,
  Grid,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { DocumentPreview } from "./DocumentPreview";
import { parseDocx, releaseParsedDocument } from "../lib/docx/parse";
import { makeId } from "../lib/id";
import { showSuccessNotification } from "../lib/notifications";
import { saveTemplateVersion } from "../lib/repository";
import { normalizeToken } from "../lib/validation";
import type {
  ImageSegment,
  ParsedDocument,
  Slot,
  TemplateVersionRecord,
  TextSegment,
} from "../types";

type PendingSelection =
  | {
      type: "text";
      segment: TextSegment;
      startOffset: number;
      endOffset: number;
      selectedText: string;
    }
  | {
      type: "image";
      segment: ImageSegment;
    };

interface TemplateEditorProps {
  initialVersion?: TemplateVersionRecord | null;
  onSaved: (version: TemplateVersionRecord) => void;
  onCancel: () => void;
}

function locatorKey(path: number[], childStart?: number, childEnd?: number) {
  return `${path.join(".")}:${childStart ?? ""}:${childEnd ?? ""}`;
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number) {
  return Math.max(startA, startB) < Math.min(endA, endB);
}

export function TemplateEditor(props: TemplateEditorProps) {
  const { initialVersion, onSaved, onCancel } = props;
  const [templateName, setTemplateName] = useState(initialVersion?.name ?? "");
  const [sourceDocxBlob, setSourceDocxBlob] = useState<Blob | null>(initialVersion?.sourceDocxBlob ?? null);
  const [sourceDocxName, setSourceDocxName] = useState(initialVersion?.sourceDocxName ?? "");
  const [parsedDocument, setParsedDocument] = useState<ParsedDocument | null>(null);
  const [slots, setSlots] = useState<Slot[]>(initialVersion?.slots ?? []);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [focusedOccurrenceId, setFocusedOccurrenceId] = useState<string | null>(null);
  const [selectionSlotName, setSelectionSlotName] = useState("");
  const [selectionRequired, setSelectionRequired] = useState(true);
  const [selectionDefaultValue, setSelectionDefaultValue] = useState("");
  const [activeSlotName, setActiveSlotName] = useState("");
  const [activeSlotRequired, setActiveSlotRequired] = useState(true);
  const [activeSlotDefaultValue, setActiveSlotDefaultValue] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const activeSlot = useMemo(
    () => slots.find((slot) => slot.id === activeSlotId) ?? null,
    [activeSlotId, slots],
  );

  useEffect(() => {
    setTemplateName(initialVersion?.name ?? "");
    setSourceDocxBlob(initialVersion?.sourceDocxBlob ?? null);
    setSourceDocxName(initialVersion?.sourceDocxName ?? "");
    setSlots(initialVersion?.slots ?? []);
    setPendingSelection(null);
    setActiveSlotId(null);
    setFocusedOccurrenceId(null);
  }, [initialVersion]);

  useEffect(() => {
    if (!sourceDocxBlob) {
      if (parsedDocument) {
        releaseParsedDocument(parsedDocument);
        setParsedDocument(null);
      }
      return;
    }

    let cancelled = false;
    setIsParsing(true);
    setError("");

    void parseDocx(sourceDocxBlob)
      .then((nextDocument) => {
        if (cancelled) {
          releaseParsedDocument(nextDocument);
          return;
        }

        startTransition(() => {
          setParsedDocument((previous) => {
            if (previous) {
              releaseParsedDocument(previous);
            }

            return nextDocument;
          });
        });
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "模板解析失败。");
      })
      .finally(() => {
        if (!cancelled) {
          setIsParsing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sourceDocxBlob]);

  useEffect(() => {
    if (!activeSlot) {
      setActiveSlotName("");
      setActiveSlotRequired(true);
      setActiveSlotDefaultValue("");
      return;
    }

    setActiveSlotName(activeSlot.name);
    setActiveSlotRequired(activeSlot.required);
    setActiveSlotDefaultValue(activeSlot.defaultValue ?? "");
  }, [activeSlot]);

  useEffect(() => {
    return () => {
      if (parsedDocument) {
        releaseParsedDocument(parsedDocument);
      }
    };
  }, [parsedDocument]);

  function resetSelectionForm() {
    setSelectionSlotName("");
    setSelectionRequired(true);
    setSelectionDefaultValue("");
  }

  function openPendingSelection(selection: PendingSelection) {
    setPendingSelection(selection);
    setActiveSlotId(null);
    setFocusedOccurrenceId(null);
    setSelectionSlotName(
      selection.type === "text" ? selection.selectedText.trim() : "图片槽位",
    );
    setSelectionRequired(true);
    setSelectionDefaultValue("");
  }

  async function handleUpload(file: File) {
    setError("");
    setSlots([]);
    setPendingSelection(null);
    setActiveSlotId(null);
    setFocusedOccurrenceId(null);
    setSourceDocxBlob(file);
    setSourceDocxName(file.name);
    if (!templateName.trim()) {
      setTemplateName(file.name.replace(/\.docx$/i, ""));
    }
  }

  function selectExistingSlot(slotId: string, occurrenceId?: string) {
    setPendingSelection(null);
    setActiveSlotId(slotId);
    setFocusedOccurrenceId(occurrenceId ?? null);
    setError("");
  }

  function ensurePendingSelectionValid(slotName: string) {
    if (!pendingSelection) {
      throw new Error("当前没有待创建的槽位。");
    }

    if (!slotName.trim()) {
      throw new Error("槽位名称不能为空。");
    }

    const existingByName = slots.find(
      (slot) => normalizeToken(slot.name) === normalizeToken(slotName),
    );

    if (existingByName && existingByName.type !== pendingSelection.type) {
      throw new Error("同名槽位已存在，但类型不同。");
    }

    if (pendingSelection.type === "text") {
      const pendingKey = locatorKey(
        pendingSelection.segment.locator.path,
        pendingSelection.segment.locator.childStart,
        pendingSelection.segment.locator.childEnd,
      );

      const overlap = slots.some((slot) =>
        slot.occurrences.some((occurrence) => {
          if (occurrence.kind !== "textRange") {
            return false;
          }

          const occurrenceKey = locatorKey(
            occurrence.locator.path,
            occurrence.locator.childStart,
            occurrence.locator.childEnd,
          );

          return (
            occurrenceKey === pendingKey &&
            rangesOverlap(
              occurrence.startOffset,
              occurrence.endOffset,
              pendingSelection.startOffset,
              pendingSelection.endOffset,
            )
          );
        }),
      );

      if (overlap) {
        throw new Error("所选文本与已有槽位重叠，请重新选择。");
      }
    }

    if (pendingSelection.type === "image") {
      const duplicate = slots.some((slot) =>
        slot.occurrences.some(
          (occurrence) =>
            occurrence.kind === "imageNode" &&
            locatorKey(occurrence.locator.path) ===
              locatorKey(pendingSelection.segment.locator.path),
        ),
      );

      if (duplicate) {
        throw new Error("这张图片已经绑定到某个槽位。");
      }
    }
  }

  function createPendingOccurrence(slotId: string) {
    if (!pendingSelection) {
      return null;
    }

    if (pendingSelection.type === "text") {
      return {
        id: makeId("occurrence"),
        slotId,
        kind: "textRange" as const,
        locator: pendingSelection.segment.locator,
        startOffset: pendingSelection.startOffset,
        endOffset: pendingSelection.endOffset,
        originalText: pendingSelection.selectedText,
        originalSegmentText: pendingSelection.segment.text,
        styleSnapshot: pendingSelection.segment.style,
      };
    }

    return {
      id: makeId("occurrence"),
      slotId,
      kind: "imageNode" as const,
      locator: pendingSelection.segment.locator,
      originalTarget: pendingSelection.segment.locator.target,
      altText: pendingSelection.segment.altText,
      styleSnapshot: pendingSelection.segment.style,
    };
  }

  function handleCommitPendingSelection() {
    try {
      const normalizedName = selectionSlotName.trim();
      ensurePendingSelectionValid(normalizedName);

      const existingIndex = slots.findIndex(
        (slot) => normalizeToken(slot.name) === normalizeToken(normalizedName),
      );
      const slotId = existingIndex === -1 ? makeId("slot") : slots[existingIndex].id;
      const occurrence = createPendingOccurrence(slotId);

      if (!occurrence) {
        return;
      }

      const nextSlots = [...slots];

      if (existingIndex === -1) {
        nextSlots.push({
          id: slotId,
          name: normalizedName,
          type: pendingSelection!.type,
          required: selectionRequired,
          defaultValue:
            pendingSelection?.type === "text" ? selectionDefaultValue.trim() || undefined : undefined,
          occurrences: [occurrence],
        });
      } else {
        nextSlots[existingIndex] = {
          ...nextSlots[existingIndex],
          required: selectionRequired,
          defaultValue:
            pendingSelection?.type === "text" ? selectionDefaultValue.trim() || undefined : undefined,
          occurrences: [...nextSlots[existingIndex].occurrences, occurrence],
        };
      }

      setSlots(nextSlots);
      setPendingSelection(null);
      setActiveSlotId(slotId);
      setFocusedOccurrenceId(occurrence.id);
      resetSelectionForm();
      setError("");
      showSuccessNotification("添加成功", "槽位已加入模板。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法创建槽位。");
    }
  }

  function handleSaveActiveSlot() {
    if (!activeSlot) {
      return;
    }

    const normalizedName = activeSlotName.trim();
    if (!normalizedName) {
      setError("槽位名称不能为空。");
      return;
    }

    const duplicate = slots.find(
      (slot) => slot.id !== activeSlot.id && normalizeToken(slot.name) === normalizeToken(normalizedName),
    );

    if (duplicate && duplicate.type !== activeSlot.type) {
      setError("同名槽位已存在，但类型不同。");
      return;
    }

    if (duplicate && duplicate.type === activeSlot.type) {
      const mergedSlot: Slot = {
        ...duplicate,
        name: normalizedName,
        required: activeSlotRequired,
        defaultValue: activeSlot.type === "text" ? activeSlotDefaultValue.trim() || undefined : undefined,
        occurrences: [
          ...duplicate.occurrences,
          ...activeSlot.occurrences.map((occurrence) => ({
            ...occurrence,
            slotId: duplicate.id,
          })),
        ],
      };

      setSlots((current) =>
        current
          .filter((slot) => slot.id !== activeSlot.id && slot.id !== duplicate.id)
          .concat(mergedSlot),
      );
      setActiveSlotId(duplicate.id);
      setError("");
      showSuccessNotification("更新成功", "槽位已合并。");
      return;
    }

    setSlots((current) =>
      current.map((slot) =>
        slot.id === activeSlot.id
          ? {
              ...slot,
              name: normalizedName,
              required: activeSlotRequired,
              defaultValue: slot.type === "text" ? activeSlotDefaultValue.trim() || undefined : undefined,
            }
          : slot,
      ),
    );
    setError("");
    showSuccessNotification("更新成功", "槽位信息已更新。");
  }

  function handleDeleteSlot(slotId: string) {
    setSlots((current) => current.filter((slot) => slot.id !== slotId));
    if (activeSlotId === slotId) {
      setActiveSlotId(null);
      setFocusedOccurrenceId(null);
    }
    showSuccessNotification("删除成功", "槽位已删除。");
  }

  function handleDeleteOccurrence() {
    if (!activeSlot || !focusedOccurrenceId) {
      return;
    }

    const nextOccurrences = activeSlot.occurrences.filter(
      (occurrence) => occurrence.id !== focusedOccurrenceId,
    );

    if (nextOccurrences.length === 0) {
      handleDeleteSlot(activeSlot.id);
      return;
    }

    setSlots((current) =>
      current.map((slot) =>
        slot.id === activeSlot.id
          ? {
              ...slot,
              occurrences: nextOccurrences,
            }
          : slot,
      ),
    );
    setFocusedOccurrenceId(null);
    showSuccessNotification("删除成功", "当前出现位置已移除。");
  }

  async function handleSaveTemplate() {
    if (!templateName.trim()) {
      setError("模板名称不能为空。");
      return;
    }

    if (!sourceDocxBlob) {
      setError("请先上传 .docx 模板。");
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      const version = await saveTemplateVersion({
        templateId: initialVersion?.templateId,
        name: templateName.trim(),
        sourceDocxBlob,
        sourceDocxName,
        slots,
      });
      showSuccessNotification("保存成功", "模板已保存。");
      onSaved(version);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "模板保存失败。");
    } finally {
      setIsSaving(false);
    }
  }

  const sortedSlots = [...slots].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

  return (
    <Stack gap="lg">
      <Group align="flex-end" justify="space-between" wrap="wrap">
        <Stack gap={4}>
          <Text c="dimmed" fw={700} size="xs" tt="uppercase">
            模板编辑
          </Text>
          <Title order={2}>{initialVersion ? "编辑模板" : "新建模板"}</Title>
          <Text c="dimmed">在线标记文本和图片槽位，保存后生成一个新的模板版本。</Text>
        </Stack>
        <Group gap="sm">
          <Button variant="default" onClick={onCancel}>
            返回列表
          </Button>
          <Button loading={isSaving} onClick={() => void handleSaveTemplate()}>
            保存模板
          </Button>
        </Group>
      </Group>

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Paper p="lg" radius="lg" withBorder>
            <Stack gap="md">
              <Group align="flex-start" justify="space-between" wrap="wrap">
                <div>
                  <Title order={4}>文档预览</Title>
                  <Text c="dimmed" size="sm">
                    文字只支持在单个文本段内选中并创建槽位。
                  </Text>
                </div>
              </Group>

              {isParsing ? (
                <Alert title="正在解析模板" variant="light">
                  解析完成后会在这里显示文档内容。
                </Alert>
              ) : null}

              {!isParsing ? (
                <DocumentPreview
                  activeSlotId={activeSlotId}
                  document={parsedDocument}
                  focusedOccurrenceId={focusedOccurrenceId}
                  onCreateTextSelection={(segment, startOffset, endOffset) => {
                    const selectedText = segment.text.slice(startOffset, endOffset);
                    if (!selectedText.trim()) {
                      setError("请选择实际文本内容，不要只选空白字符。");
                      return;
                    }

                    openPendingSelection({
                      type: "text",
                      segment,
                      startOffset,
                      endOffset,
                      selectedText,
                    });
                  }}
                  onPickImage={(segment) => {
                    openPendingSelection({
                      type: "image",
                      segment,
                    });
                  }}
                  onSelectSlotOccurrence={selectExistingSlot}
                  slots={slots}
                />
              ) : null}
            </Stack>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack gap="md">
            <Paper p="lg" radius="lg" withBorder>
              <Stack gap="md">
                <Title order={4}>模板信息</Title>

                <TextInput
                  label="模板名称"
                  placeholder="例如：录用通知书"
                  value={templateName}
                  onChange={(event) => setTemplateName(event.currentTarget.value)}
                />

                <FileInput
                  accept=".docx"
                  label="上传 .docx 模板"
                  placeholder="选择 .docx 文件"
                  onChange={(file) => {
                    if (file) {
                      void handleUpload(file);
                    }
                  }}
                />

                <Text c="dimmed" size="sm">
                  当前文件：{sourceDocxName || "未选择文件"}
                </Text>

                {error ? (
                  <Alert color="red" title="处理失败" variant="light">
                    {error}
                  </Alert>
                ) : null}
              </Stack>
            </Paper>

            <Paper p="lg" radius="lg" withBorder>
              <Stack gap="md">
                <Title order={4}>待创建槽位</Title>

                {!pendingSelection ? (
                  <Text c="dimmed" size="sm">
                    选中文本或点击图片后，这里会显示创建表单。
                  </Text>
                ) : (
                  <Stack gap="md">
                    <Paper className="selection-card" p="md" radius="md" withBorder>
                      <Stack gap={6}>
                        <Badge variant="light">
                          {pendingSelection.type === "text" ? "文本槽位" : "图片槽位"}
                        </Badge>
                        <Text fw={600}>
                          {pendingSelection.type === "text"
                            ? pendingSelection.selectedText
                            : pendingSelection.segment.altText || "图片占位"}
                        </Text>
                      </Stack>
                    </Paper>

                    <TextInput
                      label="槽位名称"
                      value={selectionSlotName}
                      onChange={(event) => setSelectionSlotName(event.currentTarget.value)}
                    />

                    <Checkbox
                      checked={selectionRequired}
                      label="必填槽位"
                      onChange={(event) => setSelectionRequired(event.currentTarget.checked)}
                    />

                    {pendingSelection.type === "text" ? (
                      <TextInput
                        label="默认值"
                        value={selectionDefaultValue}
                        onChange={(event) => setSelectionDefaultValue(event.currentTarget.value)}
                      />
                    ) : null}

                    <Group gap="sm">
                      <Button onClick={handleCommitPendingSelection}>加入模板</Button>
                      <Button
                        variant="default"
                        onClick={() => {
                          setPendingSelection(null);
                          resetSelectionForm();
                        }}
                      >
                        取消
                      </Button>
                    </Group>
                  </Stack>
                )}
              </Stack>
            </Paper>

            <Paper p="lg" radius="lg" withBorder>
              <Stack gap="md">
                <Group justify="space-between">
                  <Title order={4}>槽位列表</Title>
                  <Badge variant="default">{slots.length} 个槽位</Badge>
                </Group>

                {sortedSlots.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    还没有槽位。
                  </Text>
                ) : (
                  <Stack gap="xs">
                    {sortedSlots.map((slot) => (
                      <UnstyledButton
                        key={slot.id}
                        className={`slot-row${slot.id === activeSlotId ? " is-active" : ""}`}
                        onClick={() => selectExistingSlot(slot.id)}
                      >
                        <Group align="center" justify="space-between" wrap="nowrap">
                          <div className="slot-row-copy">
                            <Text fw={600}>{slot.name}</Text>
                            <Text c="dimmed" size="sm">
                              {slot.type === "text" ? "文本" : "图片"} · {slot.occurrences.length} 处
                            </Text>
                          </div>
                          <Badge variant="light">{slot.required ? "必填" : "可选"}</Badge>
                        </Group>
                      </UnstyledButton>
                    ))}
                  </Stack>
                )}
              </Stack>
            </Paper>

            <Paper p="lg" radius="lg" withBorder>
              <Stack gap="md">
                <Title order={4}>槽位设置</Title>

                {!activeSlot ? (
                  <Text c="dimmed" size="sm">
                    点击预览高亮内容或槽位列表后可编辑。
                  </Text>
                ) : (
                  <Stack gap="md">
                    <TextInput
                      label="槽位名称"
                      value={activeSlotName}
                      onChange={(event) => setActiveSlotName(event.currentTarget.value)}
                    />

                    <Checkbox
                      checked={activeSlotRequired}
                      label="必填槽位"
                      onChange={(event) => setActiveSlotRequired(event.currentTarget.checked)}
                    />

                    {activeSlot.type === "text" ? (
                      <TextInput
                        label="默认值"
                        value={activeSlotDefaultValue}
                        onChange={(event) => setActiveSlotDefaultValue(event.currentTarget.value)}
                      />
                    ) : null}

                    <Group gap="sm">
                      <Button onClick={handleSaveActiveSlot}>更新槽位</Button>
                      <Button variant="default" onClick={() => handleDeleteSlot(activeSlot.id)}>
                        删除槽位
                      </Button>
                    </Group>

                    {focusedOccurrenceId ? (
                      <Button variant="subtle" onClick={handleDeleteOccurrence}>
                        删除当前选中的出现位置
                      </Button>
                    ) : null}
                  </Stack>
                )}
              </Stack>
            </Paper>
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
