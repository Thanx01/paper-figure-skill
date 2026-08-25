---
name: paper-figure
description: Rebuild an academic figure or framework diagram as an editable single-slide PowerPoint by first creating or accepting a complete master image, then exhaustively regenerating every distinct UI, icon, illustration, and decoration as a separate transparent asset, and finally recomposing those assets to match the master. Use for paper method figures, model architecture diagrams, faithful PowerPoint reconstruction, fine-grained UI or icon cutouts, SVG/PNG asset delivery, paper-to-figure workflows, and interruption recovery.
---

# Paper Figure

Run the complete master-to-assets-to-PowerPoint workflow without requesting intermediate approval. Stop only when an input is unreadable, a required built-in capability is unavailable, or a declared gate cannot pass. Do not switch to web-chat automation or an API-key-backed image workflow.

## Follow the three phases exactly

1. Establish one canonical master figure.
   - In `rebuild` mode, use the supplied figure unchanged as `canonical-master.png` and preserve its aspect ratio.
   - In `author` mode, derive exact content from the paper, prompt, and style references. Invoke `$imagegen` for three complete figure candidates, reject any candidate missing a required module or connection, allow one targeted retry round, and select one canonical master.
   - Treat explicit user wording and paper semantics as authoritative. Use master-image text only for placement and style.
2. Build a fine-grained transparent asset library from that master.
   - Inspect the master twice: first for semantic structure, then for unexplained visual residuals.
   - Create a separate image element for every visually separable UI component, icon, illustration, badge, decoration, or other image-like object that could be cut out.
   - Create separate scene instances for repeated objects. Let truly identical instances share one asset job; do not omit any instance.
   - Invoke `$imagegen` once per distinct image asset, using the full master and local crop as references. Regenerate only that object on a flat chroma-key background, remove the background, and verify real transparency.
   - Do not combine nearby objects merely to reduce the job count. Combine only parts that form one visually inseparable object.
   - Keep ordinary text, plain panels, primitive shapes, and connectors native; they are not bitmap cutouts.
   - Use `direct-extract` only when the user explicitly requests extraction instead of regeneration, and persist `source.approved_by_user: true`. Default to `regenerate-grounded`.
3. Recompose the master from native objects plus the fine-grained asset library.
   - Place every object from normalized master coordinates. Preserve canvas ratio, object bounding boxes, asset aspect ratios, relative positions, palette, z-order, and connector relationships.
   - Keep text, panels, and connectors as native PowerPoint objects. Place complex assets as transparent PNGs with locked aspect ratio.
   - Never use the complete master image as a slide background or full-slide overlay.
   - Render the rebuilt slide, compare it with the canonical master, repair only failing elements, and package only after every gate passes.

## Initialize the run

1. Call `load_workspace_dependencies`. Use its bundled Node executable and Node package path.
2. Set `PAPER_FIGURE_SKILL_NODE_MODULES` to that package path.
3. Initialize an artifact-tool workspace with the presentation skill helper `container_tools/setup_artifact_tool_workspace.mjs --workspace <run-parent>`.
4. Create `request.json` with absolute paths, a dedicated run directory, and optional `output_dir`.
5. Run:

```bash
<bundled-node> <skill-dir>/scripts/forge.mjs init \
  --request <request.json> \
  --run-dir <run-dir>
```

Reuse the same directory with `--resume` after an interruption. Never replace completed work or edit `run-state.json` manually.

Read `references/scene-graph.md` before writing `design-spec.json` or `scene-graph.json`. Read `references/asset-policy.md` before writing `assets-manifest.json`.

## Drive the state machine

Run `forge.mjs next --run-dir <run-dir>` and execute exactly the returned action until it returns `deliver` or a blocker-package action.

- `agent.write_design_spec`: lock exact text, required modules, and required connections.
- `imagegen.generate_master_candidates`: create and score complete masters; save prompts, scores, rejections, and the selected id in `master-candidates.json`.
- `agent.write_scene_graph`: record every native object and every fine-grained image instance with normalized coordinates, z-order, hierarchy, and strategy.
- `agent.write_asset_manifest`: finish both inventory passes, leave `unexplained_visuals` empty, cover every image instance, and create one regeneration job per distinct visual asset.
- `imagegen.generate_asset`: invoke `$imagegen` once using both returned references. Generate only the target object on a flat key color. Record it with `--key-color <hex>` when needed. The recorder rejects opaque or empty results.
- `script.build`: run the returned command. The builder must use `@oai/artifact-tool`, never `python-pptx`.
- `script.qa`: inspect the full-resolution render, comparison images, bounding boxes, and asset contact sheet.
- `agent.repair_from_qa`: repair only failed elements, rebuild, and rerun QA within the saved budget.
- `script.package` or `script.package_blocker`: package the successful delivery or the blocker evidence.

Record stage artifacts with:

```bash
<bundled-node> <skill-dir>/scripts/forge.mjs record \
  --run-dir <run-dir> --stage <design|master|scene|assets> --artifact <path>
```

Record a generated asset with `--asset-id <id> --artifact <png> [--key-color <hex>]`. Record a rejected generation with `--asset-id <id> --failed --reason <reason>` so retry history survives interruption.

## Preserve editability and provenance

Read `references/svg-policy.md` before building. Export every reusable asset as PNG and SVG. Mark true path-based assets `native-vector`; mark SVG wrappers containing PNG bytes `embedded-raster`. Never call embedded raster artwork fully vectorized.

Read `references/qa-policy.md` before accepting delivery. Require exact text and graph coverage, complete image-instance coverage, verified transparent regenerated assets, valid SVGs, native PPTX text/panels/connectors, correct geometry and z-order, no full-slide flattening, and configured visual-difference thresholds.

Return only the final PPTX, composite SVG/PNG, asset directories, manifest, QA evidence, provenance, and delivery ZIP. If the run blocks, return the blocker ZIP and failed gates instead of claiming success.
