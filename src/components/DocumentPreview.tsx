import type { ReactNode } from "react";
import type {
  DocBlock,
  DocSegment,
  ImageSegment,
  ParsedDocument,
  Slot,
  TextSegment,
  TextStyleSnapshot,
} from "../types";

interface DocumentPreviewProps {
  document: ParsedDocument | null;
  slots: Slot[];
  activeSlotId?: string | null;
  focusedOccurrenceId?: string | null;
  onCreateTextSelection: (segment: TextSegment, startOffset: number, endOffset: number) => void;
  onPickImage: (segment: ImageSegment) => void;
  onSelectSlotOccurrence: (slotId: string, occurrenceId?: string) => void;
}

interface TextDecoration {
  slotId: string;
  occurrenceId: string;
  slotName: string;
  start: number;
  end: number;
}

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

function collectTextDecorations(slots: Slot[]) {
  const map = new Map<string, TextDecoration[]>();

  slots.forEach((slot) => {
    slot.occurrences.forEach((occurrence) => {
      if (occurrence.kind !== "textRange") {
        return;
      }

      const key = locatorKey(
        occurrence.locator.path,
        occurrence.locator.childStart,
        occurrence.locator.childEnd,
      );
      const bucket = map.get(key) ?? [];
      bucket.push({
        slotId: slot.id,
        occurrenceId: occurrence.id,
        slotName: slot.name,
        start: occurrence.startOffset,
        end: occurrence.endOffset,
      });
      map.set(key, bucket);
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
        className={`slot-chip${isActive ? " is-active" : ""}`}
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
    <p className="doc-paragraph" style={{ textAlign: block.align }}>
      {block.segments.length === 0 ? <span className="doc-empty-line">&nbsp;</span> : null}
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
              className="doc-text-segment"
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
            className={`doc-image${isActive ? " is-active" : ""}`}
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
    <table className="doc-table">
      <tbody>
        {block.rows.map((row) => (
          <tr key={row.id}>
            {row.cells.map((cell) => (
              <td key={cell.id}>
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

    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (!anchorNode || !focusNode) {
      return;
    }

    const anchorElement =
      anchorNode.nodeType === Node.ELEMENT_NODE
        ? (anchorNode as Element)
        : anchorNode.parentElement;
    const focusElement =
      focusNode.nodeType === Node.ELEMENT_NODE
        ? (focusNode as Element)
        : focusNode.parentElement;

    const anchorSegment = anchorElement?.closest<HTMLElement>("[data-text-segment-id]");
    const focusSegment = focusElement?.closest<HTMLElement>("[data-text-segment-id]");

    if (!anchorSegment || !focusSegment || anchorSegment !== focusSegment) {
      return;
    }

    const segment = textSegmentIndex.get(anchorSegment.dataset.textSegmentId ?? "");
    if (!segment) {
      return;
    }

    const startOffset = offsetWithinSegment(anchorSegment, selection.anchorNode, selection.anchorOffset);
    const endOffset = offsetWithinSegment(anchorSegment, selection.focusNode, selection.focusOffset);
    const rangeStart = Math.min(startOffset, endOffset);
    const rangeEnd = Math.max(startOffset, endOffset);

    if (rangeEnd <= rangeStart) {
      return;
    }

    onCreateTextSelection(segment, rangeStart, rangeEnd);
    selection.removeAllRanges();
  };

  if (!document) {
    return (
      <div className="preview-empty-state">
        <h3>先上传一个 .docx 模板</h3>
        <p>解析完成后，这里会显示可选中文本和占位图片。</p>
      </div>
    );
  }

  return (
    <div className="document-preview" onMouseUp={handleMouseUp}>
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
