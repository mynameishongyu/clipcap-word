import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { describe, expect, it, vi } from "vitest";
import { TaskCenter } from "./TaskCenter";
import type { ArtifactRecord, TaskRecord } from "../types";

const { downloadFilesAsZip } = vi.hoisted(() => ({
  downloadFilesAsZip: vi.fn(() => Promise.resolve()),
}));

vi.mock("../lib/download", async () => {
  const actual = await vi.importActual<typeof import("../lib/download")>("../lib/download");
  return {
    ...actual,
    downloadFilesAsZip,
  };
});

function createTask(): TaskRecord {
  return {
    id: "task_1",
    templateId: "template_1",
    templateName: "仲裁申请书",
    templateVersionId: "template_version_1",
    templateVersion: 3,
    datasetId: "dataset_1",
    folderName: "task-20260416-120000",
    status: "completed",
    createdAt: "2026-04-16T04:00:00.000Z",
    startedAt: "2026-04-16T04:00:00.000Z",
    finishedAt: "2026-04-16T04:01:00.000Z",
    summary: {
      rowCount: 2,
      successCount: 2,
      failedCount: 0,
      errorCount: 0,
    },
    errors: [],
  };
}

function createArtifacts(): ArtifactRecord[] {
  return [
    {
      id: "artifact_1",
      taskId: "task_1",
      kind: "docx",
      fileName: "结果-1.docx",
      blob: new Blob(["1"]),
      size: 1,
      createdAt: "2026-04-16T04:01:00.000Z",
    },
    {
      id: "artifact_2",
      taskId: "task_1",
      kind: "docx",
      fileName: "结果-2.docx",
      blob: new Blob(["2"]),
      size: 1,
      createdAt: "2026-04-16T04:01:00.000Z",
    },
  ];
}

describe("TaskCenter", () => {
  it("downloads all files for the selected task", async () => {
    downloadFilesAsZip.mockClear();

    render(
      <MantineProvider>
        <TaskCenter
          tasks={[
            {
              task: createTask(),
              artifacts: createArtifacts(),
            },
          ]}
          onDeleteTask={() => {}}
        />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "下载全部" }));

    await waitFor(() => {
      expect(downloadFilesAsZip).toHaveBeenCalledWith(
        [
          {
            fileName: "结果-1.docx",
            blob: expect.any(Blob),
          },
          {
            fileName: "结果-2.docx",
            blob: expect.any(Blob),
          },
        ],
        "task-20260416-120000-全部文件",
      );
    });
  });
});
