# Fine-grained asset policy

Treat the canonical master as an exhaustive visual inventory, not merely a style reference. Create one scene image element for every visually separable UI, icon, illustration, badge, ornament, or image-like object. Create one generation job per distinct object design. If the same object appears several times, keep every scene instance and list every instance id in the shared job's `source_element_ids`.

Do not split text into glyphs or connectors into line fragments. Keep ordinary text, plain panels, primitive arrows, and simple geometry native. Do not group nearby image-like objects simply because they sit inside the same module or because the generation budget is inconvenient.

## Complete two discovery passes

1. Semantic pass: inventory every module, text item, connector, obvious UI component, icon, and complex visual.
2. Residual pass: inspect the remaining pixels. Add missed small icons, badges, decoration, shadows that belong to an object, and partially occluded visuals.

Record completion in the manifest:

```json
{
  "inventory": {
    "granularity": "fine-grained",
    "semantic_pass_complete": true,
    "residual_pass_complete": true,
    "unexplained_visuals": []
  }
}
```

Do not complete the assets stage while `unexplained_visuals` is non-empty.

## Choose a reconstruction strategy

- `native-text`: exact user- or paper-controlled text, rendered as native PPTX text and SVG `<text>`.
- `native-shape`: panels, primitive arrows, separators, badges, charts, and simple icons that can be faithfully rebuilt from geometry.
- `regenerate-grounded`: the default for every image-like UI/icon/illustration. Generate only the target object using the full master and target crop as references. Require a transparent final background.
- `direct-extract`: an exception used only after the user explicitly asks to keep a source crop instead of regeneration. Persist `source.approved_by_user: true`.

One `regenerate-grounded` job equals one distinct visual object and one image-generation call per attempt. The prompt must demand only the marked object; matching silhouette, proportions, internal layout, palette, and visual weight; a flat key-color background; and no surrounding panel, label, or extra object.

## Manifest example

```json
{
  "schema_version": "1.0",
  "inventory": {
    "granularity": "fine-grained",
    "semantic_pass_complete": true,
    "residual_pass_complete": true,
    "unexplained_visuals": []
  },
  "jobs": [
    {
      "id": "asset-mascot",
      "asset_role": "illustration",
      "source_element_ids": ["mascot-left", "mascot-right"],
      "strategy": "regenerate-grounded",
      "vector_kind": "embedded-raster",
      "background_requirement": "transparent",
      "bbox": [0.04, 0.72, 0.12, 0.2],
      "status": "pending",
      "prompt": "Regenerate only the mascot in the marked crop. Preserve its silhouette, proportions, colors, and internal details. Use a perfectly flat #00FF00 background. Add no panel, words, or extra object.",
      "reference_crop": "tmp/references/asset-mascot.png",
      "source": { "kind": "imagegen", "reference": "canonical-master.png" },
      "editable_level": "position-and-scale"
    }
  ]
}
```

Use `asset_role` values `icon`, `ui-component`, `illustration`, `decoration`, or `native-component`. Use `native-vector` only for native strategies and `embedded-raster` for generated or explicitly extracted bitmap assets.

After recording a regenerated asset, require meaningful transparent pixels and meaningful visible pixels. Persist its dimensions, alpha fractions, output paths, attempt count, prompt, source, and SHA-256.

Enforce `max_complex_assets`. If the fine-grained inventory exceeds it, increase the user-approved budget or return a blocker. Combine objects only when visually inseparable; never omit them silently.
