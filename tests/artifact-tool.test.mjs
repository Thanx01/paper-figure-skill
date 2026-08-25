import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { dependencyReport } from "../plugins/paper-figure-skill/skills/paper-figure/scripts/lib/runtime.mjs";
import { inspectPptxEditability } from "../plugins/paper-figure-skill/skills/paper-figure/scripts/lib/qa.mjs";
import { prepareRecordedRun, runForge } from "./helpers.mjs";

test("Codex Desktop artifact-tool builds a rendered editable PPTX", async (context) => {
  const dependencies = await dependencyReport();
  if (!dependencies["@oai/artifact-tool"]?.available) {
    context.skip("@oai/artifact-tool is supplied by Codex Desktop, not the CI dependency set");
    return;
  }
  const { runDir, design } = await prepareRecordedRun("hybrid");
  const output = await runForge(["build", "--run-dir", runDir]);
  assert.ok(output.framework_pptx);
  assert.ok((await fs.stat(path.join(runDir, "framework.pptx"))).size > 1000);
  assert.ok((await fs.stat(path.join(runDir, "build/rendered-pptx.png"))).size > 1000);
  const editability = await inspectPptxEditability(path.join(runDir, "framework.pptx"));
  assert.ok(editability.native_shapes >= design.required_modules.length + Object.keys(design.verbatim_text).length);
  assert.ok(editability.native_connectors >= design.required_connections.length);
  assert.equal(editability.full_slide_pictures, 0);
  process.stdout.write(`artifact-tool smoke run: ${runDir}\n`);
});
