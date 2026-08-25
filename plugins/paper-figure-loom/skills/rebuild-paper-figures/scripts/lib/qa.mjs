import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson, bboxPixels, ensureDir, exists, readJson } from "./common.mjs";
import { duplicateAssetGroups } from "./contracts.mjs";
import { loadJszip, loadPixelmatch, loadSharp } from "./runtime.mjs";
import { blockRun, loadState, saveState, setStage } from "./state.mjs";

function textValue(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.text === "string") return value.text;
  return null;
}

function overlapRatio(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  if (x2 <= x1 || y2 <= y1) return 0;
  const intersection = (x2 - x1) * (y2 - y1);
  return intersection / Math.min(a[2] * a[3], b[2] * b[3]);
}

async function structuralChecks(runDir, design, scene, manifest, thresholds) {
  const errors = [];
  const warnings = [];
  const ids = new Set(scene.elements.map((element) => element.id));
  const byId = new Map(scene.elements.map((element) => [element.id, element]));
  const requiredModules = design.required_modules ?? [];
  const requiredConnections = design.required_connections ?? [];
  for (const module of requiredModules) {
    const sceneId = module.scene_element_id ?? module.id;
    if (!ids.has(sceneId)) errors.push(`Missing required module element: ${sceneId}`);
  }
  for (const connection of requiredConnections) {
    const sceneId = connection.scene_element_id ?? connection.id;
    const element = byId.get(sceneId);
    if (!element || element.type !== "connector") errors.push(`Missing required connector: ${sceneId}`);
  }
  for (const [textId, expectedValue] of Object.entries(design.verbatim_text ?? {})) {
    const expected = textValue(expectedValue);
    const actual = byId.get(textId);
    if (!actual || actual.type !== "text") errors.push(`Missing native text element: ${textId}`);
    else if (expected !== null && actual.text !== expected) errors.push(`Verbatim text differs for ${textId}.`);
  }
  for (const job of manifest.jobs ?? []) {
    if (job.status !== "completed") errors.push(`Asset job is not completed: ${job.id}`);
    const svgPath = path.join(runDir, job.output_svg ?? `assets/svg/${job.id}.svg`);
    const pngPath = path.join(runDir, job.output_png ?? `assets/png/${job.id}.png`);
    if (!(await exists(svgPath))) errors.push(`Missing asset SVG: ${job.id}`);
    if (!(await exists(pngPath))) errors.push(`Missing asset PNG: ${job.id}`);
    if (await exists(svgPath)) {
      const svg = await fs.readFile(svgPath, "utf8");
      if (!/viewBox="[^"]+"/.test(svg)) errors.push(`Asset SVG has no viewBox: ${job.id}`);
      if (/href="(?:https?:|file:)/i.test(svg)) errors.push(`Asset SVG uses an external resource: ${job.id}`);
      if (job.vector_kind === "native-vector" && /<image\b/.test(svg)) errors.push(`Native vector asset contains <image>: ${job.id}`);
      if (job.vector_kind === "embedded-raster" && !/<image\b/.test(svg)) errors.push(`Embedded raster asset has no <image>: ${job.id}`);
    }
  }
  for (const duplicate of duplicateAssetGroups(manifest)) {
    errors.push(`Duplicate reusable assets must share one manifest job: ${duplicate.ids.join(", ")}`);
  }
  const topLevelModules = scene.elements.filter(
    (element) => element.qa_role === "module" && !element.parent && !element.allow_overlap && Array.isArray(element.bbox),
  );
  for (let left = 0; left < topLevelModules.length; left += 1) {
    for (let right = left + 1; right < topLevelModules.length; right += 1) {
      const ratio = overlapRatio(topLevelModules[left].bbox, topLevelModules[right].bbox);
      if (ratio > 0.02) errors.push(`Unapproved module overlap: ${topLevelModules[left].id} and ${topLevelModules[right].id}`);
    }
  }
  for (const element of scene.elements) {
    if (!Array.isArray(element.bbox)) continue;
    const [x, y, width, height] = element.bbox.map(Number);
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) {
      errors.push(`Element is outside canvas: ${element.id}`);
    }
  }

  let centerError = 0;
  let sizeError = 0;
  let aspectError = 0;
  for (const [elementId, expected] of Object.entries(design.expected_geometry ?? {})) {
    const actual = byId.get(elementId)?.bbox;
    if (!Array.isArray(actual)) {
      errors.push(`Expected geometry has no scene bbox: ${elementId}`);
      continue;
    }
    const expectedCenter = [expected[0] + expected[2] / 2, expected[1] + expected[3] / 2];
    const actualCenter = [actual[0] + actual[2] / 2, actual[1] + actual[3] / 2];
    centerError = Math.max(centerError, Math.abs(expectedCenter[0] - actualCenter[0]), Math.abs(expectedCenter[1] - actualCenter[1]));
    sizeError = Math.max(sizeError, Math.abs(expected[2] - actual[2]), Math.abs(expected[3] - actual[3]));
    const expectedAspect = expected[2] / expected[3];
    const actualAspect = actual[2] / actual[3];
    aspectError = Math.max(aspectError, Math.abs(actualAspect / expectedAspect - 1));
  }
  if (centerError > thresholds.center_error) errors.push(`Maximum element center error ${centerError} exceeds ${thresholds.center_error}.`);
  if (sizeError > thresholds.size_error) errors.push(`Maximum element size error ${sizeError} exceeds ${thresholds.size_error}.`);
  if (aspectError > thresholds.aspect_error) errors.push(`Maximum element aspect error ${aspectError} exceeds ${thresholds.aspect_error}.`);

  const pptxPath = path.join(runDir, "framework.pptx");
  let editability = {
    checked: false,
    native_shapes: 0,
    native_connectors: 0,
    pictures: 0,
    native_text_runs: 0,
    full_slide_pictures: 0,
    full_slide_flattening: false,
  };
  if (await exists(pptxPath)) {
    try {
      editability = await inspectPptxEditability(pptxPath);
      if (editability.full_slide_flattening || editability.full_slide_pictures > 0) {
        errors.push("PPTX contains a near-full-slide picture and may be using a flattened master as a fidelity shortcut.");
      }
      if (editability.native_text_runs < Object.keys(design.verbatim_text ?? {}).length) {
        errors.push("PPTX has fewer native text runs than the design contract requires.");
      }
      if (editability.native_connectors < requiredConnections.length) {
        errors.push("PPTX has fewer native connectors than the design contract requires.");
      }
      if (editability.native_shapes < requiredModules.length + Object.keys(design.verbatim_text ?? {}).length) {
        errors.push("PPTX has fewer native shapes/text boxes than the design contract requires.");
      }
    } catch (error) {
      errors.push(`Could not inspect PPTX editability: ${error.message}`);
    }
  } else {
    warnings.push("PPTX editability was not checked because framework.pptx is absent.");
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    counts: {
      required_modules: requiredModules.length,
      required_connections: requiredConnections.length,
      verbatim_text: Object.keys(design.verbatim_text ?? {}).length,
      scene_elements: scene.elements.length,
      asset_jobs: manifest.jobs.length,
    },
    editability,
    geometry: {
      source: Object.keys(design.expected_geometry ?? {}).length ? "design_spec_expected_geometry" : "scene_graph_exact",
      expected_elements: Object.keys(design.expected_geometry ?? {}).length,
      center_error: centerError,
      size_error: sizeError,
      aspect_error: aspectError,
      thresholds: {
        center_error: thresholds.center_error,
        size_error: thresholds.size_error,
        aspect_error: thresholds.aspect_error,
      },
    },
  };
}

function numericAttribute(xml, name) {
  const match = xml.match(new RegExp(`${name}="(\\d+)"`));
  return match ? Number(match[1]) : null;
}

export async function inspectPptxEditability(pptxPath) {
  const JSZip = await loadJszip();
  const archive = await JSZip.loadAsync(await fs.readFile(pptxPath));
  const slideXml = await archive.file("ppt/slides/slide1.xml")?.async("string");
  if (!slideXml) throw new Error("PPTX is missing ppt/slides/slide1.xml.");
  const presentationXml = await archive.file("ppt/presentation.xml")?.async("string");
  const slideSizeMatch = presentationXml?.match(/<p:sldSz\b[^>]*>/)?.[0] ?? "";
  const slideWidth = numericAttribute(slideSizeMatch, "cx");
  const slideHeight = numericAttribute(slideSizeMatch, "cy");
  const pictureBlocks = slideXml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? [];
  let fullSlidePictures = 0;
  if (slideWidth && slideHeight) {
    for (const block of pictureBlocks) {
      const transform = block.match(/<a:xfrm\b[^>]*>[\s\S]*?<\/a:xfrm>/)?.[0] ?? "";
      const offset = transform.match(/<a:off\b[^>]*\/>/)?.[0] ?? "";
      const extent = transform.match(/<a:ext\b[^>]*\/>/)?.[0] ?? "";
      const x = numericAttribute(offset, "x");
      const y = numericAttribute(offset, "y");
      const width = numericAttribute(extent, "cx");
      const height = numericAttribute(extent, "cy");
      if (x !== null && y !== null && width !== null && height !== null) {
        const coversWidth = width / slideWidth >= 0.95;
        const coversHeight = height / slideHeight >= 0.95;
        const startsNearOrigin = x / slideWidth <= 0.025 && y / slideHeight <= 0.025;
        if (coversWidth && coversHeight && startsNearOrigin) fullSlidePictures += 1;
      }
    }
  }
  const result = {
    checked: true,
    native_shapes: (slideXml.match(/<p:sp>/g) ?? []).length,
    native_connectors: (slideXml.match(/<p:cxnSp>/g) ?? []).length,
    pictures: pictureBlocks.length,
    native_text_runs: (slideXml.match(/<a:t>/g) ?? []).length,
    full_slide_pictures: fullSlidePictures,
    full_slide_flattening: false,
  };
  result.full_slide_flattening = result.pictures === 1 && result.native_shapes === 0 && result.native_connectors === 0;
  return result;
}

function maskRegions(rawA, rawB, width, regions, canvas) {
  let maskedPixels = 0;
  for (const bbox of regions) {
    const box = bboxPixels(bbox, canvas);
    const left = Math.max(0, Math.floor(box.left));
    const top = Math.max(0, Math.floor(box.top));
    const right = Math.min(width, Math.ceil(box.left + box.width));
    const bottom = Math.min(canvas.height, Math.ceil(box.top + box.height));
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const index = (y * width + x) * 4;
        rawB[index] = rawA[index];
        rawB[index + 1] = rawA[index + 1];
        rawB[index + 2] = rawA[index + 2];
        rawB[index + 3] = rawA[index + 3];
        maskedPixels += 1;
      }
    }
  }
  return maskedPixels;
}

async function visualChecks(runDir, scene, manifest, thresholds) {
  const sharp = await loadSharp();
  const pixelmatch = await loadPixelmatch();
  const qaDir = await ensureDir(path.join(runDir, "qa"));
  const targetPath = path.join(runDir, "canonical-master.png");
  const candidatePath = (await exists(path.join(runDir, "build/rendered-pptx.png")))
    ? path.join(runDir, "build/rendered-pptx.png")
    : path.join(runDir, "framework.png");
  const width = Number(scene.canvas.width);
  const height = Number(scene.canvas.height);
  const target = await sharp(targetPath).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  const candidate = await sharp(candidatePath).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  const textRegions = scene.elements.filter((element) => element.type === "text").map((element) => element.bbox);
  const candidateMasked = Buffer.from(candidate);
  const maskedPixels = maskRegions(target, candidateMasked, width, textRegions, scene.canvas);
  const diff = Buffer.alloc(width * height * 4);
  const differentPixels = pixelmatch(target, candidateMasked, diff, width, height, { threshold: 0.1, includeAA: false });
  const comparablePixels = Math.max(1, width * height - maskedPixels);
  const diffRatio = differentPixels / comparablePixels;
  await sharp(diff, { raw: { width, height, channels: 4 } }).png().toFile(path.join(qaDir, "diff.png"));

  const masterPng = await sharp(target, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const candidatePng = await sharp(candidate, { raw: { width, height, channels: 4 } }).png().toBuffer();
  await sharp({ create: { width: width * 2, height, channels: 4, background: "#ffffff" } })
    .composite([{ input: masterPng, left: 0, top: 0 }, { input: candidatePng, left: width, top: 0 }])
    .png()
    .toFile(path.join(qaDir, "side-by-side.png"));
  const translucentCandidate = await sharp(candidatePng)
    .ensureAlpha()
    .linear([1, 1, 1, 0.5], [0, 0, 0, 0])
    .png()
    .toBuffer();
  await sharp(masterPng)
    .composite([{ input: translucentCandidate, blend: "over" }])
    .png()
    .toFile(path.join(qaDir, "overlay.png"));

  const labels = scene.elements
    .filter((element) => Array.isArray(element.bbox))
    .map((element) => {
      const box = bboxPixels(element.bbox, scene.canvas);
      return `<rect x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" fill="none" stroke="#ff006e" stroke-width="2"/><text x="${box.left + 2}" y="${box.top + 13}" font-size="12" fill="#ff006e">${element.id.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</text>`;
    })
    .join("");
  const bboxSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labels}</svg>`;
  await sharp(masterPng).composite([{ input: Buffer.from(bboxSvg), left: 0, top: 0 }]).png().toFile(path.join(qaDir, "bboxes.png"));

  const regions = [];
  for (const job of manifest.jobs ?? []) {
    const box = bboxPixels(job.bbox, scene.canvas);
    const left = Math.max(0, Math.floor(box.left));
    const top = Math.max(0, Math.floor(box.top));
    const regionWidth = Math.max(1, Math.min(width - left, Math.ceil(box.width)));
    const regionHeight = Math.max(1, Math.min(height - top, Math.ceil(box.height)));
    const targetRegion = await sharp(masterPng).extract({ left, top, width: regionWidth, height: regionHeight }).ensureAlpha().raw().toBuffer();
    const candidateRegion = await sharp(candidatePng).extract({ left, top, width: regionWidth, height: regionHeight }).ensureAlpha().raw().toBuffer();
    const regionDiff = Buffer.alloc(regionWidth * regionHeight * 4);
    const changed = pixelmatch(targetRegion, candidateRegion, regionDiff, regionWidth, regionHeight, { threshold: 0.1, includeAA: false });
    const ratio = changed / (regionWidth * regionHeight);
    const threshold = job.strategy === "direct-extract"
      ? thresholds.direct_extract_diff_ratio
      : job.strategy === "regenerate-grounded"
        ? thresholds.regenerated_diff_ratio
        : thresholds.native_diff_ratio;
    regions.push({ asset_id: job.id, strategy: job.strategy, diff_ratio: ratio, threshold, passed: ratio <= threshold });
  }
  const contactTiles = [];
  const tileWidth = 240;
  const tileHeight = 180;
  for (const [index, job] of (manifest.jobs ?? []).entries()) {
    const pngPath = path.join(runDir, job.output_png ?? `assets/png/${job.id}.png`);
    if (!(await exists(pngPath))) continue;
    const thumbnail = await sharp(pngPath)
      .resize(tileWidth - 24, tileHeight - 46, { fit: "contain", background: "#FFFFFF" })
      .extend({ top: 12, bottom: 34, left: 12, right: 12, background: "#FFFFFF" })
      .png()
      .toBuffer();
    const label = `<svg xmlns="http://www.w3.org/2000/svg" width="${tileWidth}" height="${tileHeight}"><rect width="100%" height="100%" fill="none" stroke="#CBD5E1"/><text x="12" y="${tileHeight - 12}" font-family="Arial" font-size="14" fill="#334155">${job.id.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</text></svg>`;
    contactTiles.push({ input: thumbnail, left: (index % 4) * tileWidth, top: Math.floor(index / 4) * tileHeight });
    contactTiles.push({ input: Buffer.from(label), left: (index % 4) * tileWidth, top: Math.floor(index / 4) * tileHeight });
  }
  if (contactTiles.length) {
    const rows = Math.ceil((manifest.jobs ?? []).length / 4);
    await sharp({ create: { width: tileWidth * 4, height: tileHeight * rows, channels: 4, background: "#F8FAFC" } })
      .composite(contactTiles)
      .png()
      .toFile(path.join(qaDir, "assets-contact-sheet.png"));
  }
  return {
    passed: diffRatio <= thresholds.global_diff_ratio && regions.every((region) => region.passed),
    global_diff_ratio: diffRatio,
    threshold: thresholds.global_diff_ratio,
    excluded_text_pixels: maskedPixels,
    compared_pixels: comparablePixels,
    candidate: path.relative(runDir, candidatePath),
    regions,
    artifacts: [
      "qa/diff.png",
      "qa/side-by-side.png",
      "qa/overlay.png",
      "qa/bboxes.png",
      ...((manifest.jobs ?? []).length ? ["qa/assets-contact-sheet.png"] : []),
    ],
  };
}

export async function runQa(runDir) {
  const [design, scene, manifest, state] = await Promise.all([
    readJson(path.join(runDir, "design-spec.json")),
    readJson(path.join(runDir, "scene-graph.json")),
    readJson(path.join(runDir, "assets-manifest.json")),
    loadState(runDir),
  ]);
  const structural = await structuralChecks(runDir, design, scene, manifest, state.request.qa_thresholds);
  const visual = await visualChecks(runDir, scene, manifest, state.request.qa_thresholds);
  const passed = structural.passed && visual.passed;
  const report = {
    schema_version: "1.0",
    passed,
    structural,
    visual,
    repair_round: state.repair.rounds + 1,
  };
  await atomicWriteJson(path.join(runDir, "qa-report.json"), report);

  state.repair.rounds += 1;
  const previousBest = state.repair.best_diff_ratio;
  if (previousBest === null || visual.global_diff_ratio < previousBest - 1e-6) {
    state.repair.best_diff_ratio = visual.global_diff_ratio;
    state.repair.no_improvement_rounds = 0;
  } else {
    state.repair.no_improvement_rounds += 1;
  }
  if (passed) {
    state.repair.awaiting_changes = false;
    setStage(state, "qa", "completed", { artifacts: ["qa-report.json", ...visual.artifacts] });
  } else if (
    state.repair.rounds >= state.request.budgets.max_repair_rounds ||
    state.repair.no_improvement_rounds >= state.request.budgets.stop_after_no_improvement_rounds
  ) {
    state.repair.awaiting_changes = false;
    blockRun(state, "qa", "Automated QA did not converge within the configured repair budget.", ["qa-report.json", ...visual.artifacts]);
  } else {
    state.repair.awaiting_changes = true;
    setStage(state, "qa", "pending", { artifacts: ["qa-report.json", ...visual.artifacts], note: "Element-level repair required." });
  }
  await saveState(runDir, state);
  return report;
}
