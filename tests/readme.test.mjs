import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./helpers.mjs";

const englishPath = path.join(repoRoot, "README.md");
const chinesePath = path.join(repoRoot, "README_CN.md");
const bannerPath = path.join(repoRoot, "assets/banner.svg");
const workflowPath = path.join(repoRoot, "docs/paper-figure-skill-workflow.svg");

test("English and Chinese READMEs link to each other and document real usage", async () => {
  const [english, chinese] = await Promise.all([
    fs.readFile(englishPath, "utf8"),
    fs.readFile(chinesePath, "utf8"),
  ]);

  assert.match(english, /\[简体中文\]\(README_CN\.md\)/);
  assert.match(chinese, /\[English\]\(README\.md\)/);

  for (const readme of [english, chinese]) {
    assert.match(readme, /docs\/paper-figure-skill-workflow\.svg/);
    assert.match(readme, /codex plugin marketplace add Thanx01\/paper-figure-skill --ref main/);
    assert.match(readme, /\$paper-figure/);
    assert.match(readme, /forge\.mjs init/);
    assert.match(readme, /forge\.mjs next/);
    assert.match(readme, /run-state\.json/);
    assert.match(readme, /paper-figure-skill-delivery\.zip/);
  }
});

test("README workflow graphic is self-contained and scalable", async () => {
  const workflow = await fs.readFile(workflowPath, "utf8");
  assert.match(workflow, /<svg\b[^>]*viewBox="0 0 1800 960"/);
  assert.match(workflow, /Paper Figure Skill workflow/);
  assert.match(workflow, /CANONICAL MASTER/);
  assert.match(workflow, /TRANSPARENT ASSETS/);
  assert.match(workflow, /EDITABLE REBUILD/);
  assert.match(workflow, /RENDER &amp; VISUAL QA/);
  assert.doesNotMatch(workflow, /(?:href|src)="(?:https?:|file:)/i);
  assert.doesNotMatch(workflow, /<image\b/i);
});

test("README banner constrains long labels to the card safe area", async () => {
  const banner = await fs.readFile(bannerPath, "utf8");
  const card = banner.match(/<g transform="translate\(644 0\)" data-card-width="(\d+)">([\s\S]*?)<\/g>/);
  assert.ok(card, "editable-PPTX card must declare its width");

  const cardWidth = Number(card[1]);
  const fittedTexts = [...card[2].matchAll(/<text data-fit="card" x="(\d+)"[^>]*textLength="(\d+)"/g)];
  assert.equal(fittedTexts.length, 2);

  for (const [, x, textLength] of fittedTexts) {
    assert.ok(Number(x) + Number(textLength) <= cardWidth - 16, "card text must retain a 16px right inset");
  }
});
