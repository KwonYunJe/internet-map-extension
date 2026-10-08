# Soap membrane assets

Generated with the built-in image-generation tool, 2026-10-08. Final PNGs keep genuine RGBA transparency; original user textures remain unchanged.

## Shared prompt
One centered nearly circular transparent soap bubble frame on a genuinely transparent square canvas, 512px or larger. Extremely thin silver-white membrane, tiny upper-left reflection and faint lower-right crescent. Almost neutral color with minimal pale blue/lavender hints. Entire center and surroundings alpha-transparent. Airy premium miniature material. No text, terrain, background, donut/tube shape, broad opaque white fill, heavy bloom or dark painted backdrop.

## Variants
1. Almost perfect circle, small upper-left reflection.
2. Upper-left contour protrusion around 2%.
3. Lower contour extends around 3%.
4. Subtle horizontal asymmetry around 2%.
5. Especially thin softened edge.

## Refinement
Initial generated rims were too thick. Edit each target to remove the broad donut band completely, retain a hairline rim around 1% of diameter maximum, and use variant 1's refined thin membrane as style reference. Keep genuine alpha and fully transparent center.

## Verification
`tests/bubble-assets.cjs` checks minimum size, more than 50% completely transparent pixels, near-zero mean central alpha and partially transparent membrane pixels. Shape variation is visually reviewed, not claimed to be exact measured physics.
