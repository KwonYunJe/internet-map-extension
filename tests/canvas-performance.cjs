// Synthetic dense graph only: never reads personal extension storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');
// Reuse the existing HTTP fixture without executing its test runner.
const source = fs.readFileSync(require('node:path').join(__dirname, 'redesign-ui.cjs'), 'utf8');
const helpers = source.slice(0, source.indexOf('(async () =>'));
const {startServer, openPage} = new Function('require', '__dirname', helpers + ';return {startServer,openPage};')(require, __dirname);

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({headless:true, channel:'chrome'});
  try {
    const {page, errors} = await openPage(browser, server.address().port);
    await page.evaluate(() => {
      const base = fixtureSessions[0];
      fixtureSessions = Array.from({length:640}, (_,i) => ({...base,
        domain:`site${i%80}.test`, pageUrl:`https://site${i%80}.test`,
        faviconPageUrl:`https://site${i%80}.test`,
        fromDomain:`site${(i+1+Math.floor(i/80)*9)%80}.test`,
        startedAt:Date.now()-7200000+i*1000, endedAt:Date.now()-7200000+i*1000+900, duration:900,
      }));
    });
    await page.locator('[data-period="all"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.node-group').length === 80);
    await page.waitForTimeout(600);
    assert.equal(await page.locator('.edge-pair').count(),640);
    const canvas = page.locator('.edge-canvas');
    assert.equal(await canvas.count(),1);
    assert(await canvas.evaluate(el => {
      const data=el.getContext('2d').getImageData(0,0,el.width,el.height).data;
      return data.some((value,index) => index%4===3 && value>0);
    }), 'Canvas contains visible edge pixels');
    const metrics = await page.evaluate(async () => {
      const svg = document.querySelector('svg:has(.node-group)');
      const rect=svg.getBoundingClientRect();
      const intervals=[]; let last;
      const end=performance.now()+1800;
      await new Promise(resolve => {
        function frame(t) {
          if(last) intervals.push(t-last); last=t;
          svg.dispatchEvent(new PointerEvent('pointermove', {bubbles:true,
            clientX:rect.x+rect.width*(.5+.4*Math.sin(t/300)),
            clientY:rect.y+rect.height*(.5+.4*Math.cos(t/400))}));
          if(t<end) requestAnimationFrame(frame); else resolve();
        }
        requestAnimationFrame(frame);
      });
      intervals.sort((a,b)=>a-b);
      return {fps:Math.round(1000/(intervals.reduce((a,b)=>a+b,0)/intervals.length)),
        p95:Math.round(intervals[Math.floor(intervals.length*.95)])};
    });
    await page.mouse.move(0,0);
    await page.evaluate(()=>document.querySelector('svg:has(.node-group)').dispatchEvent(new PointerEvent('pointerleave')));
    await page.waitForTimeout(800);
    const snapshot=await canvas.evaluate(el=>el.toDataURL());
    await page.waitForTimeout(200);
    assert((await canvas.evaluate(el=>el.toDataURL()))===snapshot,'Idle canvas remains unchanged');
    await page.locator('.ranking-item').first().click();
    await page.waitForTimeout(400);
    assert((await canvas.evaluate(el=>el.toDataURL()))!==snapshot,'Selection updates edge material');
    await page.screenshot({path:'/tmp/internet-map-canvas-dense.png'});
    await page.evaluate(()=>document.querySelector('svg:has(.node-group)').setAttribute('viewBox','200 100 400 233.333'));
    await page.locator('.period-filter-button').nth(1).click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.edge-canvas-host').getAttribute('width'),'1200','Period change at 3x zoom keeps full world-space canvas');
    assert.deepEqual(errors,[]);
    console.log('PASS Canvas: 80 nodes / 640 pairs, visible pixels, stable idle, selection, no errors',metrics);
  } finally { await browser.close(); server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
