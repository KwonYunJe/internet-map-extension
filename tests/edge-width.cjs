const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../visualization/visualization.js'), 'utf8');
const context = vm.createContext({EDGE_END_WIDTH: 4.4});
for (const [start,end] of [['function calculateDirectionalEdgeStartWidth','function calculateEdgeDepthOpacity'],
  ['function createTaperedRibbonPath','function updateDirectionalEdgePath']]) {
  vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
}
assert.equal(context.calculateDirectionalEdgeStartWidth(1), 8.3);
assert(context.calculateDirectionalEdgeStartWidth(10) > 13);
assert.equal(context.calculateDirectionalEdgeStartWidth(1000000), 24);
const a={screenX:100,screenY:100,screenRadius:40};
const b={screenX:500,screenY:100,screenRadius:40};
const d=context.createTaperedRibbonPath(a,b,8.3,4.4,0);
const numbers=d.match(/-?\d+(?:\.\d+)?/g).map(Number);
assert.equal(numbers[1],112,'Source width is proportional to its radius');
assert.equal(numbers[13],112,'Arrival width is proportional to its own radius');
assert(numbers[7]-100 < 3,'Center is narrower than both attachments');
assert(numbers[7]-100 > 1.5*0.675,'Bidirectional center lanes overlap rather than leaving a hollow gap');
assert.equal(context.createTaperedRibbonPath(a,b,24,8,0),d,'Frequency no longer changes attachment width');
const larger=context.createTaperedRibbonPath({...a,screenRadius:80},b,8,3,0).match(/-?\d+(?:\.\d+)?/g).map(Number);
assert.equal(larger[1],124,'Doubling radius doubles the source attachment width');
assert(!/NaN|Infinity/.test(context.createTaperedRibbonPath({...a,screenRadius:4},b,24,4.4,0)));
console.log('PASS edge width: proportional attachments, narrow waist, frequency-independent shape, small nodes');
