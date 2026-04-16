import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Collapse,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { downloadBlob, downloadFilesAsZip } from "../lib/download";
import { showErrorNotification } from "../lib/notifications";
import { formatDateTime } from "../lib/time";
import type { ArtifactRecord, TaskRecord, TaskStatus } from "../types";

interface TaskBundle {
  task: TaskRecord;
  artifacts: ArtifactRecord[];
}

interface TaskCenterProps {
  tasks: TaskBundle[];
  onDeleteTask: (taskId: string) => void;
}

function statusColor(status: TaskStatus) {
  switch (status) {
    case "completed":
      return "green";
    case "partial_failed":
      return "yellow";
    case "failed":
      return "red";
    default:
      return "gray";
  }
}

function statusLabel(status: TaskStatus) {
  switch (status) {
    case "completed":
      return "已完成";
    case "partial_failed":
      return "部分失败";
    case "failed":
      return "失败";
    case "running":
      return "处理中";
    case "ready":
      return "就绪";
    default:
      return "草稿";
  }
}

export function TaskCenter(props: TaskCenterProps) {
  const { tasks, onDeleteTask } = props;
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [downloadingTaskId, setDownloadingTaskId] = useState<string | null>(null);
  const sorted = useMemo(
    () =>
      [...tasks].sort(
        (left, right) =>
          new Date(right.task.createdAt).getTime() - new Date(left.task.createdAt).getTime(),
      ),
    [tasks],
  );

  async function handleDownloadAllFiles(task: TaskRecord, artifacts: ArtifactRecord[]) {
    if (artifacts.length === 0) {
      return;
    }

    setDownloadingTaskId(task.id);

    try {
      await downloadFilesAsZip(
        artifacts.map((artifact) => ({
          fileName: artifact.fileName,
          blob: artifact.blob,
        })),
        `${task.folderName}-全部文件`,
      );
    } catch (reason) {
      showErrorNotification(
        "下载失败",
        reason instanceof Error ? reason.message : "任务文件打包下载失败。",
      );
    } finally {
      setDownloadingTaskId((current) => (current === task.id ? null : current));
    }
  }

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Text c="dimmed" fw={700} size="xs" tt="uppercase">
          任务归档
        </Text>
        <Title order={2}>任务中心</Title>
        <Text c="dimmed">查看历史批量生成任务，成功任务可直接下载文档，失败任务可直接查看具体出错行。</Text>
      </Stack>

      {sorted.length === 0 ? (
        <Paper p="xl" radius="lg" withBorder>
          <Text c="dimmed">还没有历史任务。先去“批量生成”里创建一个任务。</Text>
        </Paper>
      ) : (
        <Stack gap="md">
          {sorted.map(({ task, artifacts }) => {
            const isExpanded = expandedTaskId === task.id;
            const docxArtifacts = artifacts.filter((artifact) => artifact.kind === "docx");
            const taskErrors = task.errors ?? [];
            const displayTaskName = task.folderName.replace(/^task-/, "任务-");

            return (
              <Paper key={task.id} p="lg" radius="lg" withBorder>
                <Stack gap="md">
                  <Group align="flex-start" justify="space-between" wrap="wrap">
                    <div>
                      <Group gap="sm" wrap="wrap">
                        <Title order={4}>{displayTaskName}</Title>
                        <Badge color={statusColor(task.status)} variant="light">
                          {statusLabel(task.status)}
                        </Badge>
                      </Group>
                      <Text c="dimmed" mt={4} size="sm">
                        {task.templateName} · 版本 {task.templateVersion}
                      </Text>
                    </div>

                    <Group gap="sm">
                      <Button
                        disabled={artifacts.length === 0}
                        loading={downloadingTaskId === task.id}
                        variant="default"
                        onClick={() => {
                          void handleDownloadAllFiles(task, artifacts);
                        }}
                      >
                        下载全部
                      </Button>
                      <Button
                        variant="default"
                        onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                      >
                        {isExpanded ? "收起" : "查看详情"}
                      </Button>
                      <Button color="red" variant="filled" onClick={() => onDeleteTask(task.id)}>
                        删除任务
                      </Button>
                    </Group>
                  </Group>

                  <SimpleGrid cols={{ base: 2, md: 5 }} spacing="sm">
                    <Paper p="sm" radius="md" withBorder>
                      <Stack gap={4}>
                        <Text c="dimmed" size="xs">
                          数据行
                        </Text>
                        <Text ff="monospace" fw={700}>
                          {task.summary.rowCount}
                        </Text>
                      </Stack>
                    </Paper>
                    <Paper p="sm" radius="md" withBorder>
                      <Stack gap={4}>
                        <Text c="dimmed" size="xs">
                          成功
                        </Text>
                        <Text ff="monospace" fw={700}>
                          {task.summary.successCount}
                        </Text>
                      </Stack>
                    </Paper>
                    <Paper p="sm" radius="md" withBorder>
                      <Stack gap={4}>
                        <Text c="dimmed" size="xs">
                          失败
                        </Text>
                        <Text ff="monospace" fw={700}>
                          {task.summary.failedCount}
                        </Text>
                      </Stack>
                    </Paper>
                    <Paper p="sm" radius="md" withBorder>
                      <Stack gap={4}>
                        <Text c="dimmed" size="xs">
                          开始时间
                        </Text>
                        <Text size="sm">{formatDateTime(task.startedAt)}</Text>
                      </Stack>
                    </Paper>
                    <Paper p="sm" radius="md" withBorder>
                      <Stack gap={4}>
                        <Text c="dimmed" size="xs">
                          完成时间
                        </Text>
                        <Text size="sm">{formatDateTime(task.finishedAt)}</Text>
                      </Stack>
                    </Paper>
                  </SimpleGrid>

                  <Collapse in={isExpanded}>
                    <Stack gap="sm" mt="sm">
                      {docxArtifacts.map((artifact) => (
                        <UnstyledButton
                          key={artifact.id}
                          className="block w-full rounded-md border border-[var(--mantine-color-dark-4)] bg-white/[0.02] px-4 py-3 text-left transition hover:-translate-y-px hover:border-[var(--mantine-color-dark-2)] hover:bg-white/5"
                          onClick={() => downloadBlob(artifact.blob, artifact.fileName)}
                        >
                          <Group align="center" justify="space-between" wrap="nowrap">
                            <div className="grid min-w-0 gap-1">
                              <Text fw={600}>文档</Text>
                              <Text c="dimmed" size="sm">
                                {artifact.fileName}
                              </Text>
                            </div>
                            <Text c="dimmed" ff="monospace" size="sm">
                              {Math.max(1, Math.round(artifact.size / 1024))} KB
                            </Text>
                          </Group>
                        </UnstyledButton>
                      ))}

                      {taskErrors.length > 0 ? (
                        <Stack gap="sm">
                          {taskErrors.map((error, index) => (
                            <Alert
                              key={`${task.id}-${error.rowNumber}-${index}`}
                              color="red"
                              title={error.rowNumber > 0 ? `第 ${error.rowNumber} 行` : "任务级错误"}
                              variant="light"
                            >
                              {error.fileName ? `${error.fileName} · ${error.message}` : error.message}
                            </Alert>
                          ))}
                        </Stack>
                      ) : null}

                      {docxArtifacts.length === 0 && taskErrors.length === 0 ? (
                        <Text c="dimmed" size="sm">
                          当前任务还没有可下载文档或错误明细。
                        </Text>
                      ) : null}
                    </Stack>
                  </Collapse>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
