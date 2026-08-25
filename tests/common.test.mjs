import assert from "node:assert/strict";
import test from "node:test";
import { bboxPixels } from "../plugins/paper-figure-skill/skills/paper-figure/scripts/lib/common.mjs";

test("normalized coordinates convert deterministically to canvas pixels", () => {
  assert.deepEqual(bboxPixels([0.1, 0.2, 0.25, 0.5], { width: 1920, height: 1080 }), {
    left: 192,
    top: 216,
    width: 480,
    height: 540,
  });
});
