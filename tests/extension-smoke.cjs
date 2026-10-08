// Isolated Chrome profile: never loads or edits the user's personal profile.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
  const context = await chromium.launchPersistentContext('', {channel:'chrome', headless:true,
    viewport:{width:1440,height:1000},
    args:['--enable-unsafe-extension-debugging'],
    ignoreDefaultArgs:['--disable-extensions']});
  try {
    const session = await context.browser().newBrowserCDPSession();
    const {id} = await session.send('Extensions.loadUnpacked', {path:path.resolve(__dirname, '..'),enableInIncognito:true});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if(m.type()==='error') errors.push(m.text()); });
    await page.goto(`chrome-extension://${id}/visualization/visualization.html`);
    await page.waitForFunction(() => typeof window.chrome?.runtime?.sendMessage === 'function');
    const result = await page.evaluate(async () => {
      const send = message => new Promise(resolve => chrome.runtime.sendMessage(message, resolve));
      await send({type:'SET_TRACKING_ENABLED',enabled:false});
      const at = Date.now() - 600000;
      const records = [
        {domain:'alpha.test',startedAt:at,endedAt:at+60000,duration:60000,fromDomain:null},
        {domain:'beta.test',startedAt:at+60000,endedAt:at+180000,duration:120000,fromDomain:'alpha.test'},
        {domain:'alpha.test',startedAt:at+180000,endedAt:at+240000,duration:60000,fromDomain:'beta.test'}
      ];
      return await send({type:'IMPORT_SESSIONS',sessions:records});
    });
    assert.equal(result.imported,3);
    await page.reload();
    await page.waitForSelector('.ranking-item');
    assert.equal(await page.locator('.ranking-item').count(),2);
    await page.locator('[data-period="all"]').click();
    await page.waitForFunction(() => document.querySelector('[data-period="all"]').getAttribute('aria-pressed')==='true');
    const assets = await page.evaluate(async () => {
      const urls = [...document.querySelectorAll('.node-bubble')].map(el=>el.getAttribute('href'));
      return Promise.all(urls.map(url => new Promise(resolve => {
        const image = new Image(); image.onload=()=>resolve(true); image.onerror=()=>resolve(false); image.src=url;
      })));
    });
    assert(assets.length>0 && assets.every(Boolean),'Bubble assets load in actual extension origin');
    assert.equal(await page.locator('.edge-canvas').count(),1,'Canvas edge layer loads under extension CSP');
    assert(await page.locator('.edge-canvas').evaluate(el => {
      const pixels=el.getContext('2d').getImageData(0,0,el.width,el.height).data;
      return pixels.some((value,index)=>index%4===3 && value>0);
    }),'Actual extension canvas draws edges');
    assert.deepEqual(errors,[],'Extension console/page errors');
    console.log('PASS real MV3 extension: unpacked install, service-worker import/local storage, period control, graph/ranking, local bubble loading, CSP/console smoke');
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
