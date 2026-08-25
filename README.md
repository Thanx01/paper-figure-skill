<div align="center">

[简体中文](README_CN.md)

<img src="./assets/banner.svg" alt="Paper Figure Skill — editable research figures from papers and reference images" width="100%" />

### Build editable research figures from a paper or reference image.

An agent skill for turning research content into a structured one-slide PowerPoint, reusable transparent assets, and visual-verification evidence.

<p>
  <a href="https://github.com/Thanx01/paper-figure-skill/actions/workflows/ci.yml"><img src="https://github.com/Thanx01/paper-figure-skill/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/github/stars/Thanx01/paper-figure-skill?style=flat-square" alt="GitHub stars" />
  <img src="https://img.shields.io/badge/Agent%20Skill-Codex-111827?style=flat-square" alt="Codex Agent Skill" />
  <img src="https://img.shields.io/badge/Output-PPTX%20%C2%B7%20SVG%20%C2%B7%20PNG-6D28D9?style=flat-square" alt="PPTX SVG PNG output" />
  <img src="https://img.shields.io/badge/License-MIT-0F766E?style=flat-square" alt="MIT License" />
</p>

**[Overview](#overview) · [Workflow](#workflow) · [Install](#install) · [Usage](#usage) · [Outputs](#outputs) · [Development](#development)**

</div>

## Overview

**Paper Figure Skill** runs a complete figure-production workflow inside Codex:

1. establish a complete master figure from a paper or supplied reference image;
2. inventory each separable UI element, icon, illustration, and decoration;
3. regenerate distinct visual elements as transparent assets;
4. rebuild the composition with editable PowerPoint text, shapes, and connectors;
5. render, compare, refine, and package the result.

| Input | Result |
|---|---|
| Paper, method description, and optional style references | complete method figure + editable PowerPoint |
| Existing framework or architecture figure | structure-preserving editable reconstruction |
| Interrupted run directory | resumed workflow with accepted stages and assets preserved |

## Workflow

![Paper Figure Skill workflow: master figure, transparent assets, editable PowerPoint, visual verification, and delivery](docs/paper-figure-skill-workflow.svg)

| Stage | Operation | Artifact |
|---|---|---|
| **Master** | accept one reference figure or generate and select a complete candidate | `canonical-master.png` |
| **Inventory** | map native objects and fine-grained visual assets | `scene-graph.json`, `assets-manifest.json` |
| **Assets** | regenerate each distinct visual with full-image and local-crop grounding | `assets/png/`, `assets/svg/` |
| **Compose** | place native objects and transparent assets at normalized coordinates | `framework.pptx` |
| **Verify** | compare renders, inspect structure, and refine selected regions | `qa/`, `qa-report.json` |

Native text, panels, and connectors remain editable. Complex visuals are placed as aspect-ratio-locked transparent assets. Repeated instances reuse the same verified asset while retaining separate positions in the scene graph.

## Install

Add the repository as a personal Codex plugin marketplace:

```bash
codex plugin marketplace add Thanx01/paper-figure-skill --ref main
```

Restart Codex Desktop, open **Plugins**, select the **personal** marketplace, and install **Paper Figure Skill**.

For local development:

```bash
git clone https://github.com/Thanx01/paper-figure-skill.git
codex plugin marketplace add /absolute/path/to/paper-figure-skill
```

## Usage

### Rebuild a reference figure

Attach the figure and send:

```text
Use $paper-figure on the attached research figure.

Identify every separable UI element, icon, illustration, and decoration. Regenerate each distinct
visual as a transparent asset, then rebuild a one-slide editable PowerPoint at the reference image's
original proportions, positions, layers, connectors, and colors. Keep text, panels, and connectors
native. Complete visual verification and return the packaged deliverables.
```

### Create a figure from a paper

Attach the paper and optional style references, then send:

```text
Use $paper-figure to create a single-page method figure from the attached paper.

Lock the exact wording, modules, and connections. Generate complete master candidates, select a
structurally complete design, create the fine-grained transparent asset library, and compose an
editable PowerPoint. Complete visual verification and return the packaged deliverables.
```

### Resume a run

```text
Use $paper-figure to continue /absolute/path/to/run-directory.
Read run-state.json, retain completed stages and accepted assets, and continue from the next action.
```

## Outputs

| Path | Contents |
|---|---|
| `framework.pptx` | editable PowerPoint source |
| `framework.svg`, `framework.png` | complete figure exports |
| `assets/png/` | transparent fine-grained raster assets |
| `assets/svg/` | native-vector or explicitly hybrid SVG assets |
| `assets-manifest.json` | source, strategy, reuse, transparency, and editability metadata |
| `qa/`, `qa-report.json` | render comparisons, overlays, difference maps, bounds, and asset sheet |
| `paper-figure-skill-delivery.zip` | portable delivery package |

## Verification

The workflow checks:

- exact text and required graph coverage;
- complete mapping from scene instances to reusable assets;
- transparent foreground content for regenerated visuals;
- native PowerPoint text, panels, and connectors;
- canvas ratio, geometry, aspect ratio, layer order, and color;
- rendered similarity through side-by-side, overlay, and difference views.

## Development

<details>
<summary><strong>Repository layout and deterministic checks</strong></summary>

The skill is located at `plugins/paper-figure-skill/skills/paper-figure`. Public JSON contracts are stored in [`contracts/`](contracts/).

Codex drives the `forge.mjs` state-machine entry point:

```bash
<bundled-node> plugins/paper-figure-skill/skills/paper-figure/scripts/forge.mjs init \
  --request /absolute/path/to/request.json \
  --run-dir /absolute/path/to/run

<bundled-node> plugins/paper-figure-skill/skills/paper-figure/scripts/forge.mjs next \
  --run-dir /absolute/path/to/run
```

Run the deterministic suite with:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run validate
```

</details>

## License

[MIT](LICENSE)
