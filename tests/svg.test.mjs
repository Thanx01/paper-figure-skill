import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { writeAssetSvgs, writeCompositeSvg } from "../plugins/paper-figure-skill/skills/paper-figure/scripts/lib/svg.mjs";
import { fixturePath, json, temporaryDirectory } from "./helpers.mjs";
import { loadSharp } from "../plugins/paper-figure-skill/skills/paper-figure/scripts/lib/runtime.mjs";

test("native SVGs contain paths/shapes while hybrid SVGs disclose embedded PNG", async () => {
  const runDir = await temporaryDirectory("paper-diagram-svg-");
  const scene = await json(fixturePath("hybrid", "scene-graph.json"));
  const manifest = await json(fixturePath("hybrid", "assets-manifest.json"));
  const sharp = await loadSharp();
  await fs.mkdir(path.join(runDir, "assets/png"), { recursive: true });
  await sharp({ create: { width: 192, height: 135, channels: 4, background: "#F4A261" } }).png().toFile(path.join(runDir, "assets/png/grounded-visual-asset.png"));
  for (const job of manifest.jobs) job.status = "completed";
  await writeAssetSvgs(scene, manifest, runDir);
  await writeCompositeSvg(scene, manifest, runDir);
  const nativeSvg = await fs.readFile(path.join(runDir, "assets/svg/encoder-component.svg"), "utf8");
  const rasterSvg = await fs.readFile(path.join(runDir, "assets/svg/grounded-visual-asset.svg"), "utf8");
  assert.match(nativeSvg, /viewBox=/);
  assert.doesNotMatch(nativeSvg, /<image\b/);
  assert.match(nativeSvg, /native-vector/);
  assert.match(rasterSvg, /viewBox=/);
  assert.match(rasterSvg, /<image\b/);
  assert.match(rasterSvg, /embedded-raster/);
  assert.doesNotMatch(rasterSvg, /href="(?:https?:|file:)/i);
});
