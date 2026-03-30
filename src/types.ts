export type SlotType = "text" | "image";
export type TaskStatus =
  | "draft"
  | "ready"
  | "running"
  | "completed"
  | "partial_failed"
  | "failed";
export type ArtifactKind = "docx" | "zip" | "error_csv";
export type ValidationScope = "template" | "dataset" | "row" | "artifact";
export type ValidationSeverity = "error" | "warning";

export interface TextStyleSnapshot {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  backgroundColor?: string;
  fontSizePt?: number;
  fontFamily?: string;
}

export interface ImageStyleSnapshot {
  widthPx?: number;
  heightPx?: number;
}

export interface TextLocator {
  path: number[];
  childStart: number;
  childEnd: number;
}

export interface TextSelectionFragment {
  locator: TextLocator;
  startOffset: number;
  endOffset: number;
  originalSegmentText: string;
}

export interface TextSelectionDraftFragment {
  segment: TextSegment;
  startOffset: number;
  endOffset: number;
}

export interface TextSelectionDraft {
  selectedText: string;
  fragments: TextSelectionDraftFragment[];
}

export interface ImageLocator {
  path: number[];
  relId: string;
  target: string;
}

export interface TextSlotOccurrence {
  id: string;
  slotId: string;
  kind: "textRange";
  locator: TextLocator;
  startOffset: number;
  endOffset: number;
  originalText: string;
  originalSegmentText: string;
  styleSnapshot: TextStyleSnapshot;
  fragments?: TextSelectionFragment[];
}

export interface ImageSlotOccurrence {
  id: string;
  slotId: string;
  kind: "imageNode";
  locator: ImageLocator;
  originalTarget: string;
  altText?: string;
  styleSnapshot: ImageStyleSnapshot;
}

export type SlotOccurrence = TextSlotOccurrence | ImageSlotOccurrence;

export interface Slot {
  id: string;
  name: string;
  type: SlotType;
  required: boolean;
  defaultValue?: string;
  occurrences: SlotOccurrence[];
}

export interface TemplateRecord {
  id: string;
  name: string;
  currentVersion: number;
  latestVersionId: string;
  slotCount: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface TemplateVersionRecord {
  id: string;
  templateId: string;
  name: string;
  version: number;
  sourceDocxBlob: Blob;
  sourceDocxName: string;
  slots: Slot[];
  createdAt: string;
}

export interface DatasetRowDraft {
  id: string;
  cells: string[];
}

export interface ImagePackEntry {
  id: string;
  name: string;
  normalizedName: string;
  blob: Blob;
  mimeType: string;
  size: number;
}

export interface DatasetDraft {
  id: string;
  name: string;
  sourceXlsxBlob: Blob;
  columns: string[];
  rows: DatasetRowDraft[];
  imagePackEntries: ImagePackEntry[];
  validationIssues: ValidationIssue[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskSummary {
  rowCount: number;
  successCount: number;
  failedCount: number;
  errorCount: number;
}

export interface TaskRecord {
  id: string;
  templateId: string;
  templateName: string;
  templateVersionId: string;
  templateVersion: number;
  datasetId: string;
  folderName: string;
  status: TaskStatus;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  summary: TaskSummary;
  errors?: GenerationRowError[];
}

export interface ArtifactRecord {
  id: string;
  taskId: string;
  kind: ArtifactKind;
  fileName: string;
  blob: Blob;
  size: number;
  createdAt: string;
}

export interface ValidationIssue {
  id: string;
  scope: ValidationScope;
  severity: ValidationSeverity;
  message: string;
  rowNumber?: number;
  slotName?: string;
}

export interface ParsedDocument {
  blocks: DocBlock[];
}

export type DocBlock = ParagraphBlock | TableBlock;

export interface ParagraphBlock {
  id: string;
  type: "paragraph";
  align?: "left" | "center" | "right" | "justify";
  segments: DocSegment[];
}

export interface TableBlock {
  id: string;
  type: "table";
  rows: TableRow[];
}

export interface TableRow {
  id: string;
  cells: TableCell[];
}

export interface TableCell {
  id: string;
  blocks: DocBlock[];
}

export type DocSegment = TextSegment | ImageSegment;

export interface TextSegment {
  id: string;
  type: "text";
  text: string;
  style: TextStyleSnapshot;
  locator: TextLocator;
}

export interface ImageSegment {
  id: string;
  type: "image";
  locator: ImageLocator;
  src: string;
  altText?: string;
  style: ImageStyleSnapshot;
}

export interface TemplateSelectionCandidate {
  type: "text" | "image";
  slotId?: string;
  occurrenceId?: string;
  selectedText?: string;
  textSegment?: TextSegment;
  textStart?: number;
  textEnd?: number;
  imageSegment?: ImageSegment;
}

export interface GenerationRowError {
  rowNumber: number;
  fileName: string;
  message: string;
}

export interface GenerationResult {
  status: TaskStatus;
  successFiles: Array<{ fileName: string; blob: Blob }>;
  errors: GenerationRowError[];
  summary: TaskSummary;
}
