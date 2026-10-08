const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../visualization/visualization.js'), 'utf8');
let nextFrame;
let updates = [];
const context = vm.createContext({
  animationFrameId: null, hoveredNode: null,
  edgeCanvasLayer: null,
  document: { addEventListener() {} },
  initializeNodeWobble() {}, updateNodeLens() {}, restoreNodeLayerOrder() {},
  cancelAnimationFrame() {}, requestAnimationFrame(fn) { nextFrame = fn; return 1; },
  updateEdgePairPaths(pair) { updates.push(pair); },
  HOVER_DEPTH_EASING: .2, HOVER_Z: 100, CAMERA_DISTANCE: 1000,
  WOBBLE_ENABLED: false, prefersReducedMotion: false,
});
vm.runInContext(source.slice(source.indexOf('function startAnimation('), source.indexOf('function highlightNode(')), context);
const nodes = Array.from({ length: 80 }, (_, i) => ({
  screenX: i * 10, screenY: 100, z: 0, radius: 10,
  baseProjectionScale: 1, depthOpacity: 1, hoverProgress: 0, hovered: false,
}));
const pairs = Array.from({ length: 240 }, (_, i) => ({
  nodeA: nodes[i % 80], nodeB: nodes[(i * 7 + 1) % 80],
}));
context.startAnimation(nodes, pairs, {}, {});
nextFrame(16);
assert.equal(updates.length, 240);
updates = [];
for (let i = 2; i < 120; i++) nextFrame(i * 16);
assert.equal(updates.length, 0, 'Idle graph never recalculates edges');
nodes[0].hovered = true;
nextFrame(2000);
assert.deepEqual(new Set(updates), new Set(pairs.filter(p => p.nodeA === nodes[0] || p.nodeB === nodes[0])));
updates = [];
for (let i = 1; i < 150; i++) nextFrame(2000 + i * 16);
assert.equal(nodes[0].hoverProgress, 1);
updates = [];
nextFrame(5000);
assert.equal(updates.length, 0, 'Settled hover stops edge geometry writes');
nodes[0].hovered = false;
nextFrame(5016);
assert(updates.length > 0, 'Hover exit updates connected edges');
console.log('PASS 80 nodes / 240 pairs: idle and settled hover skip all edge updates; transitions update incident edges only');
