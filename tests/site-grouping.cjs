const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({URL});
vm.runInContext(fs.readFileSync(path.join(root,'visualization/site-grouping.js'),'utf8'), context);
context.pslText = fs.readFileSync(path.join(root,'visualization/assets/public_suffix_list.dat'),'utf8');
vm.runInContext('siteSuffixRules = parseSiteSuffixRules(pslText)',context);
const cases = [
  ['order.pay.naver.com','pay.naver.com'],
  ['orders.pay.naver.com','pay.naver.com'],
  ['a.shopping.naver.com','shopping.naver.com'],
  ['note.naver.com','note.naver.com'],
  ['www.youtube.com','youtube.com'],
  ['studio.youtube.com','studio.youtube.com'],
  ['a.b.example.co.kr','b.example.co.kr'],
  ['www.example.co.uk','example.co.uk'],
  ['x.docs.alice.github.io','docs.alice.github.io'],
  ['alice.github.io','alice.github.io'],
  ['bob.github.io','bob.github.io'],
  ['a.b.foo.ck','a.b.foo.ck'],
  ['x.y.www.ck','y.www.ck'],
  ['a.b.city.kawasaki.jp','b.city.kawasaki.jp'],
  ['WWW.NAVER.COM.','naver.com'],
  ['www.食狮.com.cn','xn--85x722f.com.cn'],
  ['127.0.0.1','127.0.0.1'],
  ['[::1]','[::1]'],
  ['localhost','localhost'],
  ['co.kr','co.kr'],
  ['pay.naver.com.evil.test','com.evil.test'],
  ['https://naver.com/a','https://naver.com/a'],
  [null,null]
];
for (const [input, expected] of cases) {
  context.input = input;
  const actual = vm.runInContext('getSiteDomain(input)',context);
  assert.equal(actual,expected,String(input));
  context.input = actual;
  assert.equal(vm.runInContext('getSiteDomain(input)',context),expected,'Idempotent: '+input);
}
vm.runInContext('SITE_GROUP_OVERRIDES.set("service.example.com","example.com"); siteDomainCache.clear()',context);
assert.equal(vm.runInContext('getSiteDomain("a.service.example.com")',context),'example.com');
assert.equal(vm.runInContext('getSiteDomain("service.example.com.evil.test")',context),'com.evil.test');
assert.throws(()=>vm.runInContext('parseSiteSuffixRules("<html>error</html>")',context));
console.log('PASS site grouping: PSL exact/wildcard/exception/private/IDN, www, IP, boundaries, idempotence, overrides');
