import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { inspectPptxEditability } from "../plugins/paper-figure-skill/skills/paper-figure/scripts/lib/qa.mjs";
import { loadJszip } from "../plugins/paper-figure-skill/skills/paper-figure/scripts/lib/runtime.mjs";
import { temporaryDirectory } from "./helpers.mjs";

test("PPTX XML gate detects near-full-slide flattening", async () => {
  const JSZip = await loadJszip();
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", "<p:presentation xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"><p:sldSz cx=\"12192000\" cy=\"6858000\"/></p:presentation>");
  zip.file("ppt/slides/slide1.xml", "<p:sld xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"><p:cSld><p:spTree><p:pic><p:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"12192000\" cy=\"6858000\"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>");
  const root = await temporaryDirectory("paper-diagram-pptx-");
  const output = path.join(root, "flattened.pptx");
  await fs.writeFile(output, await zip.generateAsync({ type: "nodebuffer" }));
  const result = await inspectPptxEditability(output);
  assert.equal(result.full_slide_flattening, true);
  assert.equal(result.full_slide_pictures, 1);
});
