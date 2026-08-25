import assert from "node:assert/strict";
import test from "node:test";
import {
  duplicateAssetGroups,
  normalizeRequest,
  validateAssetManifest,
  validateDesignSpec,
  validateRequest,
  validateSceneGraph,
} from "../plugins/paper-figure-skill/skills/paper-figure/scripts/lib/contracts.mjs";
import { fixturePath, json } from "./helpers.mjs";

test("public fixtures satisfy all semantic contracts", async () => {
  for (const name of ["vector", "hybrid"]) {
    const design = await json(fixturePath(name, "design-spec.json"));
    const scene = await json(fixturePath(name, "scene-graph.json"));
    const assets = await json(fixturePath(name, "assets-manifest.json"));
    assert.equal(validateDesignSpec(design).valid, true);
    assert.equal(validateSceneGraph(scene).valid, true);
    assert.equal(validateAssetManifest(assets, scene).valid, true);
  }
});

test("asset content hashes identify duplicate jobs", () => {
  const manifest = {
    jobs: [
      { id: "a", sha256_png: "same" },
      { id: "b", sha256_png: "same" },
      { id: "c", sha256_png: "different" },
    ],
  };
  assert.deepEqual(duplicateAssetGroups(manifest), [{ sha256: "same", ids: ["a", "b"] }]);
});

test("request defaults encode the bounded generation and repair budgets", async () => {
  const request = await normalizeRequest({ mode: "author", prompt: "A small original diagram" }, "/tmp/request.json");
  assert.deepEqual(request.budgets, {
    master_candidates: 3,
    master_retry_rounds: 1,
    max_complex_assets: 32,
    max_asset_attempts: 2,
    max_repair_rounds: 3,
    stop_after_no_improvement_rounds: 1,
  });
  assert.equal((await validateRequest(request)).valid, true);
});

test("invalid duplicates and dishonest raster SVG declarations are rejected", async () => {
  const scene = await json(fixturePath("vector", "scene-graph.json"));
  const duplicateScene = structuredClone(scene);
  duplicateScene.elements.push(structuredClone(duplicateScene.elements[0]));
  assert.equal(validateSceneGraph(duplicateScene).valid, false);

  const assets = await json(fixturePath("hybrid", "assets-manifest.json"));
  assets.jobs.find((job) => job.id === "grounded-visual-asset").vector_kind = "native-vector";
  const result = validateAssetManifest(assets, await json(fixturePath("hybrid", "scene-graph.json")));
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /embedded-raster/);
});

test("every fine-grained image instance must resolve to a manifest asset", async () => {
  const scene = await json(fixturePath("hybrid", "scene-graph.json"));
  const assets = await json(fixturePath("hybrid", "assets-manifest.json"));
  const missingId = structuredClone(scene);
  delete missingId.elements.find((element) => element.type === "image").asset_id;
  assert.match(validateSceneGraph(missingId).errors.join("\n"), /must reference an asset_id/);

  const uncovered = structuredClone(assets);
  uncovered.jobs.find((job) => job.id === "grounded-visual-asset").source_element_ids = ["encoder-panel"];
  assert.match(validateAssetManifest(uncovered, scene).errors.join("\n"), /must list image instance/);

  const incomplete = structuredClone(assets);
  incomplete.inventory.residual_pass_complete = false;
  assert.match(validateAssetManifest(incomplete, scene).errors.join("\n"), /residual pass is incomplete/);
});
