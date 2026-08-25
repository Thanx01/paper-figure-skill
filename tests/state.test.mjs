import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { atomicWriteJson } from "../plugins/paper-figure-skill/skills/paper-figure/scripts/lib/common.mjs";
import { createState, invalidateDownstream, nextAction, saveState, setStage } from "../plugins/paper-figure-skill/skills/paper-figure/scripts/lib/state.mjs";
import { temporaryDirectory } from "./helpers.mjs";

const request = {
  aspect_ratio: "preserve",
  budgets: { master_candidates: 3, master_retry_rounds: 1, max_complex_assets: 32, max_asset_attempts: 2, max_repair_rounds: 3, stop_after_no_improvement_rounds: 1 },
  qa_thresholds: { global_diff_ratio: 0.08 },
};

test("rebuild state resumes after the last completed stage", async () => {
  const runDir = await temporaryDirectory("paper-diagram-state-");
  const state = createState({ runId: "test", mode: "rebuild", request });
  assert.equal((await nextAction(runDir, state)).action, "agent.write_design_spec");
  setStage(state, "design", "completed", { artifacts: ["design-spec.json"] });
  assert.equal((await nextAction(runDir, state)).action, "agent.write_scene_graph");
  await atomicWriteJson(path.join(runDir, "scene-graph.json"), { elements: [] });
  setStage(state, "scene", "completed", { artifacts: ["scene-graph.json"] });
  assert.equal((await nextAction(runDir, state)).action, "agent.write_asset_manifest");
  await saveState(runDir, state);
  const entries = await fs.readdir(runDir);
  assert.deepEqual(entries.filter((name) => name.includes(".tmp-")), []);
});

test("completed stages keep a de-duplicated artifact list", () => {
  const state = createState({ runId: "test", mode: "author", request });
  setStage(state, "design", "completed", { artifacts: ["design-spec.json"] });
  setStage(state, "design", "completed", { artifacts: ["design-spec.json"] });
  assert.deepEqual(state.stages.design.artifacts, ["design-spec.json"]);
});

test("a QA repair invalidates only downstream work and returns to QA after rebuild", async () => {
  const runDir = await temporaryDirectory("paper-diagram-repair-");
  const state = createState({ runId: "repair", mode: "rebuild", request });
  for (const stage of ["design", "scene", "assets", "svg", "build"]) setStage(state, stage, "completed");
  state.repair.rounds = 1;
  state.repair.awaiting_changes = true;
  assert.equal((await nextAction(runDir, state)).action, "agent.repair_from_qa");
  invalidateDownstream(state, "assets");
  assert.equal((await nextAction(runDir, state)).action, "script.build");
  setStage(state, "svg", "completed");
  setStage(state, "build", "completed");
  assert.equal((await nextAction(runDir, state)).action, "script.qa");
});
