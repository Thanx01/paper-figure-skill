# QA and repair policy

Treat QA as a release gate, not an advisory score.

## Structural gates

- Required modules, required connectors, and verbatim text: 100% present.
- Every asset job: completed with both PNG and SVG outputs.
- Every image instance resolves to one manifest job, and every instance appears in that job's `source_element_ids`.
- Both inventory passes are complete and `unexplained_visuals` is empty.
- Every completed regenerated asset has meaningful transparent background pixels and meaningful visible foreground pixels.
- Out-of-bounds elements, unapproved top-level module overlap, duplicate ids, missing references, and unsafe SVG links: zero.
- PPTX: native text runs and shape objects must exist when the design requires them.
- Any near-full-slide picture is an automatic failure, even when other native objects are also present.

Coordinates drive SVG and PPTX directly. The programmed center, size, and aspect errors are therefore zero; rendered evidence is assessed separately.

## Visual gates

Mask native text regions before pixel comparison because font rasterizers differ. Use the request thresholds, whose defaults are:

- Global non-text difference ratio: at most `0.08`.
- `direct-extract` region: at most `0.03`.
- Native rebuilt asset region: at most `0.08`.
- `regenerate-grounded` region: at most `0.15`.

Always generate full-resolution `side-by-side.png`, `overlay.png`, `diff.png`, `bboxes.png`, and `assets-contact-sheet.png`. Inspect the final PPTX render rather than only the composite SVG render when a PPTX render is available.

## Repair

Repair only failing elements:

- Position or size failure: adjust that element bbox.
- Text failure: correct the native text or text box.
- Color or border failure: correct the native style.
- Complex asset failure: regenerate only that asset.
- Connector failure: correct endpoints, routing, or z-order.

Allow at most three QA rounds by default. Stop after one round without measurable improvement. Package a blocker report with partial artifacts instead of lowering thresholds or flattening the slide.
