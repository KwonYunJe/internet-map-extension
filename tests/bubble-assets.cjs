// Run with the bundled runtime NODE_PATH. Verifies real alpha, not painted black.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
for (let variant = 1; variant <= 5; variant++) {
  const name = `soap-bubble-0${variant}.png`;
  const png = PNG.sync.read(fs.readFileSync(path.join(__dirname, '../visualization/assets', name)));
  assert(png.width >= 512 && png.height >= 512, `${name}: minimum dimensions`);
  let centralAlpha = 0, centralPixels = 0, transparent = 0, partial = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const a = png.data[(y * png.width + x) * 4 + 3];
    if (a === 0) transparent++;
    if (a > 0 && a < 255) partial++;
    if (Math.hypot(x / png.width - .5, y / png.height - .5) < .25) {
      centralAlpha += a; centralPixels++;
    }
  }
  const meanCentralAlpha = centralAlpha / centralPixels / 255;
  assert(meanCentralAlpha < .05, `${name}: transparent center (${meanCentralAlpha})`);
  assert(transparent > png.width * png.height * .5, `${name}: true transparent canvas`);
  assert(partial > 100, `${name}: partially transparent membrane`);
  console.log(`${name}: ${png.width}x${png.height}, center alpha ${meanCentralAlpha.toFixed(4)}, transparent ${(transparent / png.width / png.height * 100).toFixed(1)}%`);
}
