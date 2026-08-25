import path from "node:path";
import { atomicWriteJson, exists, nowIso, readJson, STAGES } from "./common.mjs";

export function createState({ runId, mode, request }) {
  const stages = Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      {
        status: stage === "preflight" ? "completed" : "pending",
        attempts: stage === "preflight" ? 1 : 0,
        updated_at: nowIso(),
        artifacts: [],
        note: null,
      },
    ]),
  );
  if (mode === "rebuild") {
    stages.master.status = "completed";
    stages.master.attempts = 1;
    stages.master.artifacts = ["canonical-master.png"];
  }
  return {
    schema_version: "1.0",
    run_id: runId,
    mode,
    status: "running",
    created_at: nowIso(),
    updated_at: nowIso(),
    request: {
      aspect_ratio: request.aspect_ratio,
      budgets: request.budgets,
      qa_thresholds: request.qa_thresholds,
    },
    stages,
    repair: {
      rounds: 0,
      best_diff_ratio: null,
      no_improvement_rounds: 0,
      awaiting_changes: false,
    },
    blocker: null,
    history: [],
  };
}

export async function loadState(runDir) {
  return readJson(path.join(runDir, "run-state.json"));
}

export async function saveState(runDir, state) {
  state.updated_at = nowIso();
  await atomicWriteJson(path.join(runDir, "run-state.json"), state);
  return state;
}

export function setStage(state, stage, status, { artifacts = [], note = null } = {}) {
  if (!STAGES.includes(stage)) throw new Error(`Unknown stage: ${stage}`);
  if (!new Set(["pending", "in_progress", "completed", "blocked"]).has(status)) {
    throw new Error(`Invalid stage status: ${status}`);
  }
  const current = state.stages[stage];
  if (status === "completed" || status === "blocked") current.attempts += 1;
  current.status = status;
  current.updated_at = nowIso();
  current.artifacts = [...new Set([...(current.artifacts ?? []), ...artifacts])];
  current.note = note;
  state.history.push({ at: nowIso(), event: "stage", stage, status, artifacts, note });
  if (status === "blocked") {
    state.status = "blocked";
    state.blocker = { stage, reason: note ?? "Stage blocked", at: nowIso() };
  }
  return state;
}

export function blockRun(state, stage, reason, evidence = []) {
  setStage(state, stage, "blocked", { note: reason, artifacts: evidence });
  state.blocker = { stage, reason, evidence, at: nowIso() };
  return state;
}

export function finishRun(state) {
  state.status = "completed";
  state.blocker = null;
  state.history.push({ at: nowIso(), event: "run_completed" });
  return state;
}

export function reopenRun(state, changedStage) {
  if (state.status !== "blocked") return state;
  const blockedStage = state.blocker?.stage;
  const repairsQa = blockedStage === "qa" && ["design", "master", "scene", "assets"].includes(changedStage);
  if (blockedStage !== changedStage && !repairsQa) return state;
  if (state.stages[blockedStage]?.status === "blocked") state.stages[blockedStage].status = "pending";
  if (repairsQa) state.stages.qa.status = "pending";
  state.stages.package.status = "pending";
  state.status = "running";
  state.history.push({ at: nowIso(), event: "run_reopened", blocked_stage: blockedStage, changed_stage: changedStage });
  state.blocker = null;
  return state;
}

export function invalidateDownstream(state, changedStage) {
  const downstream = {
    design: ["scene", "assets", "svg", "build", "qa", "package"],
    master: ["scene", "assets", "svg", "build", "qa", "package"],
    scene: ["assets", "svg", "build", "qa", "package"],
    assets: ["svg", "build", "qa", "package"],
  }[changedStage] ?? [];
  for (const stage of downstream) {
    state.stages[stage].status = "pending";
    state.stages[stage].note = `Invalidated by updated ${changedStage}.`;
  }
  if (downstream.length) state.history.push({ at: nowIso(), event: "downstream_invalidated", changed_stage: changedStage, stages: downstream });
  if (state.repair?.awaiting_changes) state.repair.awaiting_changes = false;
  return state;
}

async function pendingAssetAction(runDir, state) {
  const manifestPath = path.join(runDir, "assets-manifest.json");
  if (!(await exists(manifestPath))) {
    return {
      action: "agent.write_asset_manifest",
      output: "assets-manifest.json",
      instruction: "Inventory every visually distinct extractable UI, icon, illustration, and decoration at fine granularity. Give every image instance an asset_id. Regenerate each distinct visual as its own transparent image; repeated identical instances may share one asset job. Then record both discovery passes as complete.",
    };
  }
  const manifest = await readJson(manifestPath);
  const pending = (manifest.jobs ?? []).find((job) => job.status !== "completed");
  if (!pending) {
    return {
      action: "script.record_assets_complete",
      instruction: "All asset jobs are complete; record the assets manifest again to close the stage.",
    };
  }
  if (pending.strategy === "direct-extract") {
    return {
      action: "script.extract_asset",
      asset_id: pending.id,
      command: `record --run-dir <RUN_DIR> --asset-id ${pending.id} --from-master`,
      instruction: "Crop the declared bbox from canonical-master.png and record the resulting transparent-or-opaque source asset.",
    };
  }
  if (pending.strategy === "regenerate-grounded") {
    return {
      action: "imagegen.generate_asset",
      asset_id: pending.id,
      attempt: Number(pending.attempts ?? 0) + 1,
      max_attempts: state.request.budgets.max_asset_attempts,
      prompt: pending.prompt ?? null,
      references: ["canonical-master.png", pending.reference_crop].filter(Boolean),
      constraints: [
        "Use one image generation call for this distinct asset.",
        "Generate only the marked UI/icon/illustration, with no surrounding panel, labels, or unrelated objects.",
        "Use a perfectly flat chroma-key background, preserve the subject silhouette, aspect ratio, palette, and internal proportions.",
        "The recorded output must contain real transparent background pixels and visible foreground pixels.",
        "Copy the validated result into the run before recording it.",
      ],
    };
  }
  return {
    action: "agent.resolve_asset_job",
    asset_id: pending.id,
    instruction: "Resolve the native asset mapping or correct the manifest strategy.",
  };
}

export async function nextAction(runDir, state) {
  if (state.status === "blocked") {
    if (state.stages.package.status === "completed") {
      return { action: "deliver_blocker", artifact: "paper-figure-skill-blocker.zip", blocker: state.blocker };
    }
    return {
      action: "script.package_blocker",
      blocker: state.blocker,
      command: "package --run-dir <RUN_DIR>",
    };
  }
  if (state.status === "completed") {
    return { action: "deliver", artifact: "paper-figure-skill-delivery.zip" };
  }

  if (state.stages.design.status !== "completed") {
    return {
      action: "agent.write_design_spec",
      output: "design-spec.json",
      instruction: "Lock exact text, required modules, and required connections. Explicit user text outranks paper text and master OCR.",
    };
  }
  if (state.stages.master.status !== "completed") {
    return {
      action: "imagegen.generate_master_candidates",
      count: state.request.budgets.master_candidates,
      max_retry_rounds: state.request.budgets.master_retry_rounds,
      instruction: "Generate complete master candidates, reject any missing required module, select one, and record it as canonical-master.png.",
    };
  }
  if (state.stages.scene.status !== "completed") {
    return {
      action: "agent.write_scene_graph",
      output: "scene-graph.json",
      passes: ["semantic_structure", "unexplained_visual_residual"],
      instruction: "Describe every module, native text item, connector, and every visually distinct extractable UI/icon/illustration using normalized coordinates. Create separate image elements for repeated instances, but let identical instances share an asset_id. Complete both the semantic and unexplained-residual passes.",
    };
  }
  if (state.stages.assets.status !== "completed") return pendingAssetAction(runDir, state);
  if (state.stages.svg.status !== "completed" || state.stages.build.status !== "completed") {
    return {
      action: "script.build",
      command: "build --run-dir <RUN_DIR>",
      instruction: "Create child SVG/PNG assets, the composite SVG/PNG, and the editable PPTX.",
    };
  }
  if (state.stages.qa.status !== "completed") {
    if (state.repair.awaiting_changes) {
      return {
        action: "agent.repair_from_qa",
        report: "qa-report.json",
        max_rounds: state.request.budgets.max_repair_rounds,
        instruction: "Repair only failing elements, then rebuild and rerun QA. Never restart the whole diagram without evidence.",
      };
    }
    return { action: "script.qa", command: "qa --run-dir <RUN_DIR>" };
  }
  if (state.stages.package.status !== "completed") {
    return { action: "script.package", command: "package --run-dir <RUN_DIR>" };
  }
  return { action: "deliver", artifact: "paper-figure-skill-delivery.zip" };
}
