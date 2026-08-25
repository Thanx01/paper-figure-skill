import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./helpers.mjs";

const required = [
  ".agents/plugins/marketplace.json",
  "plugins/paper-figure-skill/.codex-plugin/plugin.json",
  "plugins/paper-figure-skill/skills/paper-figure/SKILL.md",
  "plugins/paper-figure-skill/skills/paper-figure/agents/openai.yaml",
  "plugins/paper-figure-skill/skills/paper-figure/scripts/forge.mjs",
  "contracts/request.schema.json",
  "contracts/design-spec.schema.json",
  "contracts/scene-graph.schema.json",
  "contracts/assets-manifest.schema.json",
  "contracts/master-candidates.schema.json",
  "README.md",
  "README_CN.md",
  "LICENSE",
];

for (const relative of required) {
  await fs.access(path.join(repoRoot, relative));
}

for (const relative of [
  ".agents/plugins/marketplace.json",
  "plugins/paper-figure-skill/.codex-plugin/plugin.json",
  "contracts/request.schema.json",
  "contracts/design-spec.schema.json",
  "contracts/scene-graph.schema.json",
  "contracts/assets-manifest.schema.json",
  "contracts/master-candidates.schema.json",
]) {
  JSON.parse(await fs.readFile(path.join(repoRoot, relative), "utf8"));
}

const plugin = JSON.parse(await fs.readFile(path.join(repoRoot, "plugins/paper-figure-skill/.codex-plugin/plugin.json"), "utf8"));
assert.equal(plugin.name, "paper-figure-skill");
assert.equal(plugin.skills, "./skills/");
assert.equal(plugin.interface.displayName, "Paper Figure Skill");
assert.equal(plugin.repository, "https://github.com/Thanx01/paper-figure-skill");

const skillContents = await fs.readFile(path.join(repoRoot, "plugins/paper-figure-skill/skills/paper-figure/SKILL.md"), "utf8");
assert.match(skillContents, /^---\nname: paper-figure\n/);
const skillUi = await fs.readFile(path.join(repoRoot, "plugins/paper-figure-skill/skills/paper-figure/agents/openai.yaml"), "utf8");
assert.match(skillUi, /\$paper-figure/);
await assert.rejects(fs.access(path.join(repoRoot, "plugins/paper-figure-skill/skills/build-paper-framework-diagrams")));
await assert.rejects(fs.access(path.join(repoRoot, "plugins/paper-figure-skill/skills/forge-paper-figures")));

const marketplace = JSON.parse(await fs.readFile(path.join(repoRoot, ".agents/plugins/marketplace.json"), "utf8"));
assert.equal(marketplace.plugins[0].name, "paper-figure-skill");
assert.equal(marketplace.plugins[0].source.path, "./plugins/paper-figure-skill");
await assert.rejects(fs.access(path.join(repoRoot, "plugins/paper-diagram-forge")));

const sourceFiles = [];
async function visit(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "runs", "tests/private-fixtures"].includes(entry.name)) continue;
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(item);
    else if (entry.isFile()) sourceFiles.push(item);
  }
}
await visit(repoRoot);
for (const file of sourceFiles.filter((item) => item.endsWith(".mjs") && path.basename(item) !== "validate-repo.mjs")) {
  const contents = await fs.readFile(file, "utf8");
  assert.doesNotMatch(contents, /OPENAI_API_KEY/, `${file} must not require an API key`);
  assert.doesNotMatch(contents, /python-pptx/i, `${file} must not use python-pptx`);
}

process.stdout.write(`repository validation passed (${sourceFiles.length} files checked)\n`);
