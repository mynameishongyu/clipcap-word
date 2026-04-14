import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Container,
  Grid,
  Group,
  NavLink,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { useLiveQuery } from "dexie-react-hooks";
import { GeneratorWorkspace, type TemplateBundle } from "./components/GeneratorWorkspace";
import { TaskCenter } from "./components/TaskCenter";
import { TemplateEditor } from "./components/TemplateEditor";
import { db } from "./db";
import { downloadBlob } from "./lib/download";
import { showErrorNotification, showSuccessNotification } from "./lib/notifications";
import {
  clearAllHistoryData,
  deleteTask,
  deleteTemplate,
  duplicateTemplate,
} from "./lib/repository";
import { formatDateTime } from "./lib/time";
import { createTemplateWorkbookFileName, exportTemplateWorkbook } from "./lib/xlsx";

type View = "templates" | "generate" | "tasks";

const VIEW_META: Record<
  View,
  {
    eyebrow: string;
    title: string;
    description: string;
    navLabel: string;
    navCaption: string;
  }
> = {
  templates: {
    eyebrow: "模板治理",
    title: "模板资产控制台",
    description: "维护版本化模板、标注槽位，并让后续任务始终指向可追溯的模板版本。",
    navLabel: "模板管理",
    navCaption: "维护模板版本与槽位",
  },
  generate: {
    eyebrow: "批量处理",
    title: "批量生成工作台",
    description: "导入结构化数据与图片资源，在本地浏览器内完成校验、替换、生成和归档。",
    navLabel: "批量生成",
    navCaption: "导入数据并创建任务",
  },
  tasks: {
    eyebrow: "任务审计",
    title: "任务与产物中心",
    description: "集中查看历史任务、下载交付文件，并清理不再需要的本地产物。",
    navLabel: "任务中心",
    navCaption: "审计任务状态与产物",
  },
};

function confirmAction(
  title: string,
  message: string,
  onConfirm: () => void,
  options?: { destructive?: boolean },
) {
  modals.openConfirmModal({
    title,
    centered: true,
    labels: {
      confirm: "确认",
      cancel: "取消",
    },
    cancelProps: {
      variant: "default",
    },
    confirmProps: options?.destructive
      ? {
          color: "red",
          variant: "filled",
        }
      : {
          variant: "white",
        },
    children: (
      <Text c="dimmed" size="sm">
        {message}
      </Text>
    ),
    onConfirm,
  });
}

function DashboardMetricCard(props: {
  label: string;
  value: string | number;
  description: string;
  compactValue?: boolean;
}) {
  const { label, value, description, compactValue = false } = props;

  return (
    <Paper className="min-h-[164px]" p="lg" radius="lg" withBorder>
      <Stack gap={8}>
        <Text c="dimmed" fw={700} size="xs" tt="uppercase">
          {label}
        </Text>
        <Text className="break-words leading-none" ff="monospace" fw={700} size={compactValue ? "lg" : "xl"}>
          {value}
        </Text>
        <Text c="dimmed" size="sm">
          {description}
        </Text>
      </Stack>
    </Paper>
  );
}

export function TemplateBoard(props: {
  templates: TemplateBundle[];
  onCreate: () => void;
  onEdit: (versionId: string) => void;
  onDuplicate: (templateId: string) => void;
  onDelete: (templateId: string) => void;
  onDownload: (versionId: string) => void;
}) {
  const { templates, onCreate, onEdit, onDuplicate, onDelete, onDownload } = props;

  return (
    <Stack gap="lg">
      <Group align="flex-end" justify="space-between" wrap="wrap">
        <Stack gap={4}>
          <Text c="dimmed" fw={700} size="xs" tt="uppercase">
            模板资源库
          </Text>
          <Title order={2}>模板管理</Title>
          <Text c="dimmed" maw={760}>
            上传 `.docx` 后在线打槽位，模板按版本保存，历史任务始终绑定到具体版本。
          </Text>
        </Stack>
        <Button onClick={onCreate}>新建模板</Button>
      </Group>

      {templates.length === 0 ? (
        <Paper p="xl" radius="lg" withBorder>
          <Text c="dimmed">
            还没有模板。先上传一个 `.docx`，然后在预览区选中文本或图片来创建槽位。
          </Text>
        </Paper>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
          {templates.map(({ template, version }) => (
            <Paper key={template.id} p="lg" radius="lg" withBorder>
              <Stack gap="md">
                <Group align="flex-start" justify="space-between" wrap="nowrap">
                  <div>
                    <Badge variant="light">版本 {template.currentVersion}</Badge>
                    <Title mt="sm" order={4}>
                      {template.name}
                    </Title>
                  </div>
                  <Badge variant="default">{template.slotCount} 个槽位</Badge>
                </Group>

                <Stack gap="xs">
                  <Group justify="space-between" wrap="nowrap">
                    <Text c="dimmed" size="sm">
                      源文件
                    </Text>
                    <Text maw={220} size="sm" ta="right">
                      {version.sourceDocxName}
                    </Text>
                  </Group>
                  <Group justify="space-between" wrap="nowrap">
                    <Text c="dimmed" size="sm">
                      更新时间
                    </Text>
                    <Text size="sm">{formatDateTime(template.updatedAt)}</Text>
                  </Group>
                  <Group justify="space-between" wrap="nowrap">
                    <Text c="dimmed" size="sm">
                      最近使用
                    </Text>
                    <Text size="sm">{formatDateTime(template.lastUsedAt)}</Text>
                  </Group>
                </Stack>

                <Group gap="sm">
                  <Button onClick={() => onEdit(version.id)}>编辑模板</Button>
                  <Button variant="default" onClick={() => onDownload(version.id)}>
                    下载模板表格
                  </Button>
                  <Button variant="default" onClick={() => onDuplicate(template.id)}>
                    复制
                  </Button>
                  <Button color="red" variant="filled" onClick={() => onDelete(template.id)}>
                    删除
                  </Button>
                </Group>
              </Stack>
            </Paper>
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState<View>("templates");
  const [editingVersionId, setEditingVersionId] = useState<string | "new" | null>(null);
  const [isClearingHistory, setIsClearingHistory] = useState(false);

  const templates = useLiveQuery(async () => {
    const templateRows = await db.templates.orderBy("updatedAt").reverse().toArray();
    const latestVersions = await Promise.all(
      templateRows.map((template) => db.templateVersions.get(template.latestVersionId)),
    );

    return templateRows.flatMap((template, index) => {
      const version = latestVersions[index];
      return version ? [{ template, version }] : [];
    });
  }, []) ?? [];

  const tasks = useLiveQuery(async () => {
    const taskRows = await db.tasks.orderBy("createdAt").reverse().toArray();
    const artifactRows = await db.artifacts.toArray();

    return taskRows.map((task) => ({
      task,
      artifacts: artifactRows.filter((artifact) => artifact.taskId === task.id),
    }));
  }, []) ?? [];

  const editingVersion =
    useLiveQuery(
      async () =>
        editingVersionId && editingVersionId !== "new"
          ? db.templateVersions.get(editingVersionId)
          : null,
      [editingVersionId],
    ) ?? null;

  const stats = useMemo(
    () => ({
      templateCount: templates.length,
      taskCount: tasks.length,
      artifactCount: tasks.reduce((count, task) => count + task.artifacts.length, 0),
    }),
    [tasks, templates.length],
  );

  async function handleDuplicate(templateId: string) {
    try {
      await duplicateTemplate(templateId);
      showSuccessNotification("复制成功", "模板已复制为新版本。");
    } catch (reason) {
      showErrorNotification(
        "复制失败",
        reason instanceof Error ? reason.message : "复制模板失败。",
      );
    }
  }

  async function handleDeleteTemplate(templateId: string) {
    try {
      await deleteTemplate(templateId);
      showSuccessNotification("删除成功", "模板已删除。");
    } catch (reason) {
      showErrorNotification(
        "删除失败",
        reason instanceof Error ? reason.message : "模板删除失败。",
      );
    }
  }

  async function handleDeleteTask(taskId: string) {
    try {
      await deleteTask(taskId);
      showSuccessNotification("删除成功", "任务已删除。");
    } catch (reason) {
      showErrorNotification(
        "删除失败",
        reason instanceof Error ? reason.message : "任务删除失败。",
      );
    }
  }

  async function handleClearHistory() {
    setIsClearingHistory(true);

    try {
      await clearAllHistoryData();
      setEditingVersionId(null);
      setActiveView("templates");
      showSuccessNotification("清除成功", "缓存数据已清除。");
    } catch (reason) {
      showErrorNotification(
        "清除失败",
        reason instanceof Error ? reason.message : "清除缓存数据失败。",
      );
    } finally {
      setIsClearingHistory(false);
    }
  }

  async function handleDownloadTemplateWorkbook(versionId: string) {
    try {
      const version =
        templates.find((bundle) => bundle.version.id === versionId)?.version ??
        (await db.templateVersions.get(versionId));

      if (!version) {
        throw new Error("找不到要下载的模板版本。");
      }

      downloadBlob(
        exportTemplateWorkbook(version),
        createTemplateWorkbookFileName(version.name),
      );
    } catch (reason) {
      showErrorNotification(
        "下载失败",
        reason instanceof Error ? reason.message : "模板表格下载失败。",
      );
    }
  }

  const currentTemplateVersion =
    editingVersionId === "new"
      ? null
      : templates.find((bundle) => bundle.version.id === editingVersionId)?.version ?? editingVersion;

  const latestTask = tasks[0]?.task ?? null;
  const currentViewMeta = VIEW_META[activeView];

  return (
    <Container className="min-h-screen" fluid px={{ base: "md", md: "xl" }} py="xl">
      <Grid align="start" gutter="lg">
        <Grid.Col span={{ base: 12, lg: 3 }}>
          <Stack className="lg:sticky lg:top-6" gap="lg">
            <Paper p="md" radius="lg" withBorder>
              <Stack gap="xs">
                <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                  工作区
                </Text>
                {(Object.entries(VIEW_META) as Array<[View, (typeof VIEW_META)[View]]>).map(
                  ([view, meta]) => (
                    <NavLink
                      className="rounded-md"
                      key={view}
                      active={activeView === view}
                      description={meta.navCaption}
                      label={meta.navLabel}
                      onClick={() => {
                        setActiveView(view);
                        setEditingVersionId(null);
                      }}
                    />
                  ),
                )}
              </Stack>
            </Paper>

            <Paper p="md" radius="lg" withBorder>
              <Stack gap="md">
                <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                  本地缓存
                </Text>

                <div className="divide-y divide-[var(--mantine-color-dark-4)]">
                  <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0">
                    <Text c="dimmed" size="sm">
                      模板
                    </Text>
                    <Text ff="monospace" fw={700}>
                      {stats.templateCount}
                    </Text>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-2.5">
                    <Text c="dimmed" size="sm">
                      任务
                    </Text>
                    <Text ff="monospace" fw={700}>
                      {stats.taskCount}
                    </Text>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-2.5 last:pb-0">
                    <Text c="dimmed" size="sm">
                      产物
                    </Text>
                    <Text ff="monospace" fw={700}>
                      {stats.artifactCount}
                    </Text>
                  </div>
                </div>

                <Button
                  fullWidth
                  color="red"
                  loading={isClearingHistory}
                  variant="filled"
                  onClick={() =>
                    confirmAction(
                      "清除缓存数据",
                      "这会清空当前浏览器中的模板、版本、数据集、任务和产物，且无法恢复。",
                      () => {
                        void handleClearHistory();
                      },
                      { destructive: true },
                    )
                  }
                >
                  清除缓存数据
                </Button>
              </Stack>
            </Paper>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 9 }}>
          <Stack gap="lg">
            <Stack gap={4}>
              <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                {currentViewMeta.eyebrow}
              </Text>
              <Title order={1}>{currentViewMeta.title}</Title>
              <Text c="dimmed" maw={840}>
                {currentViewMeta.description}
              </Text>
            </Stack>

            <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }} spacing="md">
              <DashboardMetricCard
                description="已登记的模板版本集合，支持复制和持续迭代。"
                label="模板资产"
                value={stats.templateCount}
              />
              <DashboardMetricCard
                description="本地保留历史批处理任务，便于追踪结果和回溯版本。"
                label="任务归档"
                value={stats.taskCount}
              />
              <DashboardMetricCard
                description="成功生成的本地 docx 文件，可按任务逐个下载和留存。"
                label="可下载产物"
                value={stats.artifactCount}
              />
              <DashboardMetricCard
                compactValue
                description="所有解析、替换和归档都在当前设备内完成，不依赖远程处理链路。"
                label="最近活动"
                value={latestTask ? formatDateTime(latestTask.createdAt) : "暂无任务"}
              />
            </SimpleGrid>

            {activeView === "templates" && editingVersionId !== null ? (
              <TemplateEditor
                initialVersion={currentTemplateVersion}
                onCancel={() => setEditingVersionId(null)}
                onSaved={() => {
                  setEditingVersionId(null);
                  setActiveView("templates");
                }}
              />
            ) : null}

            {activeView === "templates" && editingVersionId === null ? (
              <TemplateBoard
                templates={templates}
                onCreate={() => setEditingVersionId("new")}
                onDelete={(templateId) =>
                  confirmAction(
                    "删除模板",
                    "删除模板后，历史任务仍会保留。确认继续吗？",
                    () => {
                      void handleDeleteTemplate(templateId);
                    },
                    { destructive: true },
                  )
                }
                onDuplicate={(templateId) => {
                  void handleDuplicate(templateId);
                }}
                onDownload={(versionId) => {
                  void handleDownloadTemplateWorkbook(versionId);
                }}
                onEdit={(versionId) => setEditingVersionId(versionId)}
              />
            ) : null}

            {activeView === "generate" ? (
              <GeneratorWorkspace
                templates={templates}
                onTaskCreated={() => {
                  setActiveView("tasks");
                }}
              />
            ) : null}

            {activeView === "tasks" ? (
              <TaskCenter
                onDeleteTask={(taskId) =>
                  confirmAction(
                    "删除任务",
                    "确认删除这个任务和它的本地产物吗？",
                    () => {
                      void handleDeleteTask(taskId);
                    },
                    { destructive: true },
                  )
                }
                tasks={tasks}
              />
            ) : null}
          </Stack>
        </Grid.Col>
      </Grid>
    </Container>
  );
}
