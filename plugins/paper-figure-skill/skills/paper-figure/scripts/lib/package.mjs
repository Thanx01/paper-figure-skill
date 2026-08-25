import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson, ensureDir, exists, listFiles, portablePath, readJson, sha256File } from "./common.mjs";
import { loadJszip } from "./runtime.mjs";
import { finishRun, loadState, saveState, setStage } from "./state.mjs";

export function safeArchivePath(relativePath) {
  const normalized = relativePath.split(path.sep).join("/").replace(/^\/+/, "");
  if (!normalized || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`Unsafe archive path: ${relativePath}`);
  }
  return normalized;
}

async function addFile(zip, runDir, filePath, archivePath = null) {
  if (!(await exists(filePath))) return false;
  const name = safeArchivePath(archivePath ?? portablePath(runDir, filePath));
  zip.file(name, await fs.readFile(filePath));
  return true;
}

export async function packageRun(runDir) {
  const state = await loadState(runDir);
  const blocked = state.status === "blocked";
  if (!blocked && state.stages.qa.status !== "completed") {
    throw new Error("Refusing to create a success package before QA passes.");
  }
  const JSZip = await loadJszip();
  const zip = new JSZip();
  const included = [];
  if (blocked) {
    await atomicWriteJson(path.join(runDir, "blocker-report.json"), {
      schema_version: "1.0",
      status: "blocked",
      run_id: state.run_id,
      stage: state.blocker?.stage ?? null,
      reason: state.blocker?.reason ?? "Unspecified blocker",
      evidence: state.blocker?.evidence ?? [],
      completed_stages: Object.entries(state.stages).filter(([, value]) => value.status === "completed").map(([name]) => name),
      pending_stages: Object.entries(state.stages).filter(([, value]) => value.status === "pending").map(([name]) => name),
      recovery: "Correct the reported stage inputs in this run directory, record the repaired artifact, and resume with forge.mjs next.",
    });
  }
  const coreFiles = blocked
    ? ["blocker-report.json", "qa-report.json", "design-spec.json", "scene-graph.json", "assets-manifest.json"]
    : ["framework.pptx", "framework.svg", "framework.png", "assets-manifest.json", "qa-report.json"];
  if (!blocked) {
    const missing = [];
    for (const relative of coreFiles) if (!(await exists(path.join(runDir, relative)))) missing.push(relative);
    if (missing.length) throw new Error(`Refusing to create an incomplete success package; missing: ${missing.join(", ")}`);
  }
  for (const relative of coreFiles) {
    if (await addFile(zip, runDir, path.join(runDir, relative), relative)) included.push(relative);
  }
  for (const folder of ["assets/png", "assets/svg", "qa"]) {
    for (const file of await listFiles(path.join(runDir, folder))) {
      const relative = portablePath(runDir, file);
      if (await addFile(zip, runDir, file, relative)) included.push(relative);
    }
  }

  const request = await readJson(path.join(runDir, "request.json"));
  const persistedInputs = (await exists(path.join(runDir, "input-provenance.json")))
    ? await readJson(path.join(runDir, "input-provenance.json"))
    : { inputs: [] };
  const provenance = {
    schema_version: "1.0",
    run_id: state.run_id,
    mode: state.mode,
    status: blocked ? "blocked" : "completed",
    inputs: persistedInputs.inputs ?? [],
    artifacts: [],
    policy: {
      canonical_visual_source: "canonical-master.png",
      semantic_precedence: ["explicit_user_text", "paper_or_source_text", "master_ocr"],
      svg_policy: "honest-hybrid",
      pptx_builder: "@oai/artifact-tool",
    },
    blocker: state.blocker,
  };
  const trackedArtifacts = [...new Set([
    "request.json",
    "design-spec.json",
    "canonical-master.png",
    "scene-graph.json",
    "assets-manifest.json",
    "qa-report.json",
    ...included,
  ])];
  for (const relative of trackedArtifacts) {
    const filePath = path.join(runDir, relative);
    if (await exists(filePath)) provenance.artifacts.push({ path: relative, sha256: await sha256File(filePath) });
  }
  await atomicWriteJson(path.join(runDir, "provenance.json"), provenance);
  await addFile(zip, runDir, path.join(runDir, "provenance.json"), "provenance.json");

  const outputName = blocked ? "paper-figure-skill-blocker.zip" : "paper-figure-skill-delivery.zip";
  const packagedState = structuredClone(state);
  setStage(packagedState, "package", "completed", { artifacts: [outputName] });
  if (!blocked) finishRun(packagedState);
  const portableState = structuredClone(packagedState);
  portableState.request = {
    aspect_ratio: state.request.aspect_ratio,
    budgets: state.request.budgets,
    qa_thresholds: state.request.qa_thresholds,
  };
  zip.file("run-state.json", `${JSON.stringify(portableState, null, 2)}\n`);

  const outputPath = path.join(runDir, outputName);
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  await fs.writeFile(outputPath, bytes);
  await saveState(runDir, packagedState);

  if (request.output_dir) {
    await ensureDir(request.output_dir);
    const deliveryPath = path.join(request.output_dir, outputName);
    if (path.resolve(outputPath) !== path.resolve(deliveryPath)) await fs.copyFile(outputPath, deliveryPath);
    for (const relative of coreFiles) {
      const source = path.join(runDir, relative);
      const destination = path.join(request.output_dir, path.basename(relative));
      if ((await exists(source)) && path.resolve(source) !== path.resolve(destination)) await fs.copyFile(source, destination);
    }
    for (const folder of ["assets/png", "assets/svg", "qa"]) {
      const source = path.join(runDir, folder);
      const destination = path.join(request.output_dir, folder);
      if ((await exists(source)) && path.resolve(source) !== path.resolve(destination)) {
        await fs.cp(source, destination, { recursive: true, force: true });
      }
    }
  }
  return { output: outputPath, blocked, included: [...included, "provenance.json", "run-state.json"] };
}
