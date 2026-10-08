const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../visualization/liquid-optics.js'), 'utf8'), context);
function element() {
  return { style: {}, writes: 0, attrs: {},
    setAttribute(key, value) { this.attrs[key] = value; this.writes++; },
    getAttribute(key) { return this.attrs[key]; },
    hasAttribute(key) { return key in this.attrs; }
  };
}
const surface = {group: element(), shape: element(), image: element(), map: element(), overlays: []};
surface.map.setAttribute('href', 'cached-field');
const node = {screenX: 50, screenY: 60, screenRadius: 10, hoverProgress: 0,
  domGroup: {classList: {contains: name => name === 'is-selected' && node.selected}}, lensSurface: surface};
context.updateNodeLens(node);
assert.equal(surface.group.style.display, 'none');
assert.equal(surface.shape.writes, 0);
node.hovered = true;
context.updateNodeLens(node);
assert.equal(surface.group.style.display, '');
const writes = surface.shape.writes + surface.group.writes + surface.image.writes;
context.updateNodeLens(node);
assert.equal(surface.shape.writes + surface.group.writes + surface.image.writes, writes);
node.renderX = 52;
context.updateNodeLens(node);
assert(surface.shape.writes > 1);
node.hovered = false;
node.selected = true;
context.updateNodeLens(node);
assert.equal(surface.group.style.display, '');
node.selected = false;
context.updateNodeLens(node);
assert.equal(surface.group.style.display, 'none');
console.log('PASS: inactive optics skipped, focus restored, unchanged geometry cached');
