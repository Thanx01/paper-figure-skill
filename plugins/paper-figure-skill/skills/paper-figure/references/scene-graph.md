# Scene graph contract

Use normalized coordinates so one graph can drive SVG and PPTX. The canvas stores integer pixel dimensions; every non-connector element stores `bbox: [x, y, width, height]` in the range `0..1`.

## Design spec

```json
{
  "schema_version": "1.0",
  "canvas": { "width": 1920, "height": 1080 },
  "required_modules": [
    { "id": "module-input", "title": "Input state" }
  ],
  "required_connections": [
    { "id": "flow-input-ranker", "from": "module-input", "to": "module-ranker" }
  ],
  "verbatim_text": {
    "title-input": "Input state"
  },
  "expected_geometry": {
    "module-input": [0.04, 0.12, 0.22, 0.72],
    "title-input": [0.06, 0.15, 0.18, 0.08]
  },
  "style_constraints": {},
  "invariants": {
    "preserve_aspect_ratio": true,
    "native_text": true,
    "no_stretched_assets": true
  }
}
```

Required module and connection ids should match scene element ids. When that is impossible, provide `scene_element_id` explicitly.
Populate `expected_geometry` for every non-connector element whose position can be established from the canonical master. QA compares these independent design measurements with the final scene graph using the configured center, size, and aspect-ratio gates.

## Scene graph

```json
{
  "schema_version": "1.0",
  "canvas": { "width": 1920, "height": 1080 },
  "background": "#FFFFFF",
  "elements": [
    {
      "id": "module-input",
      "type": "shape",
      "geometry": "roundRect",
      "bbox": [0.04, 0.12, 0.22, 0.72],
      "z_index": 10,
      "qa_role": "module",
      "strategy": "native-shape",
      "style": { "fill": "#F8FAFC", "stroke": "#64748B", "stroke_width": 2, "radius": 18 }
    },
    {
      "id": "title-input",
      "type": "text",
      "bbox": [0.06, 0.15, 0.18, 0.08],
      "z_index": 20,
      "parent": "module-input",
      "strategy": "native-text",
      "text": "Input state",
      "style": { "font_family": "Arial", "font_size": 30, "font_weight": "700", "fill": "#0F172A" }
    },
    {
      "id": "flow-input-ranker",
      "type": "connector",
      "from": "module-input",
      "to": "module-ranker",
      "from_side": "right",
      "to_side": "left",
      "kind": "elbow",
      "z_index": 5,
      "style": { "stroke": "#475569", "stroke_width": 3, "arrow_end": true }
    }
  ]
}
```

Supported visual element types are `shape`, `text`, `connector`, `image`, and `group`. Supported shape geometries are `rect`, `roundRect`, `ellipse`, `diamond`, and `rightArrow`.

Use `allow_overlap: true` only for intentional overlap. Mark top-level modules with `qa_role: module`. Every image element must reference an `asset_id`; do not use filesystem paths in the scene graph.

Create one image element for each visible instance of a fine-grained UI, icon, illustration, badge, or decoration. If an identical icon appears three times, create three image elements with separate bboxes and the same `asset_id`. The matching manifest job must list all three element ids. This preserves every position while avoiding duplicate generation.

Record the canonical master's actual z-order. The PPTX builder creates connectors behind nodes and creates every other object in ascending `z_index`; do not rely on type-based ordering.
