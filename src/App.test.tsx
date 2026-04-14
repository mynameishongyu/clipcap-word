import { fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { describe, expect, it, vi } from "vitest";
import { TemplateBoard } from "./App";
import type { TemplateBundle } from "./components/GeneratorWorkspace";

function createTemplateBundle(): TemplateBundle {
  return {
    template: {
      id: "template_1",
      name: "借款合同",
      currentVersion: 2,
      latestVersionId: "version_2",
      slotCount: 2,
      createdAt: "2026-04-14T10:00:00.000Z",
      updatedAt: "2026-04-14T10:00:00.000Z",
      lastUsedAt: "2026-04-14T10:30:00.000Z",
    },
    version: {
      id: "version_2",
      templateId: "template_1",
      name: "借款合同",
      version: 2,
      sourceDocxBlob: new Blob(["docx"]),
      sourceDocxName: "loan.docx",
      createdAt: "2026-04-14T10:00:00.000Z",
      slots: [],
    },
  };
}

describe("TemplateBoard", () => {
  it("renders the download workbook action and forwards the version id", () => {
    const onDownload = vi.fn();

    render(
      <MantineProvider>
        <TemplateBoard
          templates={[createTemplateBundle()]}
          onCreate={() => {}}
          onDelete={() => {}}
          onDownload={onDownload}
          onDuplicate={() => {}}
          onEdit={() => {}}
        />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "下载模板表格" }));

    expect(onDownload).toHaveBeenCalledWith("version_2");
  });
});
