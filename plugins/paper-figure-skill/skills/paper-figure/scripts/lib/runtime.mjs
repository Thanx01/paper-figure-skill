import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { exists } from "./common.mjs";

function moduleRoots() {
  const roots = [];
  for (const value of [
    process.env.PAPER_FIGURE_SKILL_NODE_MODULES,
    process.env.PAPER_DIAGRAM_FORGE_NODE_MODULES,
    ...(process.env.NODE_PATH ?? "").split(path.delimiter),
    path.join(process.cwd(), "node_modules"),
  ]) {
    if (value && !roots.includes(value)) roots.push(value);
  }
  return roots;
}

export async function loadPackage(packageName) {
  const failures = [];
  try {
    return await import(packageName);
  } catch (error) {
    failures.push(error.message);
  }

  for (const root of moduleRoots()) {
    if (!(await exists(root))) continue;
    try {
      const resolver = createRequire(path.join(root, "paper-figure-skill-resolver.cjs"));
      const resolved = resolver.resolve(packageName);
      return await import(pathToFileURL(resolved).href);
    } catch (error) {
      failures.push(`${root}: ${error.message}`);
    }
  }

  throw new Error(
    `Unable to load ${packageName}. In Codex Desktop, call load_workspace_dependencies and set PAPER_FIGURE_SKILL_NODE_MODULES to its Node.js packages path. ${failures.join(" | ")}`,
  );
}

export async function loadSharp() {
  const module = await loadPackage("sharp");
  return module.default ?? module;
}

export async function loadPixelmatch() {
  const module = await loadPackage("pixelmatch");
  return module.default ?? module;
}

export async function loadJszip() {
  const module = await loadPackage("jszip");
  return module.default ?? module;
}

export async function loadArtifactTool() {
  const module = await loadPackage("@oai/artifact-tool");
  const candidate = module.default && module.default.Presentation ? module.default : module;
  if (!candidate.Presentation || !candidate.PresentationFile) {
    throw new Error("@oai/artifact-tool loaded but Presentation exports were not found.");
  }
  return candidate;
}

export async function dependencyReport() {
  const report = {};
  for (const dependency of ["sharp", "pixelmatch", "jszip", "@oai/artifact-tool"]) {
    try {
      const module = await loadPackage(dependency);
      let version = null;
      for (const root of moduleRoots()) {
        const versionPath = path.join(root, dependency, "package.json");
        if (await exists(versionPath)) {
          version = JSON.parse(await fs.readFile(versionPath, "utf8")).version;
          break;
        }
      }
      report[dependency] = { available: Boolean(module), version };
    } catch (error) {
      report[dependency] = { available: false, error: error.message };
    }
  }
  return report;
}
