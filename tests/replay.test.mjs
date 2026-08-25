import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { loadJszip } from "../plugins/paper-figure-skill/skills/paper-figure/scripts/lib/runtime.mjs";
import { json, prepareRecordedRun, runForge, writeRecordedEditablePptx } from "./helpers.mjs";

for (const fixture of ["vector", "hybrid"]) {
  test(`recorded ${fixture} fixture replays rebuild through QA and packaging`, async () => {
    const { runDir, design, deliveryDir } = await prepareRecordedRun(fixture, { outputDirectory: fixture === "vector" });
    const beforeBuild = await runForge(["next", "--run-dir", runDir]);
    assert.equal(beforeBuild.action, "script.build");
    await runForge(["build", "--run-dir", runDir, "--skip-pptx"]);
    await writeRecordedEditablePptx(path.join(runDir, "framework.pptx"), design);
    const report = await runForge(["qa", "--run-dir", runDir]);
    assert.equal(report.passed, true, JSON.stringify(report, null, 2));
    assert.equal(report.structural.editability.full_slide_flattening, false);
    assert.ok(report.visual.artifacts.includes("qa/assets-contact-sheet.png"));
    const packaged = await runForge(["package", "--run-dir", runDir]);
    assert.equal(packaged.blocked, false);
    const state = await json(path.join(runDir, "run-state.json"));
    assert.equal(state.status, "completed");
    assert.equal((await runForge(["next", "--run-dir", runDir])).action, "deliver");
    if (deliveryDir) {
      for (const delivered of ["framework.pptx", "framework.svg", "framework.png", "paper-figure-skill-delivery.zip", "assets/png", "assets/svg", "qa"]) {
        await fs.access(path.join(deliveryDir, delivered));
      }
    }

    const JSZip = await loadJszip();
    const archive = await JSZip.loadAsync(await fs.readFile(packaged.output));
    for (const expected of [
      "framework.pptx",
      "framework.svg",
      "framework.png",
      "assets-manifest.json",
      "qa-report.json",
      "qa/diff.png",
      "qa/assets-contact-sheet.png",
      "provenance.json",
      "run-state.json",
    ]) {
      assert.ok(archive.file(expected), `missing ${expected}`);
    }
    const archivedState = JSON.parse(await archive.file("run-state.json").async("string"));
    assert.equal(archivedState.status, "completed");
    assert.equal(archivedState.stages.package.status, "completed");
  });
}
