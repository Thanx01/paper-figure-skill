import assert from "node:assert/strict";
import test from "node:test";
import { safeArchivePath } from "../plugins/paper-figure-skill/skills/paper-figure/scripts/lib/package.mjs";

test("archive path sanitizer accepts portable descendants and rejects traversal", () => {
  assert.equal(safeArchivePath("assets/png/icon.png"), "assets/png/icon.png");
  assert.throws(() => safeArchivePath("../secret.txt"), /Unsafe archive path/);
  assert.throws(() => safeArchivePath("assets/../../secret.txt"), /Unsafe archive path/);
});
