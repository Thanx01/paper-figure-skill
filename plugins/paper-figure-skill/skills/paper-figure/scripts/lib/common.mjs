import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const STAGES = [
  "preflight",
  "design",
  "master",
  "scene",
  "assets",
  "svg",
  "build",
  "qa",
  "package",
];

export function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

export function requiredArg(args, name) {
  const value = args[name];
  if (value === undefined || value === true || value === "") {
    throw new Error(`Missing required argument --${name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`);
  }
  return value;
}

export async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  return dirPath;
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function atomicWriteJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

export async function atomicWriteText(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, value, "utf8");
  await fs.rename(tempPath, filePath);
}

export async function sha256File(filePath) {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function nowIso() {
  return new Date().toISOString();
}

export function makeRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${crypto.randomBytes(3).toString("hex")}`;
}

export function portablePath(baseDir, targetPath) {
  const relative = path.relative(baseDir, targetPath);
  if (!relative || relative === ".") return ".";
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return path.basename(targetPath);
  }
  return relative.split(path.sep).join("/");
}

export function resolveInside(baseDir, relativePath) {
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(resolvedBase, relativePath);
  if (resolved !== resolvedBase && !resolved.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error(`Path escapes run directory: ${relativePath}`);
  }
  return resolved;
}

export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function bboxPixels(bbox, canvas) {
  return {
    left: bbox[0] * canvas.width,
    top: bbox[1] * canvas.height,
    width: bbox[2] * canvas.width,
    height: bbox[3] * canvas.height,
  };
}

export function normalizedBbox(bbox) {
  return bbox.map((value) => Number(value));
}

export async function listFiles(rootDir) {
  const result = [];
  if (!(await exists(rootDir))) return result;
  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const item = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(item);
      else if (entry.isFile()) result.push(item);
    }
  }
  await visit(rootDir);
  return result;
}

export function jsonOutput(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
