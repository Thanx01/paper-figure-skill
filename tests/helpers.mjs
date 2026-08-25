import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { loadJszip, loadSharp } from "../plugins/paper-figure-skill/skills/paper-figure/scripts/lib/runtime.mjs";
import { renderSceneSvg } from "../plugins/paper-figure-skill/skills/paper-figure/scripts/lib/svg.mjs";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..");
export const forgePath = path.join(
  repoRoot,
  "plugins/paper-figure-skill/skills/paper-figure/scripts/forge.mjs",
);

export async function json(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export function fixturePath(name, fileName) {
  return path.join(repoRoot, "tests", "fixtures", name, fileName);
}

export async function temporaryDirectory(prefix = "paper-figure-skill-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function runForge(args, options = {}) {
  let stdout;
  let stderr;
  try {
    ({ stdout, stderr } = await execFileAsync(process.execPath, [forgePath, ...args], {
      cwd: repoRoot,
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
      ...options,
    }));
  } catch (error) {
    throw new Error(String(error.stderr || error.message));
  }
  if (stderr.trim()) throw new Error(stderr);
  return JSON.parse(stdout);
}

async function syntheticRaster(width, height) {
  const sharp = await loadSharp();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#F4A261"/><stop offset="1" stop-color="#2A9D8F"/></linearGradient></defs>
    <rect x="8" y="8" width="${width - 16}" height="${height - 16}" rx="24" fill="url(#g)"/>
    <circle cx="${width * 0.36}" cy="${height * 0.5}" r="${height * 0.22}" fill="#FFFFFF" fill-opacity="0.86"/>
    <circle cx="${width * 0.64}" cy="${height * 0.5}" r="${height * 0.22}" fill="#264653" fill-opacity="0.9"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function createMasterFromFixture(name, outputPath) {
  const sharp = await loadSharp();
  const scene = await json(fixturePath(name, "scene-graph.json"));
  const manifest = await json(fixturePath(name, "assets-manifest.json"));
  const staging = await temporaryDirectory("paper-diagram-master-");
  await fs.mkdir(path.join(staging, "assets/png"), { recursive: true });
  for (const job of manifest.jobs) {
    if (job.vector_kind !== "embedded-raster") continue;
    const width = Math.max(1, Math.round(job.bbox[2] * scene.canvas.width));
    const height = Math.max(1, Math.round(job.bbox[3] * scene.canvas.height));
    await fs.writeFile(path.join(staging, "assets/png", `${job.id}.png`), await syntheticRaster(width, height));
    job.status = "completed";
    job.output_png = `assets/png/${job.id}.png`;
  }
  const svg = await renderSceneSvg(scene, manifest, staging);
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return outputPath;
}

export async function writeRecordedEditablePptx(outputPath, design) {
  const JSZip = await loadJszip();
  const zip = new JSZip();
  const shapeCount = design.required_modules.length + Object.keys(design.verbatim_text).length;
  const connectorCount = design.required_connections.length;
  const textRuns = Object.values(design.verbatim_text).map((value) => (typeof value === "string" ? value : value.text));
  const shapes = Array.from({ length: shapeCount }, (_, index) => `<p:sp><p:nvSpPr/><p:spPr/><p:txBody><a:p><a:r><a:t>${textRuns[index % Math.max(1, textRuns.length)] ?? "panel"}</a:t></a:r></a:p></p:txBody></p:sp>`).join("");
  const connectors = Array.from({ length: connectorCount }, () => "<p:cxnSp><p:nvCxnSpPr/><p:spPr/></p:cxnSp>").join("");
  zip.file("[Content_Types].xml", "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>");
  zip.file("ppt/presentation.xml", `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
  zip.file("ppt/slides/slide1.xml", `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${shapes}${connectors}</p:spTree></p:cSld></p:sld>`);
  await fs.writeFile(outputPath, await zip.generateAsync({ type: "nodebuffer" }));
  return outputPath;
}

export async function prepareRecordedRun(name, { resolveAssets = true, outputDirectory = false } = {}) {
  const root = await temporaryDirectory(`paper-diagram-${name}-`);
  const master = path.join(root, "master.png");
  const runDir = path.join(root, "run");
  const requestPath = path.join(root, "request.json");
  await createMasterFromFixture(name, master);
  const deliveryDir = outputDirectory ? path.join(root, "delivery") : null;
  await fs.writeFile(
    requestPath,
    `${JSON.stringify({
      mode: "rebuild",
      master_image: master,
      ...(deliveryDir ? { output_dir: deliveryDir } : {}),
      qa_thresholds: {
        global_diff_ratio: 0.08,
        direct_extract_diff_ratio: 0.03,
        native_diff_ratio: 0.08,
        regenerated_diff_ratio: 0.15,
      },
    }, null, 2)}\n`,
  );
  await runForge(["init", "--request", requestPath, "--run-dir", runDir]);
  await runForge(["record", "--run-dir", runDir, "--stage", "design", "--artifact", fixturePath(name, "design-spec.json")]);
  await runForge(["record", "--run-dir", runDir, "--stage", "scene", "--artifact", fixturePath(name, "scene-graph.json")]);
  await runForge(["record", "--run-dir", runDir, "--stage", "assets", "--artifact", fixturePath(name, "assets-manifest.json")]);
  const manifest = await json(path.join(runDir, "assets-manifest.json"));
  const scene = await json(path.join(runDir, "scene-graph.json"));
  if (resolveAssets) {
    for (const job of manifest.jobs.filter((item) => item.status !== "completed")) {
      if (job.strategy === "regenerate-grounded") {
        const width = Math.max(1, Math.round(job.bbox[2] * scene.canvas.width));
        const height = Math.max(1, Math.round(job.bbox[3] * scene.canvas.height));
        const recorded = path.join(root, `${job.id}-recorded.png`);
        await fs.writeFile(recorded, await syntheticRaster(width, height));
        await runForge(["record", "--run-dir", runDir, "--asset-id", job.id, "--artifact", recorded]);
      } else {
        await runForge(["record", "--run-dir", runDir, "--asset-id", job.id, "--from-master"]);
      }
    }
  }
  return { root, runDir, master, deliveryDir, design: await json(fixturePath(name, "design-spec.json")) };
}
