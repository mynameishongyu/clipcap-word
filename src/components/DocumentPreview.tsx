import type { ReactNode } from "react";
import type {
  DocBlock,
  DocSegment,
  ImageSegment,
  ParsedDocument,
  Slot,
  TextSelectionDraft,
  TextSegment,
  TextSlotOccurrence,
  TextStyleSnapshot,
} from "../types";

interface DocumentPreviewProps {
  document: ParsedDocument | null;
  slots: Slot[];
  activeSlotId?: string | null;
  focusedOccurrenceId?: string | null;
  onCreateTextSelection: (selection: TextSelectionDraft) => void;
  onPickImage: (segment: ImageSegment) => void;
  onSelectSlotOccurrence: (slotId: string, occurrenceId?: string) => void;
  onSelectionRejected?: (message: string) => void;
}

interface TextDecoration {
  slotId: string;
  occurrenceId: string;
  slotName: string;
  start: number;
  end: number;
}

const previewContainerClassName =
  "max-h-[760px] overflow-auto rounded-lg border border-[var(--mantine-color-dark-4)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(247,247,248,0.98)),linear-gradient(90deg,transparent_71px,rgba(134,142,150,0.08)_72px,transparent_73px)] p-[clamp(18px,2vw,28px)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]";
const previewEmptyStateClassName =
  "grid min-h-[260px] place-content-center gap-2 rounded-lg border border-dashed border-[var(--mantine-color-dark-4)] bg-white/3 p-[clamp(18px,2vw,28px)] text-center";
const paragraphClassName = "mb-3 min-h-6 leading-[1.65] text-[#111827]";
const slotChipBaseClassName =
  "cursor-pointer rounded-lg bg-[rgba(206,212,218,0.88)] shadow-[inset_0_-1px_0_rgba(73,80,87,0.16)]";
const slotChipActiveClassName = "bg-[rgba(173,181,189,0.98)]";
const docImageBaseClassName =
  "mx-1 inline-flex items-center justify-center rounded-[10px] border border-[rgba(173,181,189,0.9)] bg-white p-1.5 transition";
const docImageActiveClassName =
  "border-[rgba(73,80,87,0.9)] shadow-[0_0_0_1px_rgba(73,80,87,0.2)]";
const docTableClassName = "w-full border-collapse";
const docTableCellClassName = "border border-[rgba(206,212,218,0.88)] p-2.5 align-top text-[#111827]";

function textStyleToCss(style: TextStyleSnapshot) {
  return {
    fontWeight: style.bold ? 700 : undefined,
    fontStyle: style.italic ? "italic" : undefined,
    textDecoration: style.underline ? "underline" : undefined,
    color: style.color,
    backgroundColor: style.backgroundColor,
    fontSize: style.fontSizePt ? `${style.fontSizePt}pt` : undefined,
    fontFamily: style.fontFamily,
    whiteSpace: "pre-wrap" as const,
  };
}

function locatorKey(path: number[], childStart?: number, childEnd?: number) {
  return `${path.join(".")}:${childStart ?? ""}:${childEnd ?? ""}`;
}

function occurrenceFragments(occurrence: TextSlotOccurrence) {
  return occurrence.fragments?.length
    ? occurrence.fragments
    : [
        {
          locator: occurrence.locator,
          startOffset: occurrence.startOffset,
          endOffset: occurrence.endOffset,
          originalSegmentText: occurrence.originalSegmentText,
        },
      ];
}

function collectTextDecorations(slots: Slot[]) {
  const map = new Map<string, TextDecoration[]>();

  slots.forEach((slot) => {
    slot.occurrences.forEach((occurrence) => {
      if (occurrence.kind !== "textRange") {
        return;
      }

      occurrenceFragments(occurrence).forEach((fragment) => {
        const key = locatorKey(
          fragment.locator.path,
          fragment.locator.childStart,
          fragment.locator.childEnd,
        );
        const bucket = map.get(key) ?? [];
        bucket.push({
          slotId: slot.id,
          occurrenceId: occurrence.id,
          slotName: slot.name,
          start: fragment.startOffset,
          end: fragment.endOffset,
        });
        map.set(key, bucket);
      });
    });
  });

  map.forEach((decorations, key) => {
    map.set(
      key,
      [...decorations].sort((left, right) => left.start - right.start),
    );
  });

  return map;
}

function collectImageDecorations(slots: Slot[]) {
  const map = new Map<string, { slotId: string; occurrenceId: string; slotName: string }>();

  slots.forEach((slot) => {
    slot.occurrences.forEach((occurrence) => {
      if (occurrence.kind !== "imageNode") {
        return;
      }

      map.set(locatorKey(occurrence.locator.path), {
        slotId: slot.id,
        occurrenceId: occurrence.id,
        slotName: slot.name,
      });
    });
  });

  return map;
}

function offsetWithinSegment(root: HTMLElement, node: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

function renderTextContent(
  segment: TextSegment,
  decorations: TextDecoration[],
  activeSlotId: string | null | undefined,
  focusedOccurrenceId: string | null | undefined,
  onSelectSlotOccurrence: (slotId: string, occurrenceId?: string) => void,
) {
  if (decorations.length === 0) {
    return segment.text;
  }

  const pieces: ReactNode[] = [];
  let cursor = 0;

  decorations.forEach((decoration) => {
    if (cursor < decoration.start) {
      pieces.push(segment.text.slice(cursor, decoration.start));
    }

    const pieceText = segment.text.slice(decoration.start, decoration.end);
    const isActive = activeSlotId === decoration.slotId || focusedOccurrenceId === decoration.occurrenceId;
    pieces.push(
      <span
        key={decoration.occurrenceId}
        className={`${slotChipBaseClassName} ${isActive ? slotChipActiveClassName : ""}`}
        title={decoration.slotName}
        onClick={(event) => {
          event.stopPropagation();
          onSelectSlotOccurrence(decoration.slotId, decoration.occurrenceId);
        }}
      >
        {pieceText}
      </span>,
    );
    cursor = decoration.end;
  });

  if (cursor < segment.text.length) {
    pieces.push(segment.text.slice(cursor));
  }

  return pieces;
}

function PreviewParagraph({
  block,
  textDecorations,
  imageDecorations,
  activeSlotId,
  focusedOccurrenceId,
  onPickImage,
  onSelectSlotOccurrence,
}: {
  block: Extract<DocBlock, { type: "paragraph" }>;
  textDecorations: Map<string, TextDecoration[]>;
  imageDecorations: Map<string, { slotId: string; occurrenceId: string; slotName: string }>;
  activeSlotId?: string | null;
  focusedOccurrenceId?: string | null;
  onPickImage: (segment: ImageSegment) => void;
  onSelectSlotOccurrence: (slotId: string, occurrenceId?: string) => void;
}) {
  return (
    <p className={paragraphClassName} data-preview-block-id={block.id} style={{ textAlign: block.align }}>
      {block.segments.length === 0 ? <span className="inline-block min-h-6">&nbsp;</span> : null}
      {block.segments.map((segment) => {
        if (segment.type === "text") {
          const key = locatorKey(
            segment.locator.path,
            segment.locator.childStart,
            segment.locator.childEnd,
          );
          const decorations = textDecorations.get(key) ?? [];
          return (
            <span
              key={segment.id}
              className="whitespace-pre-wrap"
              data-text-segment-id={segment.id}
              style={textStyleToCss(segment.style)}
            >
              {renderTextContent(
                segment,
                decorations,
                activeSlotId,
                focusedOccurrenceId,
                onSelectSlotOccurrence,
              )}
            </span>
          );
        }

        const decoration = imageDecorations.get(locatorKey(segment.locator.path));
        const isActive =
          decoration &&
          (decoration.slotId === activeSlotId || decoration.occurrenceId === focusedOccurrenceId);

        return (
          <button
            key={segment.id}
            className={`${docImageBaseClassName} ${isActive ? docImageActiveClassName : "hover:border-[rgba(73,80,87,0.9)] hover:shadow-[0_0_0_1px_rgba(73,80,87,0.2)]"}`}
            title={decoration ? decoration.slotName : "点击创建图片槽位"}
            type="button"
            onClick={() => {
              if (decoration) {
                onSelectSlotOccurrence(decoration.slotId, decoration.occurrenceId);
              } else {
                onPickImage(segment);
              }
            }}
          >
            <img
              alt={segment.altText || "文档图片"}
              src={segment.src}
              style={{
                maxWidth: segment.style.widthPx ? `${segment.style.widthPx}px` : undefined,
                maxHeight: segment.style.heightPx ? `${segment.style.heightPx}px` : undefined,
              }}
            />
          </button>
        );
      })}
    </p>
  );
}

function PreviewTable(props: {
  block: Extract<DocBlock, { type: "table" }>;
  textDecorations: Map<string, TextDecoration[]>;
  imageDecorations: Map<string, { slotId: string; occurrenceId: string; slotName: string }>;
  activeSlotId?: string | null;
  focusedOccurrenceId?: string | null;
  onPickImage: (segment: ImageSegment) => void;
  onSelectSlotOccurrence: (slotId: string, occurrenceId?: string) => void;
}) {
  const {
    block,
    textDecorations,
    imageDecorations,
    activeSlotId,
    focusedOccurrenceId,
    onPickImage,
    onSelectSlotOccurrence,
  } = props;

  return (
    <table className={docTableClassName}>
      <tbody>
        {block.rows.map((row) => (
          <tr key={row.id}>
            {row.cells.map((cell) => (
              <td key={cell.id} className={docTableCellClassName}>
                <PreviewBlocks
                  blocks={cell.blocks}
                  textDecorations={textDecorations}
                  imageDecorations={imageDecorations}
                  activeSlotId={activeSlotId}
                  focusedOccurrenceId={focusedOccurrenceId}
                  onPickImage={onPickImage}
                  onSelectSlotOccurrence={onSelectSlotOccurrence}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PreviewBlocks(props: {
  blocks: DocBlock[];
  textDecorations: Map<string, TextDecoration[]>;
  imageDecorations: Map<string, { slotId: string; occurrenceId: string; slotName: string }>;
  activeSlotId?: string | null;
  focusedOccurrenceId?: string | null;
  onPickImage: (segment: ImageSegment) => void;
  onSelectSlotOccurrence: (slotId: string, occurrenceId?: string) => void;
}) {
  return (
    <>
      {props.blocks.map((block) =>
        block.type === "paragraph" ? (
          <PreviewParagraph
            key={block.id}
            block={block}
            textDecorations={props.textDecorations}
            imageDecorations={props.imageDecorations}
            activeSlotId={props.activeSlotId}
            focusedOccurrenceId={props.focusedOccurrenceId}
            onPickImage={props.onPickImage}
            onSelectSlotOccurrence={props.onSelectSlotOccurrence}
          />
        ) : (
          <PreviewTable
            key={block.id}
            block={block}
            textDecorations={props.textDecorations}
            imageDecorations={props.imageDecorations}
            activeSlotId={props.activeSlotId}
            focusedOccurrenceId={props.focusedOccurrenceId}
            onPickImage={props.onPickImage}
            onSelectSlotOccurrence={props.onSelectSlotOccurrence}
          />
        ),
      )}
    </>
  );
}

export function DocumentPreview(props: DocumentPreviewProps) {
  const {
    document,
    slots,
    activeSlotId,
    focusedOccurrenceId,
    onCreateTextSelection,
    onPickImage,
    onSelectSlotOccurrence,
    onSelectionRejected,
  } = props;

  const textDecorations = collectTextDecorations(slots);
  const imageDecorations = collectImageDecorations(slots);
  const textSegmentIndex = new Map<string, TextSegment>();

  const indexBlocks = (blocks: DocBlock[]) => {
    blocks.forEach((block) => {
      if (block.type === "paragraph") {
        block.segments.forEach((segment) => {
          if (segment.type === "text") {
            textSegmentIndex.set(segment.id, segment);
          }
        });
      }

      if (block.type === "table") {
        block.rows.forEach((row) => {
          row.cells.forEach((cell) => {
            indexBlocks(cell.blocks);
          });
        });
      }
    });
  };

  if (document) {
    indexBlocks(document.blocks);
  }

  const handleMouseUp = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }

    const range = selection.getRangeAt(0);
    const startNode = range.startContainer;
    const endNode = range.endContainer;
    if (!startNode || !endNode) {
      return;
    }

    const startElement =
      startNode.nodeType === Node.ELEMENT_NODE ? (startNode as Element) : startNode.parentElement;
    const endElement =
      endNode.nodeType === Node.ELEMENT_NODE ? (endNode as Element) : endNode.parentElement;

    const startSegment = startElement?.closest<HTMLElement>("[data-text-segment-id]");
    const endSegment = endElement?.closest<HTMLElement>("[data-text-segment-id]");

    if (!startSegment || !endSegment) {
      onSelectionRejected?.("当前选区不在可创建槽位的文本片段内。");
      return;
    }

    const startBlock = startSegment.closest<HTMLElement>("[data-preview-block-id]");
    const endBlock = endSegment.closest<HTMLElement>("[data-preview-block-id]");
    if (!startBlock || startBlock !== endBlock) {
      onSelectionRejected?.("当前选区跨越了多个段落或表格单元格，暂不支持。请在同一段落内选择。");
      return;
    }

    const selectedElements = Array.from(
      startBlock.querySelectorAll<HTMLElement>("[data-text-segment-id]"),
    ).filter((element) => {
      if (!(element.textContent ?? "").length) {
        return false;
      }

      try {
        return range.intersectsNode(element);
      } catch {
        return false;
      }
    });

    if (selectedElements.length === 0) {
      onSelectionRejected?.("当前选区无法映射到可创建槽位的文本片段。");
      return;
    }

    const fragments = selectedElements.flatMap((element) => {
      const segment = textSegmentIndex.get(element.dataset.textSegmentId ?? "");
      if (!segment) {
        return [];
      }

      const rawStart = element.contains(range.startContainer)
        ? offsetWithinSegment(element, range.startContainer, range.startOffset)
        : 0;
      const rawEnd = element.contains(range.endContainer)
        ? offsetWithinSegment(element, range.endContainer, range.endOffset)
        : segment.text.length;
      const startOffset = Math.max(0, Math.min(rawStart, segment.text.length));
      const endOffset = Math.max(startOffset, Math.min(rawEnd, segment.text.length));

      if (endOffset <= startOffset) {
        return [];
      }

      return [
        {
          segment,
          startOffset,
          endOffset,
        },
      ];
    });

    if (fragments.length === 0) {
      onSelectionRejected?.("请选择实际文本内容，不要只选空白字符或不可见标记。");
      return;
    }

    onCreateTextSelection({
      selectedText: fragments
        .map((fragment) => fragment.segment.text.slice(fragment.startOffset, fragment.endOffset))
        .join(""),
      fragments,
    });
    selection.removeAllRanges();
  };

  if (!document) {
    return (
      <div className={previewEmptyStateClassName}>
        <h3 className="m-0 text-base text-[var(--mantine-color-gray-0)]">先上传一个 .docx 模板</h3>
        <p className="m-0 text-[0.95rem] text-[var(--mantine-color-dimmed)]">
          解析完成后，这里会显示可选中文本和占位图片。
        </p>
      </div>
    );
  }

  return (
    <div className={previewContainerClassName} onMouseUp={handleMouseUp}>
      <PreviewBlocks
        blocks={document.blocks}
        textDecorations={textDecorations}
        imageDecorations={imageDecorations}
        activeSlotId={activeSlotId}
        focusedOccurrenceId={focusedOccurrenceId}
        onPickImage={onPickImage}
        onSelectSlotOccurrence={onSelectSlotOccurrence}
      />
    </div>
  );
}
