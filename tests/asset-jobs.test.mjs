import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { loadSharp } from "../plugins/paper-figure-skill/skills/paper-figure/scripts/lib/runtime.mjs";
import { loadJszip } from "../plugins/paper-figure-skill/skills/paper-figure/scripts/lib/runtime.mjs";
import { fixturePath, json, prepareRecordedRun, runForge } from "./helpers.mjs";

test("asset manifest recording creates grounded reference crops and chroma-key recording creates alpha", async () => {
  const { runDir, root } = await prepareRecordedRun("hybrid", { resolveAssets: false });
  const manifest = await json(path.join(runDir, "assets-manifest.json"));
  const job = manifest.jobs.find((item) => item.id === "grounded-visual-asset");
  assert.equal(job.reference_crop, "tmp/references/grounded-visual-asset.png");
  await fs.access(path.join(runDir, job.reference_crop));

  const sharp = await loadSharp();
  const keyed = path.join(root, "keyed.png");
  const keyedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#00FF00"/><rect x="10" y="10" width="20" height="20" fill="#FF0000"/></svg>`;
  await sharp(Buffer.from(keyedSvg)).png().toFile(keyed);
  await runForge(["record", "--run-dir", runDir, "--asset-id", job.id, "--artifact", keyed, "--key-color", "#00FF00", "--key-tolerance", "0"]);
  const { data, info } = await sharp(path.join(runDir, "assets/png/grounded-visual-asset.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  assert.equal(data[3], 0);
  assert.equal(data[((20 * 40 + 20) * 4) + 3], 255);
});

test("failed grounded generations persist reasons and stop at the attempt budget", async () => {
  const { runDir, root } = await prepareRecordedRun("hybrid", { resolveAssets: false });
  const sharp = await loadSharp();
  const manifestPath = path.join(root, "regenerate-assets.json");
  const manifest = await json(fixturePath("hybrid", "assets-manifest.json"));
  const job = manifest.jobs.find((item) => item.id === "grounded-visual-asset");
  job.strategy = "regenerate-grounded";
  job.source = { kind: "imagegen", reference: "canonical-master.png" };
  job.prompt = "An original two-token visual on a flat #00FF00 background";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await runForge(["record", "--run-dir", runDir, "--stage", "assets", "--artifact", manifestPath]);
  let action = await runForge(["next", "--run-dir", runDir]);
  assert.equal(action.action, "imagegen.generate_asset");
  assert.equal(action.attempt, 1);
  await runForge(["record", "--run-dir", runDir, "--asset-id", job.id, "--failed", "--reason", "subject was clipped"]);
  action = await runForge(["next", "--run-dir", runDir]);
  assert.equal(action.attempt, 2);
  const failure = await runForge(["record", "--run-dir", runDir, "--asset-id", job.id, "--failed", "--reason", "wrong silhouette"]);
  assert.equal(failure.exhausted, true);
  action = await runForge(["next", "--run-dir", runDir]);
  assert.equal(action.action, "script.package_blocker");
  const persisted = await json(path.join(runDir, "assets-manifest.json"));
  assert.deepEqual(persisted.jobs.find((item) => item.id === job.id).failures.map((item) => item.reason), ["subject was clipped", "wrong silhouette"]);
  const packaged = await runForge(["package", "--run-dir", runDir]);
  const JSZip = await loadJszip();
  const archive = await JSZip.loadAsync(await fs.readFile(packaged.output));
  assert.ok(archive.file("blocker-report.json"));
  assert.equal((await runForge(["next", "--run-dir", runDir])).action, "deliver_blocker");
  const recovery = path.join(root, "recovery.png");
  await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="9" fill="#F97316"/></svg>'), left: 10, top: 10 }])
    .png()
    .toFile(recovery);
  await runForge(["record", "--run-dir", runDir, "--asset-id", job.id, "--artifact", recovery]);
  assert.equal((await runForge(["next", "--run-dir", runDir])).action, "script.build");
});

test("grounded assets without transparent background are rejected", async () => {
  const { runDir, root } = await prepareRecordedRun("hybrid", { resolveAssets: false });
  const sharp = await loadSharp();
  const opaque = path.join(root, "opaque.png");
  await sharp({ create: { width: 48, height: 48, channels: 3, background: "#F97316" } }).png().toFile(opaque);
  await assert.rejects(
    runForge(["record", "--run-dir", runDir, "--asset-id", "grounded-visual-asset", "--artifact", opaque]),
    /no meaningful transparent background/,
  );
  await assert.rejects(
    runForge(["record", "--run-dir", runDir, "--asset-id", "grounded-visual-asset", "--from-master"]),
    /allowed only for explicitly approved direct-extract jobs/,
  );
  const manifest = await json(path.join(runDir, "assets-manifest.json"));
  assert.equal(manifest.jobs.find((item) => item.id === "grounded-visual-asset").status, "pending");
});
