#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteJson,
  ensureDir,
  exists,
  jsonOutput,
  makeRunId,
  parseArgs,
  readJson,
  requiredArg,
  sha256File,
} from "./lib/common.mjs";
import {
  normalizeRequest,
  validateAssetManifest,
  validateDesignSpec,
  validateRequest,
  validateSceneGraph,
  validationSummary,
} from "./lib/contracts.mjs";
import { assertBuildReady, buildRun } from "./lib/build.mjs";
import { packageRun } from "./lib/package.mjs";
import { runQa } from "./lib/qa.mjs";
import { dependencyReport, loadSharp } from "./lib/runtime.mjs";
import { blockRun, createState, invalidateDownstream, loadState, nextAction, reopenRun, saveState, setStage } from "./lib/state.mjs";

async function copyIfDifferent(source, destination) {
  if (path.resolve(source) === path.resolve(destination)) return destination;
  await ensureDir(path.dirname(destination));
  await fs.copyFile(source, destination);
  return destination;
}

async function normalizePng(source, destination) {
  const sharp = await loadSharp();
  await ensureDir(path.dirname(destination));
  await sharp(source).png().toFile(destination);
  return sharp(destination).metadata();
}

function parseHexColor(value) {
  const match = String(value ?? "").trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) throw new Error(`--key-color must be a six-digit hex color; got ${value}`);
  return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16));
}

async function removeKeyBackground(source, destination, keyColor, tolerance = 24) {
  const sharp = await loadSharp();
  const [red, green, blue] = parseHexColor(keyColor);
  const limit = Math.max(0, Math.min(255, Number(tolerance)));
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += 4) {
    if (
      Math.abs(data[index] - red) <= limit &&
      Math.abs(data[index + 1] - green) <= limit &&
      Math.abs(data[index + 2] - blue) <= limit
    ) {
      data[index + 3] = 0;
    }
  }
  await sharp(data, { raw: info }).png().toFile(destination);
}

async function inspectTransparency(source) {
  const sharp = await loadSharp();
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = Math.max(1, info.width * info.height);
  let transparent = 0;
  let visible = 0;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] <= 8) transparent += 1;
    if (data[index] >= 32) visible += 1;
  }
  return {
    width: info.width,
    height: info.height,
    transparent_fraction: transparent / pixels,
    visible_fraction: visible / pixels,
  };
}

async function cropMaster(runDir, bbox, output) {
  const sharp = await loadSharp();
  const master = path.join(runDir, "canonical-master.png");
  const metadata = await sharp(master).metadata();
  const [x, y, width, height] = bbox.map(Number);
  const crop = {
    left: Math.max(0, Math.floor(x * metadata.width)),
    top: Math.max(0, Math.floor(y * metadata.height)),
    width: Math.max(1, Math.min(metadata.width, Math.ceil(width * metadata.width))),
    height: Math.max(1, Math.min(metadata.height, Math.ceil(height * metadata.height))),
  };
  crop.width = Math.min(crop.width, metadata.width - crop.left);
  crop.height = Math.min(crop.height, metadata.height - crop.top);
  await ensureDir(path.dirname(output));
  await sharp(master).extract(crop).png().toFile(output);
  return output;
}

async function initCommand(args) {
  const requestPath = path.resolve(requiredArg(args, "request"));
  const rawRequest = await readJson(requestPath);
  const request = await normalizeRequest(rawRequest, requestPath);
  const requestValidation = await validateRequest(request);
  if (!requestValidation.valid) throw new Error(requestValidation.errors.join("\n"));
  const runId = args.runId ?? makeRunId();
  const runDir = path.resolve(args.runDir ?? path.join(process.cwd(), "runs", runId));
  if ((await exists(path.join(runDir, "run-state.json"))) && !args.resume) {
    throw new Error(`Run directory already contains state; pass --resume to reuse it: ${runDir}`);
  }
  for (const folder of ["input", "assets/png", "assets/svg", "build", "qa", "tmp"]) {
    await ensureDir(path.join(runDir, folder));
  }
  if (args.resume && (await exists(path.join(runDir, "run-state.json")))) {
    return { run_dir: runDir, resumed: true, state: await loadState(runDir) };
  }

  await atomicWriteJson(path.join(runDir, "request.json"), request);
  const inputProvenance = [];
  let canvas = { width: 1920, height: 1080 };
  if (request.master_image) {
    const sourceCopy = path.join(runDir, "input", `master-source${path.extname(request.master_image).toLowerCase() || ".img"}`);
    await copyIfDifferent(request.master_image, sourceCopy);
    const metadata = await normalizePng(request.master_image, path.join(runDir, "canonical-master.png"));
    canvas = { width: metadata.width, height: metadata.height };
    inputProvenance.push({ kind: "master_image", name: path.basename(request.master_image), sha256: await sha256File(request.master_image) });
  }
  if (request.paper_pdf) {
    const destination = path.join(runDir, "input", `paper${path.extname(request.paper_pdf) || ".pdf"}`);
    await copyIfDifferent(request.paper_pdf, destination);
    inputProvenance.push({ kind: "paper_pdf", name: path.basename(request.paper_pdf), sha256: await sha256File(request.paper_pdf) });
  }
  for (const [index, reference] of (request.style_references ?? []).entries()) {
    const destination = path.join(runDir, "input", `style-${String(index + 1).padStart(2, "0")}${path.extname(reference)}`);
    await copyIfDifferent(reference, destination);
    inputProvenance.push({ kind: "style_reference", name: path.basename(reference), sha256: await sha256File(reference) });
  }
  await atomicWriteJson(path.join(runDir, "input-provenance.json"), { schema_version: "1.0", inputs: inputProvenance });
  await atomicWriteJson(path.join(runDir, "design-spec.json"), {
    schema_version: "1.0",
    canvas,
    required_modules: [],
    required_connections: [],
    verbatim_text: {},
    style_constraints: {},
    invariants: { preserve_aspect_ratio: true, native_text: true, no_stretched_assets: true },
  });
  const state = createState({ runId, mode: request.mode, request });
  await saveState(runDir, state);
  return { run_dir: runDir, resumed: false, request_validation: requestValidation, state };
}

async function recordStage(runDir, args) {
  const stage = requiredArg(args, "stage");
  const state = await loadState(runDir);
  if (stage === "design") {
    const artifact = path.resolve(requiredArg(args, "artifact"));
    const design = await readJson(artifact);
    const result = validateDesignSpec(design);
    if (!result.valid) throw new Error(result.errors.join("\n"));
    reopenRun(state, "design");
    invalidateDownstream(state, "design");
    await copyIfDifferent(artifact, path.join(runDir, "design-spec.json"));
    setStage(state, "design", "completed", { artifacts: ["design-spec.json"] });
  } else if (stage === "master") {
    const artifacts = [];
    let candidateReport = null;
    if (state.mode === "author" || args.candidateReport) {
      const reportPath = path.resolve(requiredArg(args, "candidateReport"));
      candidateReport = await readJson(reportPath);
      const candidates = candidateReport.candidates ?? [];
      const maximum = state.request.budgets.master_candidates + state.request.budgets.master_retry_rounds;
      if (!Array.isArray(candidates) || candidates.length < state.request.budgets.master_candidates || candidates.length > maximum) {
        throw new Error(`master-candidates.json must contain between ${state.request.budgets.master_candidates} and ${maximum} candidates.`);
      }
      const ids = new Set();
      for (const candidate of candidates) {
        if (!candidate.id || ids.has(candidate.id)) throw new Error("Every master candidate needs a unique id.");
        ids.add(candidate.id);
        if (!String(candidate.prompt ?? "").trim()) throw new Error(`Master candidate ${candidate.id} must persist its prompt.`);
        for (const score of ["semantic_completeness", "visual_hierarchy", "occlusion", "decomposability", "style_consistency"]) {
          if (!Number.isFinite(Number(candidate.scores?.[score]))) throw new Error(`Master candidate ${candidate.id} is missing numeric score ${score}.`);
        }
      }
      await copyIfDifferent(reportPath, path.join(runDir, "master-candidates.json"));
      artifacts.push("master-candidates.json");
    }
    if (args.failed) {
      const reason = requiredArg(args, "reason");
      blockRun(state, "master", reason, artifacts);
      await saveState(runDir, state);
      return { stage, status: "blocked", blocker: state.blocker, state };
    }
    const artifact = path.resolve(requiredArg(args, "artifact"));
    if (candidateReport) {
      const selected = candidateReport.candidates.find((candidate) => candidate.id === candidateReport.selected_id);
      if (!selected) throw new Error("master-candidates.json selected_id does not identify a candidate.");
      if (selected.semantic_complete !== true || (selected.missing_modules ?? []).length > 0) {
        throw new Error("The selected master candidate is semantically incomplete and cannot become canonical.");
      }
    }
    reopenRun(state, "master");
    invalidateDownstream(state, "master");
    await normalizePng(artifact, path.join(runDir, "canonical-master.png"));
    artifacts.unshift("canonical-master.png");
    setStage(state, "master", "completed", { artifacts });
  } else if (stage === "scene") {
    const artifact = path.resolve(requiredArg(args, "artifact"));
    const scene = await readJson(artifact);
    const result = validateSceneGraph(scene);
    if (!result.valid) throw new Error(result.errors.join("\n"));
    reopenRun(state, "scene");
    invalidateDownstream(state, "scene");
    await copyIfDifferent(artifact, path.join(runDir, "scene-graph.json"));
    setStage(state, "scene", "completed", { artifacts: ["scene-graph.json"] });
  } else if (stage === "assets") {
    const artifact = path.resolve(requiredArg(args, "artifact"));
    const manifest = await readJson(artifact);
    const scene = await readJson(path.join(runDir, "scene-graph.json"));
    for (const job of manifest.jobs ?? []) {
      if (job.strategy === "native-text" || job.strategy === "native-shape") job.status = "completed";
      else job.status ??= "pending";
    }
    const result = validateAssetManifest(manifest, scene);
    if (!result.valid) throw new Error(result.errors.join("\n"));
    const generatedCount = manifest.jobs.filter((job) => job.strategy === "regenerate-grounded").length;
    if (generatedCount > state.request.budgets.max_complex_assets) {
      throw new Error(`Asset manifest requests ${generatedCount} generated assets; budget allows ${state.request.budgets.max_complex_assets}.`);
    }
    reopenRun(state, "assets");
    invalidateDownstream(state, "assets");
    if (await exists(path.join(runDir, "canonical-master.png"))) {
      for (const job of manifest.jobs.filter((item) => ["direct-extract", "regenerate-grounded"].includes(item.strategy))) {
        const reference = path.join(runDir, "tmp/references", `${job.id}.png`);
        await cropMaster(runDir, job.bbox, reference);
        job.reference_crop = `tmp/references/${job.id}.png`;
      }
    }
    await atomicWriteJson(path.join(runDir, "assets-manifest.json"), manifest);
    const complete = manifest.jobs.every((job) => job.status === "completed");
    setStage(state, "assets", complete ? "completed" : "pending", {
      artifacts: ["assets-manifest.json"],
      note: complete ? null : "Asset generation or extraction jobs remain.",
    });
  } else {
    throw new Error(`record --stage supports design, master, scene, and assets; got ${stage}`);
  }
  await saveState(runDir, state);
  return { stage, status: state.stages[stage].status, state };
}

async function recordAsset(runDir, args) {
  const assetId = requiredArg(args, "assetId");
  const manifestPath = path.join(runDir, "assets-manifest.json");
  const manifest = await readJson(manifestPath);
  const scene = await readJson(path.join(runDir, "scene-graph.json"));
  const job = manifest.jobs.find((item) => item.id === assetId);
  if (!job) throw new Error(`Unknown asset id: ${assetId}`);
  const state = await loadState(runDir);
  if (args.failed) {
    const reason = requiredArg(args, "reason");
    job.attempts = Number(job.attempts ?? 0) + 1;
    job.failures = [...(job.failures ?? []), { at: new Date().toISOString(), reason }];
    const exhausted = job.strategy === "regenerate-grounded" && job.attempts >= state.request.budgets.max_asset_attempts;
    job.status = exhausted ? "blocked" : "pending";
    await atomicWriteJson(manifestPath, manifest);
    if (exhausted) blockRun(state, "assets", `Asset ${assetId} exhausted its generation-attempt budget: ${reason}`, ["assets-manifest.json"]);
    else setStage(state, "assets", "pending", { artifacts: ["assets-manifest.json"], note: `Asset ${assetId} attempt failed: ${reason}` });
    await saveState(runDir, state);
    return { asset_id: assetId, recorded_failure: true, attempts: job.attempts, exhausted };
  }
  const output = path.join(runDir, "assets/png", `${assetId}.png`);
  const sharp = await loadSharp();
  if (args.fromMaster) {
    if (job.strategy !== "direct-extract") {
      throw new Error(`Asset ${assetId} uses ${job.strategy}; --from-master is allowed only for explicitly approved direct-extract jobs.`);
    }
    await cropMaster(runDir, job.bbox, output);
  } else {
    const artifact = path.resolve(requiredArg(args, "artifact"));
    if (args.keyColor) await removeKeyBackground(artifact, output, args.keyColor, args.keyTolerance ?? 24);
    else await sharp(artifact).png().toFile(output);
  }
  const alpha = await inspectTransparency(output);
  if (job.background_requirement === "transparent") {
    if (alpha.transparent_fraction < 0.005) {
      throw new Error(`Asset ${assetId} has no meaningful transparent background. Regenerate it on a flat key color or record it with --key-color.`);
    }
    if (alpha.visible_fraction < 0.005) {
      throw new Error(`Asset ${assetId} contains no meaningful visible foreground after background removal.`);
    }
  }
  job.status = "completed";
  job.output_png = `assets/png/${assetId}.png`;
  job.attempts = Number(job.attempts ?? 0) + 1;
  job.alpha = alpha;
  job.sha256_png = await sha256File(output);
  const result = validateAssetManifest(manifest, scene);
  if (!result.valid) throw new Error(result.errors.join("\n"));
  await atomicWriteJson(manifestPath, manifest);
  reopenRun(state, "assets");
  invalidateDownstream(state, "assets");
  const complete = manifest.jobs.every((item) => item.status === "completed");
  setStage(state, "assets", complete ? "completed" : "pending", {
    artifacts: ["assets-manifest.json", `assets/png/${assetId}.png`],
    note: complete ? null : "Additional asset jobs remain.",
  });
  await saveState(runDir, state);
  return { asset_id: assetId, output, all_assets_complete: complete };
}

async function recordCommand(args) {
  const runDir = path.resolve(requiredArg(args, "runDir"));
  if (args.assetId) return recordAsset(runDir, args);
  return recordStage(runDir, args);
}

async function validateCommand(args) {
  const runDir = path.resolve(requiredArg(args, "runDir"));
  const results = {};
  const request = await readJson(path.join(runDir, "request.json"));
  results.request = await validateRequest(request);
  for (const [name, fileName, validator] of [
    ["design", "design-spec.json", validateDesignSpec],
    ["scene", "scene-graph.json", validateSceneGraph],
  ]) {
    results[name] = (await exists(path.join(runDir, fileName)))
      ? validator(await readJson(path.join(runDir, fileName)))
      : { valid: false, errors: [`Missing ${fileName}`], warnings: [] };
  }
  if (await exists(path.join(runDir, "assets-manifest.json"))) {
    results.assets = validateAssetManifest(
      await readJson(path.join(runDir, "assets-manifest.json")),
      await readJson(path.join(runDir, "scene-graph.json")),
    );
  } else results.assets = { valid: false, errors: ["Missing assets-manifest.json"], warnings: [] };
  const summary = validationSummary(results);
  return { ...summary, results, dependencies: await dependencyReport() };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (!command || ["-h", "--help", "help"].includes(command)) {
    jsonOutput({
      usage: "forge.mjs <init|next|record|validate|build|qa|package> [options]",
      commands: {
        init: "--request request.json [--run-dir path] [--resume]",
        next: "--run-dir path",
        record: "--run-dir path --stage design|master|scene|assets --artifact file [--candidate-report file] OR --asset-id id (--artifact image [--key-color hex]|--from-master|--failed --reason text)",
        validate: "--run-dir path",
        build: "--run-dir path [--skip-pptx]",
        qa: "--run-dir path",
        package: "--run-dir path",
      },
    });
    return;
  }
  let result;
  if (command === "init") result = await initCommand(args);
  else if (command === "next") {
    const runDir = path.resolve(requiredArg(args, "runDir"));
    result = await nextAction(runDir, await loadState(runDir));
  } else if (command === "record") result = await recordCommand(args);
  else if (command === "validate") result = await validateCommand(args);
  else if (command === "build") {
    const runDir = path.resolve(requiredArg(args, "runDir"));
    await assertBuildReady(runDir);
    result = await buildRun(runDir, { skipPptx: Boolean(args.skipPptx) });
  } else if (command === "qa") result = await runQa(path.resolve(requiredArg(args, "runDir")));
  else if (command === "package") result = await packageRun(path.resolve(requiredArg(args, "runDir")));
  else throw new Error(`Unknown command: ${command}`);
  jsonOutput(result);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
