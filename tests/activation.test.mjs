import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { repoRoot, json } from "./helpers.mjs";

test("skill metadata covers the published activation corpus", async () => {
  const skill = await fs.readFile(path.join(repoRoot, "plugins/paper-figure-skill/skills/paper-figure/SKILL.md"), "utf8");
  const cases = await json(path.join(repoRoot, "tests/fixtures/activation-cases.json"));
  for (const phrase of ["academic figure", "PowerPoint", "SVG/PNG", "paper-to-figure", "interruption"] ) {
    assert.match(skill, new RegExp(phrase, "i"));
  }
  assert.equal(cases.filter((item) => item.should_activate).length, 4);
  assert.equal(cases.filter((item) => !item.should_activate).length, 1);
});
