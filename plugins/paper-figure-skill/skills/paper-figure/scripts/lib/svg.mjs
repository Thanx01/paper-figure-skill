import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteText, bboxPixels, ensureDir, exists, sha256File } from "./common.mjs";
import { loadSharp } from "./runtime.mjs";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function color(value, fallback = "none") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function rotationTransform(element, box) {
  const rotation = number(element.rotation ?? element.style?.rotation, 0);
  if (!rotation) return "";
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  return ` transform="rotate(${rotation} ${cx} ${cy})"`;
}

function shapeSvg(element, canvas) {
  const box = bboxPixels(element.bbox, canvas);
  const style = element.style ?? {};
  const fill = color(style.fill, "none");
  const stroke = color(style.stroke, "none");
  const strokeWidth = number(style.stroke_width, 1.5);
  const opacity = number(style.opacity, 1);
  const dash = style.dash ? ` stroke-dasharray="${escapeXml(style.dash)}"` : "";
  const common = `fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}" opacity="${opacity}"${dash}${rotationTransform(element, box)}`;
  const geometry = element.geometry ?? "rect";
  if (geometry === "ellipse") {
    return `<ellipse id="${escapeXml(element.id)}" cx="${box.left + box.width / 2}" cy="${box.top + box.height / 2}" rx="${box.width / 2}" ry="${box.height / 2}" ${common}/>`;
  }
  if (geometry === "diamond") {
    const points = [
      [box.left + box.width / 2, box.top],
      [box.left + box.width, box.top + box.height / 2],
      [box.left + box.width / 2, box.top + box.height],
      [box.left, box.top + box.height / 2],
    ].map((point) => point.join(",")).join(" ");
    return `<polygon id="${escapeXml(element.id)}" points="${points}" ${common}/>`;
  }
  if (geometry === "rightArrow") {
    const shaft = box.width * 0.68;
    const inset = box.height * 0.22;
    const points = [
      [box.left, box.top + inset],
      [box.left + shaft, box.top + inset],
      [box.left + shaft, box.top],
      [box.left + box.width, box.top + box.height / 2],
      [box.left + shaft, box.top + box.height],
      [box.left + shaft, box.top + box.height - inset],
      [box.left, box.top + box.height - inset],
    ].map((point) => point.join(",")).join(" ");
    return `<polygon id="${escapeXml(element.id)}" points="${points}" ${common}/>`;
  }
  const radius = geometry === "roundRect" ? number(style.radius, Math.min(box.width, box.height) * 0.08) : 0;
  return `<rect id="${escapeXml(element.id)}" x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" rx="${radius}" ${common}/>`;
}

function textSvg(element, canvas) {
  const box = bboxPixels(element.bbox, canvas);
  const style = element.style ?? {};
  const align = style.align ?? "center";
  const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
  const x = align === "left" ? box.left : align === "right" ? box.left + box.width : box.left + box.width / 2;
  const lines = String(element.text ?? "").split("\n");
  const fontSize = number(style.font_size, Math.max(12, Math.min(box.height * 0.55, canvas.width * 0.025)));
  const lineHeight = number(style.line_height, fontSize * 1.18);
  const totalHeight = (lines.length - 1) * lineHeight;
  const startY = box.top + box.height / 2 - totalHeight / 2 + fontSize * 0.35;
  const family = escapeXml(style.font_family ?? "Arial, Helvetica, sans-serif");
  const weight = escapeXml(style.font_weight ?? (style.bold ? "700" : "400"));
  const fill = escapeXml(color(style.fill, "#202733"));
  const opacity = number(style.opacity, 1);
  const tspans = lines
    .map((line, index) => `<tspan x="${x}" y="${startY + index * lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");
  return `<text id="${escapeXml(element.id)}" text-anchor="${anchor}" font-family="${family}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}" opacity="${opacity}"${rotationTransform(element, box)}>${tspans}</text>`;
}

function anchorPoint(element, side, canvas) {
  const box = bboxPixels(element.bbox, canvas);
  if (side === "left") return [box.left, box.top + box.height / 2];
  if (side === "right") return [box.left + box.width, box.top + box.height / 2];
  if (side === "top") return [box.left + box.width / 2, box.top];
  if (side === "bottom") return [box.left + box.width / 2, box.top + box.height];
  return [box.left + box.width / 2, box.top + box.height / 2];
}

function autoSides(from, to, canvas) {
  const a = anchorPoint(from, "center", canvas);
  const b = anchorPoint(to, "center", canvas);
  if (Math.abs(a[0] - b[0]) >= Math.abs(a[1] - b[1])) {
    return a[0] <= b[0] ? ["right", "left"] : ["left", "right"];
  }
  return a[1] <= b[1] ? ["bottom", "top"] : ["top", "bottom"];
}

function connectorSvg(element, canvas, byId) {
  const from = byId.get(element.from);
  const to = byId.get(element.to);
  if (!from || !to) return "";
  const [autoFrom, autoTo] = autoSides(from, to, canvas);
  const fromSide = element.from_side ?? autoFrom;
  const toSide = element.to_side ?? autoTo;
  const start = anchorPoint(from, fromSide, canvas);
  const end = anchorPoint(to, toSide, canvas);
  const style = element.style ?? {};
  const stroke = escapeXml(color(style.stroke, "#475569"));
  const width = number(style.stroke_width, 2);
  const dash = style.dash ? ` stroke-dasharray="${escapeXml(style.dash)}"` : "";
  const marker = style.arrow_end === false ? "" : ' marker-end="url(#forge-arrow)"';
  const points = Array.isArray(element.points)
    ? element.points.map((point) => [point[0] * canvas.width, point[1] * canvas.height])
    : null;
  let d;
  if (points?.length) {
    d = `M ${start[0]} ${start[1]} ${points.map((point) => `L ${point[0]} ${point[1]}`).join(" ")} L ${end[0]} ${end[1]}`;
  } else if ((element.kind ?? "straight").startsWith("elbow")) {
    const horizontal = fromSide === "left" || fromSide === "right";
    d = horizontal
      ? `M ${start[0]} ${start[1]} H ${(start[0] + end[0]) / 2} V ${end[1]} H ${end[0]}`
      : `M ${start[0]} ${start[1]} V ${(start[1] + end[1]) / 2} H ${end[0]} V ${end[1]}`;
  } else {
    d = `M ${start[0]} ${start[1]} L ${end[0]} ${end[1]}`;
  }
  return `<path id="${escapeXml(element.id)}" d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}"${dash}${marker}/>`;
}

async function imageSvg(element, canvas, assetById, runDir) {
  const box = bboxPixels(element.bbox, canvas);
  const asset = assetById.get(element.asset_id);
  if (!asset) throw new Error(`Image element ${element.id} references unknown asset ${element.asset_id}`);
  const source = path.join(runDir, asset.output_png ?? `assets/png/${asset.id}.png`);
  if (!(await exists(source))) throw new Error(`Asset PNG is missing for ${element.id}: ${source}`);
  const bytes = await fs.readFile(source);
  const href = `data:image/png;base64,${bytes.toString("base64")}`;
  return `<image id="${escapeXml(element.id)}" x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid meet" href="${href}"${rotationTransform(element, box)}/>`;
}

function svgHeader(canvas, viewBox = [0, 0, canvas.width, canvas.height]) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${viewBox[2]}" height="${viewBox[3]}" viewBox="${viewBox.join(" ")}">\n<defs><marker id="forge-arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="context-stroke"/></marker></defs>`;
}

export async function renderSceneSvg(scene, manifest, runDir, { elements = null, viewBox = null, metadata = null } = {}) {
  const selected = (elements ?? scene.elements).filter((element) => element.type !== "group");
  const byId = new Map(scene.elements.map((element) => [element.id, element]));
  const assetById = new Map((manifest.jobs ?? []).map((job) => [job.id, job]));
  const body = [];
  if (metadata) body.push(`<metadata>${escapeXml(JSON.stringify(metadata))}</metadata>`);
  if (elements === null && scene.background && scene.background !== "none") {
    body.push(`<rect id="forge-background" x="0" y="0" width="${scene.canvas.width}" height="${scene.canvas.height}" fill="${escapeXml(scene.background)}"/>`);
  }
  const ordered = [...selected].sort((a, b) => number(a.z_index, 0) - number(b.z_index, 0));
  for (const element of ordered.filter((item) => item.type === "connector")) {
    body.push(connectorSvg(element, scene.canvas, byId));
  }
  for (const element of ordered.filter((item) => item.type !== "connector")) {
    if (element.type === "shape") body.push(shapeSvg(element, scene.canvas));
    else if (element.type === "text") body.push(textSvg(element, scene.canvas));
    else if (element.type === "image") body.push(await imageSvg(element, scene.canvas, assetById, runDir));
  }
  return `${svgHeader(scene.canvas, viewBox ?? undefined)}\n${body.join("\n")}\n</svg>\n`;
}

export async function writeCompositeSvg(scene, manifest, runDir) {
  const output = path.join(runDir, "framework.svg");
  const svg = await renderSceneSvg(scene, manifest, runDir, {
    metadata: { generator: "paper-figure-skill", schema_version: "1.0" },
  });
  await atomicWriteText(output, svg);
  return output;
}

export async function writeAssetSvgs(scene, manifest, runDir) {
  const svgDir = await ensureDir(path.join(runDir, "assets/svg"));
  const pngDir = await ensureDir(path.join(runDir, "assets/png"));
  const sharp = await loadSharp();
  const outputs = [];
  for (const job of manifest.jobs ?? []) {
    const outputSvg = path.join(svgDir, `${job.id}.svg`);
    const outputPng = path.join(pngDir, `${job.id}.png`);
    const box = bboxPixels(job.bbox, scene.canvas);
    if (job.vector_kind === "embedded-raster") {
      if (!(await exists(outputPng))) throw new Error(`Embedded-raster asset is missing PNG: ${outputPng}`);
      const bytes = await fs.readFile(outputPng);
      const href = `data:image/png;base64,${bytes.toString("base64")}`;
      const svg = `${svgHeader({ width: box.width, height: box.height })}\n<metadata>${escapeXml(JSON.stringify({ id: job.id, vector_kind: job.vector_kind, strategy: job.strategy }))}</metadata>\n<image x="0" y="0" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid meet" href="${href}"/>\n</svg>\n`;
      await atomicWriteText(outputSvg, svg);
    } else {
      const selected = scene.elements.filter((element) => job.source_element_ids.includes(element.id));
      const svg = await renderSceneSvg(scene, manifest, runDir, {
        elements: selected,
        viewBox: [box.left, box.top, box.width, box.height],
        metadata: { id: job.id, vector_kind: job.vector_kind, strategy: job.strategy },
      });
      await atomicWriteText(outputSvg, svg);
      await sharp(Buffer.from(svg)).png().toFile(outputPng);
    }
    job.output_svg = `assets/svg/${job.id}.svg`;
    job.output_png = `assets/png/${job.id}.png`;
    job.sha256_svg = await sha256File(outputSvg);
    job.sha256_png = await sha256File(outputPng);
    outputs.push(outputSvg, outputPng);
  }
  return outputs;
}

export async function renderSvgToPng(svgPath, pngPath) {
  const sharp = await loadSharp();
  await sharp(svgPath).png().toFile(pngPath);
  return pngPath;
}
