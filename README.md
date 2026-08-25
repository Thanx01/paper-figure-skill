<div align="center">

[简体中文](README_CN.md)

<img src="./assets/banner.svg" alt="Paper Figure Loom — from paper or master figure to fine-grained assets, editable PowerPoint, and visual QA" width="100%" />

<br />

### A research figure should be editable—not a screenshot wearing a `.pptx` extension.

**Paper Figure Loom** turns a paper or master image into fine-grained transparent assets, native PowerPoint objects, and a visually verified one-slide figure—in one resumable Codex task.

<br />

`paper / prompt → canonical master` &nbsp;·&nbsp; `master → separate assets` &nbsp;·&nbsp; `assets → editable PPTX` &nbsp;·&nbsp; `render → compare → repair`

<br />

<a href="https://github.com/Thanx01/paper-figure-loom/actions/workflows/ci.yml"><img src="https://github.com/Thanx01/paper-figure-loom/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
<img src="https://img.shields.io/badge/tests-21%20passing-brightgreen" alt="21 passing tests" />
<img src="https://img.shields.io/badge/output-PPTX%20%C2%B7%20SVG%20%C2%B7%20PNG-7C3AED" alt="PPTX SVG PNG output" />
<img src="https://img.shields.io/badge/license-MIT-yellow" alt="MIT License" />

</div>

---

**[10-Second Pitch](#10-second-pitch) · [Demo](#demo) · [Two Modes](#two-modes) · [Quick Start](#quick-start) · [Deliverables](#deliverables) · [Quality Gates](#quality-gates)**

---

## 10-Second Pitch

Give the Skill a **paper** or a **master figure**. It handles the production loop:

- **Only a paper?** It locks the required wording, modules, and connections, generates three complete candidates, rejects incomplete ones, and selects one canonical master.
- **Already have a figure?** It preserves that figure's composition, palette, scale, and layer relationships.
- **Need real editability?** Text, panels, and connectors stay native; every separable icon, UI element, illustration, and decoration becomes an individual transparent asset.
- **Need confidence before delivery?** It renders the result and checks side-by-side, overlay, difference, bounding boxes, and an asset contact sheet before packaging.
- **Interrupted midway?** Atomic run state resumes from the next unfinished action without discarding accepted work.

No repeated “continue generating.” No manual download relay. No full-slide image hidden inside PowerPoint.

---

## Demo

![Paper Figure Loom workflow: canonical master, fine-grained transparent assets, editable recomposition, visual QA, and delivery](docs/paper-figure-loom-workflow.svg)

| Stage | What the Skill does | Gate |
|---|---|---|
| **1. Master** | Accepts one complete master or creates three candidates from source semantics | every required module and connection is present |
| **2. Inventory** | Runs a semantic pass and a residual-detail pass | no unexplained visual element remains |
| **3. Assets** | Regenerates each distinct complex element with full-master and local-crop grounding | visible foreground, meaningful transparency, no merged neighbors |
| **4. Recompose** | Restores normalized position, size, z-order, palette, text, and connectors | editable native objects; no stretched or missing asset |
| **5. Verify** | Renders comparisons and spends a bounded repair budget only on failed regions | pass the declared QA thresholds or return a blocker |

---

## Why this is different

| Common shortcut | Paper Figure Loom |
|---|---|
| Put the source image on a slide | Rebuilds the scene from native objects and transparent assets |
| Crop icons with their background attached | Regenerates one grounded foreground object per asset job |
| Merge nearby details to save calls | Preserves fine-grained inventory and placement instances |
| Trust a visually plausible `.pptx` | Inspects both rendered pixels and PowerPoint structure |
| Start over after interruption | Saves stage state and accepted artifacts atomically |
| Claim success after a best-effort render | Returns a blocker report when the gates are not met |

---

## Two Modes

### Rebuild an existing master

Attach the original figure and send:

```text
Use $rebuild-paper-figures on the attached framework figure.

Inventory every separable UI element, icon, illustration, and decoration. Regenerate each distinct
visual as a transparent asset, then rebuild a one-slide editable PowerPoint at the master's original
proportions, positions, layers, connectors, and colors. Keep text, panels, and connectors native.
Run visual comparison and local repair, then return the final deliverables.
```

`rebuild` is the release-focused and most mature route.

### Start from a paper

Attach the paper and optional style references, then send:

```text
Use $rebuild-paper-figures to create a single-page method figure from the attached paper.

Lock the exact wording, modules, and connections first. Generate three complete master candidates
and select one that contains every required part. Regenerate every separable visual as its own
transparent asset, recompose an editable PowerPoint, and complete visual QA and local repair.
```

`author` uses the same inventory, asset, recomposition, and QA pipeline after master selection.

### Resume an interrupted run

```text
Use $rebuild-paper-figures to continue /absolute/path/to/run-directory.
Read run-state.json, preserve completed stages and accepted assets, and continue from the next action.
```

---

## Quick Start

Add this repository as a personal Codex plugin marketplace:

```bash
codex plugin marketplace add Thanx01/paper-figure-loom --ref main
```

Restart Codex Desktop, open **Plugins**, choose the **personal** marketplace, and install **Paper Figure Loom**.

For local development:

```bash
git clone https://github.com/Thanx01/paper-figure-loom.git
codex plugin marketplace add /absolute/path/to/paper-figure-loom
```

The release uses Codex Desktop's built-in image generation. It does not need `OPENAI_API_KEY` and does not automate the ChatGPT website.

---

## Deliverables

| Output | Purpose |
|---|---|
| `framework.pptx` | editable source of truth |
| `framework.svg` / `framework.png` | complete figure exports |
| `assets/png/` | transparent fine-grained raster assets |
| `assets/svg/` | one SVG per asset; hybrid SVGs disclose embedded raster data |
| `assets-manifest.json` | provenance, strategy, reuse, alpha checks, and editability |
| `qa/` / `qa-report.json` | side-by-side, overlay, diff, bounding boxes, and contact sheet |
| `paper-figure-loom-delivery.zip` | complete portable delivery |

---

## Quality Gates

“1:1” means the declared structure, exact text, canvas ratio, positions, sizes, layers, colors, and native geometry stay within tolerance. It also means **no missing icon, stretched asset, or full-slide screenshot disguised as editability**.

Regenerated artwork is evaluated for role, silhouette, proportions, palette, and visual weight—not pixel identity. If the run exhausts its bounded repair budget, it returns a resumable blocker package instead of a false pass.

---

## Current Boundaries

- One single-page figure and one PowerPoint slide per run.
- PowerPoint is the editable source of truth; VSDX is not produced.
- The default budget covers 32 distinct complex assets with two attempts each.
- Live image generation runs in Codex Desktop; CI uses static, unit, and recorded-replay tests.
- `rebuild` is release-focused; paper parsing and master selection in `author` will continue to be hardened.

<details>
<summary><strong>Contributor commands and architecture</strong></summary>

The Skill lives at `plugins/paper-figure-loom/skills/rebuild-paper-figures`; public contracts live in [`contracts/`](contracts/).

Codex normally drives the single `forge.mjs` entry point. Diagnostic commands are `init`, `next`, `record`, `validate`, `build`, `qa`, and `package`. Do not edit `run-state.json` manually.

```bash
<bundled-node> plugins/paper-figure-loom/skills/rebuild-paper-figures/scripts/forge.mjs init \
  --request /absolute/path/to/request.json \
  --run-dir /absolute/path/to/run

<bundled-node> plugins/paper-figure-loom/skills/rebuild-paper-figures/scripts/forge.mjs next \
  --run-dir /absolute/path/to/run
```

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run validate
```

Public tests use original synthetic masters and recorded assets without live generation. Release checks also run the official Skill and Plugin validators and build a real PPTX inside Codex Desktop.

</details>

---

## License

MIT. User-provided papers, master figures, style references, and generated artifacts retain their own provenance and rights.
