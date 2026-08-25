# Honest hybrid SVG policy

Every reusable asset has a PNG and an SVG, but the SVG file extension does not imply full vectorization.

## Native vector

Use `vector_kind: native-vector` when the SVG contains editable primitives such as `<path>`, `<rect>`, `<ellipse>`, `<polygon>`, and `<text>`. It must not contain `<image>`.

Use it for simple UI, panels, arrows, cards, geometric diagrams, badges, and icons that retain their appearance as vectors.

## Embedded raster

Use `vector_kind: embedded-raster` when the SVG embeds an alpha PNG through a data URI. This preserves visual fidelity and portability but does not make the illustration path-editable.

Use it for people, mascots, card artwork, shadows, gradients, textures, and complex decorations. Preserve the original aspect ratio with `preserveAspectRatio="xMidYMid meet"`.

## Safety and portability

- Give every SVG an explicit width, height, and `viewBox`.
- Embed raster bytes; do not reference absolute paths, `file:` URLs, network URLs, or run-directory files.
- Keep asset ids stable and include strategy metadata.
- Never stretch an asset into a box with different proportions.
- Use transparent PNG in PPTX for complex assets; keep the SVG as a separate delivery artifact.
