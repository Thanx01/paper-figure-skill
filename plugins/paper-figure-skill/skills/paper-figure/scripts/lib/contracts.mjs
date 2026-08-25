import path from "node:path";
import { exists, normalizedBbox } from "./common.mjs";

export const STRATEGIES = new Set([
  "native-text",
  "native-shape",
  "direct-extract",
  "regenerate-grounded",
]);

export const VECTOR_KINDS = new Set(["native-vector", "embedded-raster"]);
export const ELEMENT_TYPES = new Set(["shape", "text", "connector", "image", "group"]);
export const EDITABLE_LEVELS = new Set(["full", "geometry-and-style", "position-and-scale", "none"]);
export const ASSET_ROLES = new Set(["icon", "ui-component", "illustration", "decoration", "native-component"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateBbox(bbox, label, errors) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((value) => !Number.isFinite(Number(value)))) {
    errors.push(`${label} must be [x, y, width, height] with numeric values.`);
    return;
  }
  const [x, y, width, height] = normalizedBbox(bbox);
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) {
    errors.push(`${label} must stay inside normalized canvas coordinates.`);
  }
}

function duplicateIds(items) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items) {
    if (!item?.id) continue;
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  }
  return [...duplicates];
}

export function duplicateAssetGroups(manifest) {
  const byHash = new Map();
  for (const job of manifest.jobs ?? []) {
    const hash = job.sha256_png ?? job.sha256;
    if (!hash) continue;
    byHash.set(hash, [...(byHash.get(hash) ?? []), job.id]);
  }
  return [...byHash.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([sha256, ids]) => ({ sha256, ids }));
}

export async function normalizeRequest(raw, requestPath) {
  const requestDir = path.dirname(path.resolve(requestPath));
  const request = {
    schema_version: "1.0",
    mode: raw.mode,
    output_dir: raw.output_dir ? path.resolve(requestDir, raw.output_dir) : null,
    master_image: raw.master_image ? path.resolve(requestDir, raw.master_image) : null,
    prompt: raw.prompt ?? null,
    paper_pdf: raw.paper_pdf ? path.resolve(requestDir, raw.paper_pdf) : null,
    style_references: (raw.style_references ?? []).map((item) => path.resolve(requestDir, item)),
    aspect_ratio: raw.mode === "rebuild" ? "preserve" : (raw.aspect_ratio ?? "16:9"),
    budgets: {
      master_candidates: Number(raw.budgets?.master_candidates ?? 3),
      master_retry_rounds: Number(raw.budgets?.master_retry_rounds ?? 1),
      max_complex_assets: Number(raw.budgets?.max_complex_assets ?? 32),
      max_asset_attempts: Number(raw.budgets?.max_asset_attempts ?? 2),
      max_repair_rounds: Number(raw.budgets?.max_repair_rounds ?? 3),
      stop_after_no_improvement_rounds: Number(raw.budgets?.stop_after_no_improvement_rounds ?? 1),
    },
    qa_thresholds: {
      global_diff_ratio: Number(raw.qa_thresholds?.global_diff_ratio ?? 0.08),
      direct_extract_diff_ratio: Number(raw.qa_thresholds?.direct_extract_diff_ratio ?? 0.03),
      native_diff_ratio: Number(raw.qa_thresholds?.native_diff_ratio ?? 0.08),
      regenerated_diff_ratio: Number(raw.qa_thresholds?.regenerated_diff_ratio ?? 0.15),
      center_error: Number(raw.qa_thresholds?.center_error ?? 0.01),
      size_error: Number(raw.qa_thresholds?.size_error ?? 0.02),
      aspect_error: Number(raw.qa_thresholds?.aspect_error ?? 0.01),
    },
  };
  return request;
}

export async function validateRequest(request) {
  const errors = [];
  const warnings = [];
  if (!isObject(request)) return { valid: false, errors: ["Request must be a JSON object."], warnings };
  if (!new Set(["rebuild", "author"]).has(request.mode)) {
    errors.push("mode must be rebuild or author.");
  }
  if (request.mode === "rebuild") {
    if (!request.master_image) errors.push("rebuild mode requires master_image.");
    else if (!(await exists(request.master_image))) errors.push(`master_image does not exist: ${request.master_image}`);
  }
  if (request.mode === "author") {
    const sources = [request.prompt, request.paper_pdf, ...(request.style_references ?? [])].filter(Boolean);
    if (sources.length === 0) errors.push("author mode requires prompt, paper_pdf, or style_references.");
    if (request.paper_pdf && !(await exists(request.paper_pdf))) errors.push(`paper_pdf does not exist: ${request.paper_pdf}`);
    for (const item of request.style_references ?? []) {
      if (!(await exists(item))) errors.push(`style reference does not exist: ${item}`);
    }
  }
  const positiveBudgets = new Set(["master_candidates", "max_asset_attempts", "max_repair_rounds", "stop_after_no_improvement_rounds"]);
  for (const [key, value] of Object.entries(request.budgets ?? {})) {
    const minimum = positiveBudgets.has(key) ? 1 : 0;
    if (!Number.isInteger(value) || value < minimum) errors.push(`budgets.${key} must be an integer of at least ${minimum}.`);
  }
  for (const [key, value] of Object.entries(request.qa_thresholds ?? {})) {
    if (!Number.isFinite(value) || value < 0 || value > 1) errors.push(`qa_thresholds.${key} must be between 0 and 1.`);
  }
  if (!request.output_dir) warnings.push("output_dir is unset; the run directory will hold final deliverables.");
  return { valid: errors.length === 0, errors, warnings };
}

export function validateDesignSpec(spec) {
  const errors = [];
  const warnings = [];
  if (!isObject(spec)) return { valid: false, errors: ["Design spec must be a JSON object."], warnings };
  if (!Number.isFinite(Number(spec.canvas?.width)) || Number(spec.canvas.width) <= 0) errors.push("canvas.width must be positive.");
  if (!Number.isFinite(Number(spec.canvas?.height)) || Number(spec.canvas.height) <= 0) errors.push("canvas.height must be positive.");
  if (!Array.isArray(spec.required_modules)) errors.push("required_modules must be an array.");
  if (!Array.isArray(spec.required_connections)) errors.push("required_connections must be an array.");
  for (const duplicate of duplicateIds(spec.required_modules ?? [])) errors.push(`Duplicate module id: ${duplicate}`);
  for (const duplicate of duplicateIds(spec.required_connections ?? [])) errors.push(`Duplicate connection id: ${duplicate}`);
  const moduleIds = new Set((spec.required_modules ?? []).map((item) => item.id));
  for (const connection of spec.required_connections ?? []) {
    if (!connection.id || !connection.from || !connection.to) errors.push("Each required connection needs id, from, and to.");
    if (connection.from && !moduleIds.has(connection.from)) warnings.push(`Connection ${connection.id} source is not a required module: ${connection.from}`);
    if (connection.to && !moduleIds.has(connection.to)) warnings.push(`Connection ${connection.id} target is not a required module: ${connection.to}`);
  }
  if (!isObject(spec.verbatim_text)) errors.push("verbatim_text must be an object keyed by stable text id.");
  if (spec.expected_geometry !== undefined) {
    if (!isObject(spec.expected_geometry)) errors.push("expected_geometry must be an object keyed by scene element id.");
    else for (const [id, bbox] of Object.entries(spec.expected_geometry)) validateBbox(bbox, `Expected geometry ${id}`, errors);
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function validateSceneGraph(scene) {
  const errors = [];
  const warnings = [];
  if (!isObject(scene)) return { valid: false, errors: ["Scene graph must be a JSON object."], warnings };
  if (!Number.isFinite(Number(scene.canvas?.width)) || Number(scene.canvas.width) <= 0) errors.push("scene.canvas.width must be positive.");
  if (!Number.isFinite(Number(scene.canvas?.height)) || Number(scene.canvas.height) <= 0) errors.push("scene.canvas.height must be positive.");
  if (!Array.isArray(scene.elements)) errors.push("scene.elements must be an array.");
  for (const duplicate of duplicateIds(scene.elements ?? [])) errors.push(`Duplicate scene element id: ${duplicate}`);
  const ids = new Set((scene.elements ?? []).map((item) => item.id));
  for (const element of scene.elements ?? []) {
    if (!element.id) errors.push("Every scene element needs an id.");
    if (!ELEMENT_TYPES.has(element.type)) errors.push(`Element ${element.id} has unsupported type: ${element.type}`);
    if (element.type !== "connector" && element.type !== "group") validateBbox(element.bbox, `Element ${element.id} bbox`, errors);
    if (element.type === "text" && typeof element.text !== "string") errors.push(`Text element ${element.id} needs text.`);
    if (element.type === "image" && !String(element.asset_id ?? "").trim()) {
      errors.push(`Image element ${element.id} must reference an asset_id.`);
    }
    if (element.type === "connector") {
      if (!element.from || !element.to) errors.push(`Connector ${element.id} needs from and to.`);
      if (element.from && !ids.has(element.from)) errors.push(`Connector ${element.id} has unknown from id: ${element.from}`);
      if (element.to && !ids.has(element.to)) errors.push(`Connector ${element.id} has unknown to id: ${element.to}`);
    }
    if (element.parent && !ids.has(element.parent)) errors.push(`Element ${element.id} has unknown parent: ${element.parent}`);
    if (element.strategy && !STRATEGIES.has(element.strategy)) errors.push(`Element ${element.id} has unsupported strategy: ${element.strategy}`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function validateAssetManifest(manifest, scene = null) {
  const errors = [];
  const warnings = [];
  if (!isObject(manifest)) return { valid: false, errors: ["Asset manifest must be a JSON object."], warnings };
  if (!Array.isArray(manifest.jobs)) errors.push("assets manifest jobs must be an array.");
  if (!isObject(manifest.inventory)) {
    errors.push("assets manifest must include an inventory completion record.");
  } else {
    if (manifest.inventory.granularity !== "fine-grained") errors.push("Asset inventory granularity must be fine-grained.");
    if (manifest.inventory.semantic_pass_complete !== true) errors.push("Asset inventory semantic pass is incomplete.");
    if (manifest.inventory.residual_pass_complete !== true) errors.push("Asset inventory residual pass is incomplete.");
    if (!Array.isArray(manifest.inventory.unexplained_visuals)) errors.push("Asset inventory unexplained_visuals must be an array.");
    else if (manifest.inventory.unexplained_visuals.length > 0) {
      errors.push(`Asset inventory still has unexplained visuals: ${manifest.inventory.unexplained_visuals.join(", ")}`);
    }
  }
  for (const duplicate of duplicateIds(manifest.jobs ?? [])) errors.push(`Duplicate asset id: ${duplicate}`);
  const sceneIds = new Set((scene?.elements ?? []).map((item) => item.id));
  const sceneElements = new Map((scene?.elements ?? []).map((item) => [item.id, item]));
  const jobsById = new Map((manifest.jobs ?? []).map((job) => [job.id, job]));
  for (const job of manifest.jobs ?? []) {
    if (!job.id) errors.push("Every asset job needs an id.");
    if (!STRATEGIES.has(job.strategy)) errors.push(`Asset ${job.id} has unsupported strategy: ${job.strategy}`);
    if (!VECTOR_KINDS.has(job.vector_kind)) errors.push(`Asset ${job.id} must declare vector_kind native-vector or embedded-raster.`);
    if (!isObject(job.source) || !job.source.kind) errors.push(`Asset ${job.id} must declare a structured source with kind.`);
    if (!EDITABLE_LEVELS.has(job.editable_level)) errors.push(`Asset ${job.id} must declare editable_level.`);
    if (!ASSET_ROLES.has(job.asset_role)) errors.push(`Asset ${job.id} must declare a supported asset_role.`);
    validateBbox(job.bbox, `Asset ${job.id} bbox`, errors);
    if (!Array.isArray(job.source_element_ids) || job.source_element_ids.length === 0) {
      errors.push(`Asset ${job.id} must list source_element_ids.`);
    }
    for (const elementId of job.source_element_ids ?? []) {
      if (scene && !sceneIds.has(elementId)) errors.push(`Asset ${job.id} references unknown element: ${elementId}`);
    }
    if (job.strategy.startsWith("native-") && job.vector_kind !== "native-vector") {
      errors.push(`Native asset ${job.id} must use vector_kind native-vector.`);
    }
    if (["direct-extract", "regenerate-grounded"].includes(job.strategy) && job.vector_kind !== "embedded-raster") {
      errors.push(`Raster asset ${job.id} must use vector_kind embedded-raster.`);
    }
    if (job.strategy === "regenerate-grounded" && !String(job.prompt ?? "").trim()) {
      errors.push(`Regenerated asset ${job.id} must persist its prompt.`);
    }
    if (job.strategy === "regenerate-grounded" && job.source?.kind !== "imagegen") {
      errors.push(`Regenerated asset ${job.id} must declare imagegen as its source.`);
    }
    if (job.strategy === "regenerate-grounded" && job.background_requirement !== "transparent") {
      errors.push(`Regenerated asset ${job.id} must require a transparent background.`);
    }
    if (job.strategy === "regenerate-grounded" && job.status === "completed") {
      if (!Number.isFinite(Number(job.alpha?.transparent_fraction)) || Number(job.alpha.transparent_fraction) < 0.005) {
        errors.push(`Completed regenerated asset ${job.id} has not passed the transparent-background gate.`);
      }
      if (!Number.isFinite(Number(job.alpha?.visible_fraction)) || Number(job.alpha.visible_fraction) < 0.005) {
        errors.push(`Completed regenerated asset ${job.id} has not passed the visible-foreground gate.`);
      }
    }
    if (job.strategy === "direct-extract" && job.source?.approved_by_user !== true) {
      errors.push(`Direct extraction for ${job.id} requires explicit user approval; regenerate fine-grained visuals by default.`);
    }
    const imageSources = (job.source_element_ids ?? []).filter((id) => sceneElements.get(id)?.type === "image");
    if (imageSources.length > 0 && !["direct-extract", "regenerate-grounded"].includes(job.strategy)) {
      errors.push(`Image asset ${job.id} must use grounded regeneration or explicitly approved direct extraction.`);
    }
  }
  for (const element of scene?.elements ?? []) {
    if (element.type !== "image") continue;
    const job = jobsById.get(element.asset_id);
    if (!job) {
      errors.push(`Image element ${element.id} references missing asset job: ${element.asset_id}`);
      continue;
    }
    if (!(job.source_element_ids ?? []).includes(element.id)) {
      errors.push(`Asset ${job.id} must list image instance ${element.id} in source_element_ids.`);
    }
    if (element.strategy && element.strategy !== job.strategy) {
      errors.push(`Image element ${element.id} strategy ${element.strategy} does not match asset ${job.id} strategy ${job.strategy}.`);
    }
  }
  for (const duplicate of duplicateAssetGroups(manifest)) {
    errors.push(`Duplicate asset content ${duplicate.sha256}: ${duplicate.ids.join(", ")}`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function validationSummary(results) {
  const errors = [];
  const warnings = [];
  for (const [name, result] of Object.entries(results)) {
    for (const item of result.errors ?? []) errors.push(`${name}: ${item}`);
    for (const item of result.warnings ?? []) warnings.push(`${name}: ${item}`);
  }
  return { valid: errors.length === 0, errors, warnings };
}
