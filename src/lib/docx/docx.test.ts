import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { blobToArrayBuffer } from "../blob";
import { generateDocuments } from "./generate";
import { parseDocx, releaseParsedDocument } from "./parse";
import type { DatasetDraft, ImageSegment, TemplateVersionRecord, TextSegment } from "../../types";

async function createSampleDocx() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p>
      <w:r>
        <w:t>Hello Alice</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:inline>
            <wp:extent cx="952500" cy="476250"/>
            <wp:docPr id="1" name="Avatar"/>
            <a:graphic>
              <a:graphicData>
                <pic:pic>
                  <pic:blipFill>
                    <a:blip r:embed="rId1"/>
                  </pic:blipFill>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>
  </w:body>
</w:document>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`,
  );
  zip.file("word/media/image1.png", new Uint8Array([1, 2, 3]));

  const bytes = await zip.generateAsync({ type: "uint8array" });
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([arrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

async function createRevisionAwareDocx() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p>
      <w:r>
        <w:t>应用</w:t>
        <w:commentReference w:id="0"/>
        <w:t>场景</w:t>
      </w:r>
      <w:bookmarkStart w:id="1" w:name="bookmark_1"/>
      <w:r>
        <w:t>建设</w:t>
      </w:r>
      <w:bookmarkEnd w:id="1"/>
      <w:ins w:id="2" w:author="tester" w:date="2026-03-17T00:00:00Z">
        <w:r>
          <w:t>方案</w:t>
        </w:r>
      </w:ins>
      <w:del w:id="3" w:author="tester" w:date="2026-03-17T00:00:00Z">
        <w:r>
          <w:delText>废弃文本</w:delText>
        </w:r>
      </w:del>
    </w:p>
  </w:body>
</w:document>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
  );

  const bytes = await zip.generateAsync({ type: "uint8array" });
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([arrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

function paragraphText(block: { type: "paragraph"; segments: Array<TextSegment | ImageSegment> }) {
  return block.segments
    .filter((segment): segment is TextSegment => segment.type === "text")
    .map((segment) => segment.text)
    .join("");
}

describe("docx flow", () => {
  it("parses a docx and generates a new docx with text and image replacements", async () => {
    const docxBlob = await createSampleDocx();
    const parsed = await parseDocx(docxBlob);

    const firstParagraph = parsed.blocks[0];
    const secondParagraph = parsed.blocks[1];
    expect(firstParagraph.type).toBe("paragraph");
    expect(secondParagraph.type).toBe("paragraph");

    const textSegment =
      firstParagraph.type === "paragraph" ? (firstParagraph.segments[0] as TextSegment) : null;
    const imageSegment =
      secondParagraph.type === "paragraph" ? (secondParagraph.segments[0] as ImageSegment) : null;

    expect(textSegment?.type).toBe("text");
    expect(imageSegment?.type).toBe("image");

    const template: TemplateVersionRecord = {
      id: "template_version_1",
      templateId: "template_1",
      name: "Offer Letter",
      version: 1,
      sourceDocxBlob: docxBlob,
      sourceDocxName: "offer.docx",
      createdAt: new Date().toISOString(),
      slots: [
        {
          id: "slot_text",
          name: "name",
          type: "text",
          required: true,
          occurrences: [
            {
              id: "occ_text",
              slotId: "slot_text",
              kind: "textRange",
              locator: textSegment!.locator,
              startOffset: 6,
              endOffset: 11,
              originalText: "Alice",
              originalSegmentText: textSegment!.text,
              styleSnapshot: textSegment!.style,
            },
          ],
        },
        {
          id: "slot_image",
          name: "avatar",
          type: "image",
          required: true,
          occurrences: [
            {
              id: "occ_image",
              slotId: "slot_image",
              kind: "imageNode",
              locator: imageSegment!.locator,
              originalTarget: imageSegment!.locator.target,
              altText: imageSegment!.altText,
              styleSnapshot: imageSegment!.style,
            },
          ],
        },
      ],
    };

    const dataset: DatasetDraft = {
      id: "dataset_1",
      name: "users",
      sourceXlsxBlob: new Blob(["placeholder"]),
      columns: ["name", "avatar", "file_name"],
      rows: [{ id: "row_1", cells: ["Bob", "avatar.png", "offer-bob"] }],
      imagePackEntries: [
        {
          id: "image_1",
          name: "avatar.png",
          normalizedName: "avatar.png",
          blob: new Blob([new Uint8Array([9, 8, 7])], { type: "image/png" }),
          mimeType: "image/png",
          size: 3,
        },
      ],
      validationIssues: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await generateDocuments(template, dataset);

    expect(result.status).toBe("completed");
    expect(result.successFiles).toHaveLength(1);
    expect(result.successFiles[0]?.fileName).toBe("offer-bob.docx");
    expect(result.errors).toEqual([]);

    const generatedZip = await JSZip.loadAsync(await blobToArrayBuffer(result.successFiles[0]!.blob));
    const generatedDocument = await generatedZip.file("word/document.xml")!.async("string");
    const generatedRelationships = await generatedZip
      .file("word/_rels/document.xml.rels")!
      .async("string");

    expect(generatedDocument).toContain("Hello Bob");
    expect(generatedRelationships).toContain("generated-1-occ_image.png");
    expect(generatedZip.file("word/media/generated-1-occ_image.png")).toBeTruthy();

    releaseParsedDocument(parsed);
  });

  it("returns row-level errors when a dataset row cannot be generated", async () => {
    const docxBlob = await createSampleDocx();
    const parsed = await parseDocx(docxBlob);
    const firstParagraph = parsed.blocks[0];
    const secondParagraph = parsed.blocks[1];

    expect(firstParagraph.type).toBe("paragraph");
    expect(secondParagraph.type).toBe("paragraph");

    const textSegment =
      firstParagraph.type === "paragraph" ? (firstParagraph.segments[0] as TextSegment) : null;
    const imageSegment =
      secondParagraph.type === "paragraph" ? (secondParagraph.segments[0] as ImageSegment) : null;

    const template: TemplateVersionRecord = {
      id: "template_version_1",
      templateId: "template_1",
      name: "Offer Letter",
      version: 1,
      sourceDocxBlob: docxBlob,
      sourceDocxName: "offer.docx",
      createdAt: new Date().toISOString(),
      slots: [
        {
          id: "slot_text",
          name: "name",
          type: "text",
          required: true,
          occurrences: [
            {
              id: "occ_text",
              slotId: "slot_text",
              kind: "textRange",
              locator: textSegment!.locator,
              startOffset: 6,
              endOffset: 11,
              originalText: "Alice",
              originalSegmentText: textSegment!.text,
              styleSnapshot: textSegment!.style,
            },
          ],
        },
        {
          id: "slot_image",
          name: "avatar",
          type: "image",
          required: true,
          occurrences: [
            {
              id: "occ_image",
              slotId: "slot_image",
              kind: "imageNode",
              locator: imageSegment!.locator,
              originalTarget: imageSegment!.locator.target,
              altText: imageSegment!.altText,
              styleSnapshot: imageSegment!.style,
            },
          ],
        },
      ],
    };

    const dataset: DatasetDraft = {
      id: "dataset_1",
      name: "users",
      sourceXlsxBlob: new Blob(["placeholder"]),
      columns: ["name", "avatar", "file_name"],
      rows: [{ id: "row_1", cells: ["Bob", "missing-avatar.png", "offer-bob"] }],
      imagePackEntries: [],
      validationIssues: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await generateDocuments(template, dataset);

    expect(result.status).toBe("failed");
    expect(result.successFiles).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      rowNumber: 2,
      fileName: "offer-bob.docx",
    });
    expect(result.errors[0]?.message).toContain("第 2 行");

    releaseParsedDocument(parsed);
  });

  it("ignores comment markers and revisions when a text slot spans multiple runs", async () => {
    const docxBlob = await createRevisionAwareDocx();
    const parsed = await parseDocx(docxBlob);
    const firstParagraph = parsed.blocks[0];

    expect(firstParagraph.type).toBe("paragraph");
    if (firstParagraph.type !== "paragraph") {
      throw new Error("expected paragraph");
    }

    const textSegments = firstParagraph.segments.filter(
      (segment): segment is TextSegment => segment.type === "text",
    );

    expect(textSegments.map((segment) => segment.text)).toEqual(["应用场景", "建设", "方案"]);
    expect(paragraphText(firstParagraph)).toBe("应用场景建设方案");

    const template: TemplateVersionRecord = {
      id: "template_version_revision",
      templateId: "template_revision",
      name: "项目方案",
      version: 1,
      sourceDocxBlob: docxBlob,
      sourceDocxName: "revision.docx",
      createdAt: new Date().toISOString(),
      slots: [
        {
          id: "slot_topic",
          name: "主题",
          type: "text",
          required: true,
          occurrences: [
            {
              id: "occ_topic",
              slotId: "slot_topic",
              kind: "textRange",
              locator: textSegments[0]!.locator,
              startOffset: 0,
              endOffset: textSegments[0]!.text.length,
              originalText: "应用场景建设方案",
              originalSegmentText: textSegments[0]!.text,
              styleSnapshot: textSegments[0]!.style,
              fragments: textSegments.map((segment) => ({
                locator: segment.locator,
                startOffset: 0,
                endOffset: segment.text.length,
                originalSegmentText: segment.text,
              })),
            },
          ],
        },
      ],
    };

    const dataset: DatasetDraft = {
      id: "dataset_revision",
      name: "revisions",
      sourceXlsxBlob: new Blob(["placeholder"]),
      columns: ["主题", "file_name"],
      rows: [{ id: "row_1", cells: ["落地计划", "项目方案-落地计划"] }],
      imagePackEntries: [],
      validationIssues: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await generateDocuments(template, dataset);

    expect(result.status).toBe("completed");
    expect(result.errors).toEqual([]);
    expect(result.successFiles).toHaveLength(1);

    const generatedParsed = await parseDocx(result.successFiles[0]!.blob);
    const generatedFirstParagraph = generatedParsed.blocks[0];

    expect(generatedFirstParagraph.type).toBe("paragraph");
    if (generatedFirstParagraph.type !== "paragraph") {
      throw new Error("expected paragraph");
    }

    expect(paragraphText(generatedFirstParagraph)).toBe("落地计划");

    releaseParsedDocument(parsed);
    releaseParsedDocument(generatedParsed);
  });
});
