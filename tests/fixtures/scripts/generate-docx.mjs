#!/usr/bin/env node
// Generates the 12 DOCX fixtures used by the docx-to-pdf engine tests.
//
// Most fixtures use the `docx` npm package directly. The four "edge"
// fixtures (equations, drawings, RTL, encrypted) require synthetic XML
// injection because the `docx` package can't produce them — we generate
// a base document, unzip it, mutate document.xml, and rezip.
//
// Run:   node tests/fixtures/scripts/generate-docx.mjs
//
// Outputs are committed under tests/fixtures/. This script is reproducible
// but not run in CI.

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  AlignmentType,
  Document,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { strToU8, unzipSync, zipSync } from "fflate";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const FIXTURES = join(REPO_ROOT, "tests", "fixtures");

async function writeDocx(filename, doc) {
  const buf = await Packer.toBuffer(doc);
  const out = join(FIXTURES, filename);
  await writeFile(out, buf);
  process.stdout.write(`  ${filename} (${(buf.length / 1024).toFixed(1)} KB)\n`);
  return buf;
}

// Mutate document.xml inside a DOCX buffer. fn is called with the XML string
// and returns the mutated string. Returns the new DOCX buffer.
function mutateDocumentXml(docxBuf, fn) {
  const u8 = new Uint8Array(docxBuf.buffer, docxBuf.byteOffset, docxBuf.byteLength);
  const entries = unzipSync(u8);
  const doc = new TextDecoder().decode(entries["word/document.xml"]);
  const next = fn(doc);
  entries["word/document.xml"] = strToU8(next);
  return Buffer.from(zipSync(entries));
}

// 1. simple-paragraphs.docx — 1 page, headings + body paragraphs.
async function simpleParagraphs() {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("Hello, World")],
          }),
          new Paragraph({
            children: [
              new TextRun("This is a simple paragraph for the docx-to-pdf engine test fixture."),
            ],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Section heading")],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Bold ", bold: true }),
              new TextRun("normal "),
              new TextRun({ text: "italic", italics: true }),
            ],
          }),
          new Paragraph({
            children: [new TextRun("Tony Yu — fixture identifier for searchable-text assertion.")],
          }),
        ],
      },
    ],
  });
  await writeDocx("simple-paragraphs.docx", doc);
}

// 2. multi-page.docx — 5 pages of paragraphs to exercise pagination.
async function multiPage() {
  const children = [];
  for (let i = 1; i <= 5; i++) {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(`Page ${i}`)] }),
    );
    for (let j = 0; j < 25; j++) {
      children.push(
        new Paragraph({
          children: [
            new TextRun(`Line ${j + 1} of page ${i}. ${"Lorem ipsum dolor sit amet ".repeat(4)}`),
          ],
        }),
      );
    }
    if (i < 5)
      children.push(
        new Paragraph({ children: [new TextRun({ text: "", break: 1 })], pageBreakBefore: false }),
      );
  }
  const doc = new Document({ sections: [{ children }] });
  await writeDocx("multi-page.docx", doc);
}

// 3. two-column-resume.docx — 2-column section.
async function twoColumnResume() {
  const left = [
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Contact")] }),
    new Paragraph({ children: [new TextRun("tony@example.com")] }),
    new Paragraph({ children: [new TextRun("(555) 555-5555")] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Skills")] }),
    new Paragraph({ children: [new TextRun("TypeScript, React, Next.js")] }),
  ];
  const right = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Tony Yu")] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Experience")] }),
    new Paragraph({ children: [new TextRun("Software engineer at example company.")] }),
    new Paragraph({ children: [new TextRun("Built things, shipped things.")] }),
  ];
  // docx package supports column count via section properties.
  const doc = new Document({
    sections: [
      {
        properties: { column: { count: 2, space: 720 } },
        children: [...left, ...right],
      },
    ],
  });
  await writeDocx("two-column-resume.docx", doc);
}

// 4. table-doc.docx — 2 tables, one with gridSpan, one with vMerge.
async function tableDoc() {
  const t1 = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun("Header A")] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun("Header B")] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun("Header C")] })] }),
        ],
      }),
      new TableRow({
        children: [
          // gridSpan: 2 — merges A and B columns
          new TableCell({
            columnSpan: 2,
            children: [new Paragraph({ children: [new TextRun("Spanned cell")] })],
          }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun("Cell C2")] })] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun("A3")] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun("B3")] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun("C3")] })] }),
        ],
      }),
    ],
  });
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Table with column-span")],
          }),
          t1,
          new Paragraph({ children: [new TextRun("After table.")] }),
        ],
      },
    ],
  });
  await writeDocx("table-doc.docx", doc);
}

// 5. headed-footed.docx — section with header (page number) + footer.
async function headedFooted() {
  const header = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun("Tony Yu — Phase 10 fixture")],
      }),
    ],
  });
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES] }),
        ],
      }),
    ],
  });
  const children = [];
  for (let i = 0; i < 60; i++) {
    children.push(
      new Paragraph({
        children: [new TextRun(`Body line ${i + 1}. ${"Lorem ipsum dolor ".repeat(3)}`)],
      }),
    );
  }
  const doc = new Document({
    sections: [
      {
        headers: { default: header },
        footers: { default: footer },
        children,
      },
    ],
  });
  await writeDocx("headed-footed.docx", doc);
}

// 6. footnoted.docx — 3 footnotes referenced from body.
async function footnoted() {
  const doc = new Document({
    footnotes: {
      1: {
        children: [
          new Paragraph({ children: [new TextRun("First footnote — reference at start.")] }),
        ],
      },
      2: {
        children: [
          new Paragraph({ children: [new TextRun("Second footnote — middle of document.")] }),
        ],
      },
      3: { children: [new Paragraph({ children: [new TextRun("Third footnote — end.")] })] },
    },
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Document with footnotes")],
          }),
          new Paragraph({
            children: [
              new TextRun("Body text with a marker"),
              new FootnoteReferenceRun(1),
              new TextRun(" continuing on."),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun("More body"),
              new FootnoteReferenceRun(2),
              new TextRun(" and final note"),
              new FootnoteReferenceRun(3),
              new TextRun("."),
            ],
          }),
        ],
      },
    ],
  });
  await writeDocx("footnoted.docx", doc);
}

// 7. nested-list.docx — 3-level bulleted + 2-level numbered.
async function nestedList() {
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "bullet",
          levels: [
            { level: 0, format: "bullet", text: "•", alignment: AlignmentType.START },
            { level: 1, format: "bullet", text: "◦", alignment: AlignmentType.START },
            { level: 2, format: "bullet", text: "▪", alignment: AlignmentType.START },
          ],
        },
        {
          reference: "decimal",
          levels: [
            { level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.START },
            { level: 1, format: "lowerLetter", text: "%2.", alignment: AlignmentType.START },
          ],
        },
      ],
    },
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Bulleted")] }),
          new Paragraph({
            numbering: { reference: "bullet", level: 0 },
            children: [new TextRun("Top item one")],
          }),
          new Paragraph({
            numbering: { reference: "bullet", level: 1 },
            children: [new TextRun("Sub item one")],
          }),
          new Paragraph({
            numbering: { reference: "bullet", level: 2 },
            children: [new TextRun("Sub-sub item")],
          }),
          new Paragraph({
            numbering: { reference: "bullet", level: 0 },
            children: [new TextRun("Top item two")],
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Numbered")] }),
          new Paragraph({
            numbering: { reference: "decimal", level: 0 },
            children: [new TextRun("First")],
          }),
          new Paragraph({
            numbering: { reference: "decimal", level: 1 },
            children: [new TextRun("First-a")],
          }),
          new Paragraph({
            numbering: { reference: "decimal", level: 0 },
            children: [new TextRun("Second")],
          }),
        ],
      },
    ],
  });
  await writeDocx("nested-list.docx", doc);
}

// 8. image-doc.docx — inline PNG + JPEG.
async function imageDoc() {
  // Reuse existing test fixtures.
  const png = await readFile(join(FIXTURES, "sample.png"));
  const jpg = await readFile(join(FIXTURES, "sample.jpg"));
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Document with images")],
          }),
          new Paragraph({ children: [new TextRun("Below is a PNG:")] }),
          new Paragraph({
            children: [
              new ImageRun({ data: png, transformation: { width: 80, height: 80 }, type: "png" }),
            ],
          }),
          new Paragraph({ children: [new TextRun("Below is a JPEG:")] }),
          new Paragraph({
            children: [
              new ImageRun({ data: jpg, transformation: { width: 80, height: 80 }, type: "jpg" }),
            ],
          }),
          new Paragraph({ children: [new TextRun("End.")] }),
        ],
      },
    ],
  });
  await writeDocx("image-doc.docx", doc);
}

// 9. equations-doc.docx — base doc + injected <m:oMath>.
async function equationsDoc() {
  const base = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Document with equations")],
          }),
          new Paragraph({ children: [new TextRun("The Pythagorean theorem:")] }),
          new Paragraph({ children: [new TextRun("[EQUATION_PLACEHOLDER]")] }),
          new Paragraph({ children: [new TextRun("End of document.")] }),
        ],
      },
    ],
  });
  const baseBuf = await Packer.toBuffer(base);
  const out = mutateDocumentXml(baseBuf, (xml) => {
    // Replace the placeholder paragraph with an OMML equation paragraph.
    const omml = `<w:p><m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:oMath><m:r><m:t>a²+b²=c²</m:t></m:r></m:oMath></m:oMathPara></w:p>`;
    return xml.replace(/<w:p>[^<]*<w:r><w:t>\[EQUATION_PLACEHOLDER\]<\/w:t><\/w:r><\/w:p>/, omml);
  });
  await writeFile(join(FIXTURES, "equations-doc.docx"), out);
  process.stdout.write(`  equations-doc.docx (${(out.length / 1024).toFixed(1)} KB)\n`);
}

// 10. drawings-doc.docx — base doc + injected <w:drawing> shape.
async function drawingsDoc() {
  const base = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Document with shapes")],
          }),
          new Paragraph({ children: [new TextRun("[DRAWING_PLACEHOLDER]")] }),
          new Paragraph({ children: [new TextRun("End.")] }),
        ],
      },
    ],
  });
  const baseBuf = await Packer.toBuffer(base);
  const out = mutateDocumentXml(baseBuf, (xml) => {
    // Inject a minimal <w:drawing> with a shape (not an image) — exercises
    // skip-with-warning detection without needing actual rendering data.
    const drawing = `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Shape1"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingShape"><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    return xml.replace(/<w:p>[^<]*<w:r><w:t>\[DRAWING_PLACEHOLDER\]<\/w:t><\/w:r><\/w:p>/, drawing);
  });
  await writeFile(join(FIXTURES, "drawings-doc.docx"), out);
  process.stdout.write(`  drawings-doc.docx (${(out.length / 1024).toFixed(1)} KB)\n`);
}

// 11. rtl-doc.docx — base doc + injected <w:bidi/> RTL paragraph.
async function rtlDoc() {
  const base = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Document with RTL paragraph")],
          }),
          new Paragraph({ children: [new TextRun("[RTL_PLACEHOLDER]")] }),
          new Paragraph({ children: [new TextRun("Back to LTR.")] }),
        ],
      },
    ],
  });
  const baseBuf = await Packer.toBuffer(base);
  const out = mutateDocumentXml(baseBuf, (xml) => {
    // Inject an RTL paragraph with Arabic text.
    const rtl =
      "<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t>مرحبا بالعالم</w:t></w:r></w:p>";
    return xml.replace(/<w:p>[^<]*<w:r><w:t>\[RTL_PLACEHOLDER\]<\/w:t><\/w:r><\/w:p>/, rtl);
  });
  await writeFile(join(FIXTURES, "rtl-doc.docx"), out);
  process.stdout.write(`  rtl-doc.docx (${(out.length / 1024).toFixed(1)} KB)\n`);
}

// 12. encrypted.docx — synthetic. A zip whose [Content_Types].xml signals
// the package is encrypted (`application/vnd.ms-office.encryptedPackage`
// override). The engine detects this signature and throws "password-
// protected" without attempting decryption. This fixture is enough to
// test detection — we don't ship an actual MS-OFFCRYPTO encryption since
// there's no client-side OSS implementation and it isn't needed for the
// engine's behavior.
async function encryptedDocx() {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/EncryptedPackage" ContentType="application/vnd.ms-office.encryptedPackage"/>
</Types>`;
  const zip = zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    EncryptedPackage: new Uint8Array([0x00, 0x01, 0x02, 0x03]), // dummy bytes
  });
  await writeFile(join(FIXTURES, "encrypted.docx"), zip);
  process.stdout.write(`  encrypted.docx (${(zip.length / 1024).toFixed(1)} KB) [synthetic]\n`);
}

async function main() {
  process.stdout.write("Generating DOCX fixtures:\n");
  await simpleParagraphs();
  await multiPage();
  await twoColumnResume();
  await tableDoc();
  await headedFooted();
  await footnoted();
  await nestedList();
  await imageDoc();
  await equationsDoc();
  await drawingsDoc();
  await rtlDoc();
  await encryptedDocx();
  process.stdout.write("Done.\n");
}

main().catch((err) => {
  process.stderr.write(`generate-docx: ${err.message}\n${err.stack ?? ""}\n`);
  process.exit(1);
});
