import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson, bboxPixels, ensureDir, exists, readJson } from "./common.mjs";
import { validateAssetManifest, validateDesignSpec, validateSceneGraph, validationSummary } from "./contracts.mjs";
import { loadArtifactTool } from "./runtime.mjs";
import { loadState, saveState, setStage } from "./state.mjs";
import { renderSvgToPng, writeAssetSvgs, writeCompositeSvg } from "./svg.mjs";

function lineStyle(style = {}) {
  return {
    style: style.dash ? "dashed" : "solid",
    fill: style.stroke ?? "#475569",
    width: Number(style.stroke_width ?? 1.5),
  };
}

function shapeGeometry(geometry) {
  if (geometry === "diamond") return "diamond";
  if (geometry === "ellipse") return "ellipse";
  if (geometry === "rightArrow") return "rightArrow";
  if (geometry === "roundRect") return "roundRect";
  return "rect";
}

function connectorSides(from, to) {
  const fromCenter = [from.left + from.width / 2, from.top + from.height / 2];
  const toCenter = [to.left + to.width / 2, to.top + to.height / 2];
  if (Math.abs(toCenter[0] - fromCenter[0]) >= Math.abs(toCenter[1] - fromCenter[1])) {
    return toCenter[0] >= fromCenter[0] ? ["right", "left"] : ["left", "right"];
  }
  return toCenter[1] >= fromCenter[1] ? ["bottom", "top"] : ["top", "bottom"];
}

async function suppressArtifactToolConsole(action) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await action();
  } finally {
    console.log = originalLog;
  }
}

async function buildPptx(runDir, scene, manifest) {
  const { Presentation, PresentationFile } = await loadArtifactTool();
  const presentation = Presentation.create({ slideSize: scene.canvas });
  const slide = presentation.slides.add();
  slide.background.fill = scene.background ?? "#FFFFFF";
  const byId = new Map(scene.elements.map((element) => [element.id, element]));
  const assetById = new Map((manifest.jobs ?? []).map((job) => [job.id, job]));
  const facades = new Map();
  const ordered = [...scene.elements].sort((a, b) => Number(a.z_index ?? 0) - Number(b.z_index ?? 0));

  for (const element of ordered.filter((item) => ["shape", "image", "text"].includes(item.type))) {
    if (element.type === "shape") {
      const style = element.style ?? {};
      const shape = slide.shapes.add({
        geometry: shapeGeometry(element.geometry),
        name: element.id,
        position: { ...bboxPixels(element.bbox, scene.canvas), rotation: Number(element.rotation ?? 0) },
        fill: style.fill ?? "none",
        line: lineStyle(style),
        ...(element.geometry === "roundRect" ? { borderRadius: Number(style.radius ?? 12) } : {}),
        ...(style.shadow ? { shadow: style.shadow } : {}),
      });
      facades.set(element.id, shape);
    } else if (element.type === "image") {
      const asset = assetById.get(element.asset_id);
      if (!asset) throw new Error(`Unknown asset for PPTX image ${element.id}: ${element.asset_id}`);
      const imagePath = path.join(runDir, asset.output_png ?? `assets/png/${asset.id}.png`);
      const bytes = await fs.readFile(imagePath);
      const image = slide.images.add({
        blob: new Uint8Array(bytes),
        contentType: "image/png",
        alt: element.alt ?? element.id,
        fit: "contain",
        position: bboxPixels(element.bbox, scene.canvas),
        prompt: asset.prompt ?? undefined,
      });
      image.rotation = Number(element.rotation ?? 0);
      image.lockAspectRatio = true;
      facades.set(element.id, image);
    } else {
      const style = element.style ?? {};
      const textBox = slide.shapes.add({
        geometry: "textbox",
        name: element.id,
        position: { ...bboxPixels(element.bbox, scene.canvas), rotation: Number(element.rotation ?? 0) },
        fill: "none",
        line: { style: "solid", fill: "none", width: 0 },
      });
      textBox.text = element.text;
      textBox.text.style = {
        fontSize: Number(style.font_size ?? 18),
        bold: Boolean(style.bold || String(style.font_weight ?? "") === "700"),
        color: style.fill ?? "#202733",
        alignment: style.align ?? "center",
        fontFamily: style.font_family ?? "Arial",
      };
      facades.set(element.id, textBox);
    }
  }

  for (const element of ordered.filter((item) => item.type === "connector")) {
    const source = facades.get(element.from);
    const target = facades.get(element.to);
    const sourceElement = byId.get(element.from);
    const targetElement = byId.get(element.to);
    if (!source || !target || !sourceElement?.bbox || !targetElement?.bbox) continue;
    const sourceBox = bboxPixels(sourceElement.bbox, scene.canvas);
    const targetBox = bboxPixels(targetElement.bbox, scene.canvas);
    const [autoFrom, autoTo] = connectorSides(sourceBox, targetBox);
    const connector = slide.shapes.connect(source, target, {
      kind: element.kind ?? "straight",
      fromSide: element.from_side ?? autoFrom,
      toSide: element.to_side ?? autoTo,
      line: lineStyle(element.style),
      ...(element.style?.arrow_end === false ? {} : { tail: { type: "arrow", width: "med", length: "med" } }),
    });
    connector.sendToBack();
  }

  slide.speakerNotes.textFrame.setText(
    "[Sources]\nVisual source: canonical-master.png\nSemantic source: design-spec.json\nAsset provenance: assets-manifest.json",
  );

  const buildDir = await ensureDir(path.join(runDir, "build"));
  const preview = await presentation.export({ slide, format: "png", scale: 1 });
  await fs.writeFile(path.join(buildDir, "rendered-pptx.png"), new Uint8Array(await preview.arrayBuffer()));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(path.join(buildDir, "slide.layout.json"), await layout.text(), "utf8");
  await suppressArtifactToolConsole(async () => {
    const pptx = await PresentationFile.exportPptx(presentation);
    await pptx.save(path.join(runDir, "framework.pptx"));
  });
  return {
    pptx: path.join(runDir, "framework.pptx"),
    preview: path.join(buildDir, "rendered-pptx.png"),
    layout: path.join(buildDir, "slide.layout.json"),
  };
}

export async function buildRun(runDir, { skipPptx = false } = {}) {
  const design = await readJson(path.join(runDir, "design-spec.json"));
  const scene = await readJson(path.join(runDir, "scene-graph.json"));
  const manifest = await readJson(path.join(runDir, "assets-manifest.json"));
  const validation = validationSummary({
    design: validateDesignSpec(design),
    scene: validateSceneGraph(scene),
    assets: validateAssetManifest(manifest, scene),
  });
  if (!validation.valid) throw new Error(`Build contracts are invalid:\n${validation.errors.join("\n")}`);
  const pending = manifest.jobs.filter((job) => job.status !== "completed");
  if (pending.length) throw new Error(`Asset jobs are still pending: ${pending.map((job) => job.id).join(", ")}`);

  await ensureDir(path.join(runDir, "build"));
  const assetOutputs = await writeAssetSvgs(scene, manifest, runDir);
  await atomicWriteJson(path.join(runDir, "assets-manifest.json"), manifest);
  const compositeSvg = await writeCompositeSvg(scene, manifest, runDir);
  const svgPreview = await renderSvgToPng(compositeSvg, path.join(runDir, "build/rendered-svg.png"));
  let pptxOutputs = null;
  if (!skipPptx) pptxOutputs = await buildPptx(runDir, scene, manifest);
  const finalPreview = pptxOutputs?.preview ?? svgPreview;
  await fs.copyFile(finalPreview, path.join(runDir, "framework.png"));

  const state = await loadState(runDir);
  setStage(state, "svg", "completed", {
    artifacts: ["framework.svg", ...assetOutputs.map((item) => path.relative(runDir, item))],
  });
  setStage(state, "build", "completed", {
    artifacts: ["framework.png", ...(pptxOutputs ? ["framework.pptx", "build/rendered-pptx.png"] : ["build/rendered-svg.png"])],
    note: skipPptx ? "Replay build skipped PPTX because no Codex presentation runtime was requested." : null,
  });
  state.stages.qa.status = "pending";
  state.stages.qa.note = "Build changed; QA must be rerun.";
  state.stages.package.status = "pending";
  state.stages.package.note = "Build changed; package must be regenerated after QA.";
  await saveState(runDir, state);
  return {
    validation,
    framework_svg: compositeSvg,
    framework_png: path.join(runDir, "framework.png"),
    framework_pptx: pptxOutputs?.pptx ?? null,
    pptx_preview: pptxOutputs?.preview ?? null,
  };
}

export async function assertBuildReady(runDir) {
  const required = ["design-spec.json", "canonical-master.png", "scene-graph.json", "assets-manifest.json"];
  const missing = [];
  for (const item of required) if (!(await exists(path.join(runDir, item)))) missing.push(item);
  if (missing.length) throw new Error(`Run is not build-ready; missing: ${missing.join(", ")}`);
  return true;
}
