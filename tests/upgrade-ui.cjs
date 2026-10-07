// Run with NODE_PATH pointing to an installed Playwright distribution.
// Uses an isolated browser and synthetic records; never touches extension data.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer(async (req, res) => {
    try {
      const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
      if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html');
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1' || url.pathname.startsWith('/_favicon')) return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="8" fill="blue"/></svg>'});
      return route.continue();
    });
    await page.addInitScript(() => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
      const at = today.getTime();
      window.fixtureSessions = [
        {domain:'alpha.test', startedAt:at, endedAt:at+60000,duration:60000,fromDomain:null},
        {domain:'beta.test', startedAt:at+60000, endedAt:at+180000,duration:120000,fromDomain:'alpha.test'},
        {domain:'alpha.test', startedAt:yesterday.getTime(),endedAt:yesterday.getTime()+30000,duration:30000,fromDomain:null}
      ];
      window.requests = [];
      let enabled = true;
      window.chrome = { runtime: {
        getURL: value => new URL('/' + value, location.origin).href,
        sendMessage(message, callback) {
          window.requests.push(message);
          let response;
          switch (message.type) {
            case 'GET_SESSIONS':
            case 'EXPORT_SESSIONS': response = {sessions:window.fixtureSessions.filter(s=>!message.range || message.range.start == null || (s.endedAt > message.range.start && s.startedAt < message.range.end))}; break;
            case 'GET_TRACKING_STATUS': response = {enabled}; break;
            case 'SET_TRACKING_ENABLED': enabled=message.enabled; response={enabled}; break;
            case 'IMPORT_SESSIONS': {
              const existing = new Set(window.fixtureSessions.map(s=>JSON.stringify(s)));
              const added=message.sessions.filter(s=>!existing.has(JSON.stringify(s)));
              window.fixtureSessions.push(...added);
              response={imported:added.length,skipped:message.sessions.length-added.length}; break;
            }
            case 'CLEAR_SESSIONS': window.fixtureSessions=[]; response={cleared:true}; break;
            default: response={error:'Unknown message'};
          }
          setTimeout(()=>callback(response), 5);
        }
      }};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/visualization/visualization.html`);
    await page.waitForSelector('.ranking-item');
    await page.waitForFunction(()=>document.querySelector('#periodComparison').textContent.includes('비교') || document.querySelector('#periodComparison').textContent.includes('이전'));
    assert.equal(await page.locator('.ranking-item').count(), 2);
    for (const [width,height] of [[1920,1080],[1440,900],[1280,720],[1100,600],[1024,768],[390,844]]) {
      await page.setViewportSize({width,height});
      assert(await page.evaluate(()=>{
        const map=document.querySelector('#network').getBoundingClientRect();
        const pane=document.querySelector('#graphPane').getBoundingClientRect();
        const detail=document.querySelector('#detail').getBoundingClientRect();
        const ranking=document.querySelector('#ranking').getBoundingClientRect();
        const desktop=innerWidth>=1100;
        return map.height>0 && Math.abs(map.height-pane.height)<2 &&
          map.bottom<=innerHeight+1 &&
          document.documentElement.scrollHeight<=innerHeight+1 &&
          document.documentElement.scrollWidth<=innerWidth+1 &&
          (!desktop || (Math.abs(map.top-detail.top)<2 && Math.abs(map.bottom-detail.bottom)<2 &&
            Math.abs(map.bottom-ranking.bottom)<2));
      }), 'Viewport-fit map/panels without page overflow at '+width+'x'+height);
    }
    await page.setViewportSize({width:1440,height:1000});
    assert(await page.evaluate(()=>{
      const records=[
        {domain:'order.pay.naver.com',fromDomain:'shopping.naver.com',duration:100},
        {domain:'orders.pay.naver.com',fromDomain:'order.pay.naver.com',duration:200},
        {domain:'pay.naver.com',fromDomain:'note.naver.com',duration:300},
        {domain:'shopping.naver.com',duration:400},
        {domain:'note.naver.com',duration:500}
      ];
      const original=JSON.stringify(records);
      const graph=aggregateSessions(records);
      const pay=graph.nodes.find(n=>n.domain==='pay.naver.com');
      return graph.nodes.length===3 && pay.activeTime===600 && pay.sessionCount===3 &&
        graph.edges.length===2 && graph.edges.every(e=>e.source!==e.target && e.target==='pay.naver.com') &&
        JSON.stringify(records)===original &&
        groupSessionBySite(records[1]).fromDomain===null &&
        getSiteDomain('a.b.pay.naver.com')==='pay.naver.com' &&
        getSiteDomain('www.naver.com')==='naver.com' &&
        getSiteDomain('pay.naver.com.evil.test')==='com.evil.test' &&
        getSiteDomain('a.example.co.kr')==='a.example.co.kr';
    }), 'Service-level aggregation conserves time/sessions, merges endpoints without self-edges, preserves raw records');
    assert(await page.evaluate(async()=>{
      const pixel=(r,g,b,a=255)=>[r,g,b,a];
      if (measureFaviconDarkness(pixel(0,0,0,0))!==0 ||
          measureFaviconDarkness(pixel(255,255,255))!==0 ||
          measureFaviconDarkness([...pixel(0,0,0),...pixel(0,0,0,0)])!==1) return false;
      const favicon=document.querySelector('.node-favicon');
      const original=favicon.getAttribute('href');
      const icon=color=>'data:image/svg+xml,'+encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M8 8H24V24H8Z" fill="'+color+'"/></svg>');
      const dark=icon('black'),light=icon('white');
      favicon.setAttribute('href',dark);
      await applyFaviconContrast(favicon,dark);
      const hasGlow=favicon.style.filter.includes('drop-shadow');
      favicon.setAttribute('href',light);
      await applyFaviconContrast(favicon,light);
      const noGlow=favicon.style.filter==='none';
      await applyFaviconContrast(favicon,dark);
      const staleIgnored=favicon.style.filter==='none';
      favicon.setAttribute('href',original);
      await applyFaviconContrast(favicon,original);
      return hasGlow && noGlow && staleIgnored;
    }), 'Dark favicon silhouette glow, transparent exclusion, bright and stale URL guards');
    assert(await page.locator('.edge-line').first().isVisible());
    assert(!(await page.locator('.edge-ribbon').first().isVisible()));
    assert(await page.evaluate(()=>{
      const widths=[1,2,10,100,100000].map(calculateSimpleEdgeWidth);
      const a={screenX:0,screenY:0,screenRadius:10};
      const b={screenX:100,screenY:0,screenRadius:20};
      return widths[0]===0.8 && widths.every((v,i)=>v<=2.2 && (!i||v>=widths[i-1])) &&
        createSimpleEdgePath(a,b)==='M 10 0 L 80 0' &&
        createSimpleEdgePath(a,{...b,screenX:20})==='' &&
        createEdgePairs([{source:'a',target:'b',count:2},{source:'b',target:'a',count:3}]).length===1;
    }));
    const overviewLine=page.locator('.edge-line').first();
    assert.equal(await overviewLine.evaluate(el=>getComputedStyle(el).strokeWidth),'0.8px');
    const hoverBox=await page.locator('.node-hover-rim').first().boundingBox();
    await page.mouse.move(hoverBox.x+hoverBox.width/2,hoverBox.y+hoverBox.height/2);
    await page.waitForFunction(()=>document.querySelector('.edge-hovered .edge-line') &&
      Number(getComputedStyle(document.querySelector('.edge-hovered .edge-line')).strokeOpacity)>0.85);
    assert(!(await page.locator('.edge-ribbon').first().isVisible()), 'Hover must not enable glue');
    await page.mouse.move(10,10);
    await page.waitForFunction(()=>!document.querySelector('.edge-hovered'));
    assert((await page.locator('#periodComparison').textContent()).includes('beta.test'));
    assert((await page.locator('#periodComparison').textContent()).includes('새 방문'));
    if (process.env.MAP_SCREENSHOT) await page.screenshot({path:process.env.MAP_SCREENSHOT,fullPage:true});
    // Wheel steps ease toward a bounded viewBox; hit testing uses its CTM.
    const network=page.locator('#network');
    await network.evaluate(el=>{
      const r=el.getBoundingClientRect();
      el.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,clientX:r.x+r.width/2,clientY:r.y+r.height/2,bubbles:true,cancelable:true}));
    });
    assert(await page.evaluate(()=>svg.viewBox.baseVal.width>mapZoomTarget.width), 'Zoom should interpolate, not jump');
    await page.waitForFunction(()=>mapZoomFrame===null);
    assert(await page.evaluate(()=>WIDTH/svg.viewBox.baseVal.width>1 && WIDTH/svg.viewBox.baseVal.width<3));
    await network.evaluate(el=>{
      const r=el.getBoundingClientRect();
      for(let i=0;i<30;i++) el.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,clientX:r.x+r.width/2,clientY:r.y+r.height/2,bubbles:true,cancelable:true}));
    });
    await page.waitForFunction(()=>mapZoomFrame===null);
    assert(await page.evaluate(()=>Math.abs(WIDTH/svg.viewBox.baseVal.width-3)<0.00001), 'Zoom capped at 3x');
    const panBefore=await page.evaluate(()=>{
      const bg=svg.querySelector('.map-background'),m=svg.getScreenCTM();
      return {x:svg.viewBox.baseVal.x, bgX:Number(bg.getAttribute('x'))*m.a+m.e, nodeX:m.e};
    });
    const panBox=await network.boundingBox();
    await page.mouse.move(panBox.x+panBox.width/2,panBox.y+panBox.height/2);
    await page.mouse.down();
    await page.mouse.move(panBox.x+panBox.width/2+60,panBox.y+panBox.height/2+20,{steps:5});
    await page.mouse.up();
    assert(await page.evaluate(before=>{
      const bg=svg.querySelector('.map-background'),m=svg.getScreenCTM();
      const bgDelta=Number(bg.getAttribute('x'))*m.a+m.e-before.bgX;
      const nodeDelta=m.e-before.nodeX;
      return svg.viewBox.baseVal.x<before.x && Math.abs(bgDelta/nodeDelta-0.3)<0.001 &&
        !document.querySelector('.node-group.is-selected') &&
        [...svg.querySelectorAll('[data-map-background]')].every(image=>
          ['x','y','width','height'].every(key=>image.getAttribute(key)===bg.getAttribute(key)));
    },panBefore), 'Drag pans without selecting; all background copies move at 30%');
    assert(await page.evaluate(()=>{
      const p=svg.createSVGPoint(); p.x=600;p.y=350;
      const screen=p.matrixTransform(svg.getScreenCTM());
      const restored=getSvgPointerPosition({clientX:screen.x,clientY:screen.y});
      return Math.abs(restored.x-600)<0.001 && Math.abs(restored.y-350)<0.001;
    }));
    await network.evaluate(el=>{
      const r=el.getBoundingClientRect();
      for(let i=0;i<30;i++) el.dispatchEvent(new WheelEvent('wheel',{deltaY:100,clientX:r.x+r.width/2,clientY:r.y+r.height/2,bubbles:true,cancelable:true}));
    });
    await page.waitForFunction(()=>mapZoomFrame===null);
    assert.equal(await network.getAttribute('viewBox'),'0 0 1200 700');
    assert.equal((await page.locator('.history-title').textContent()).trim(),'하루 기록 재생');
    assert.equal(await page.locator('#historyReset').count(),0);
    assert.equal(await page.locator('#historyExit').count(),0);
    assert.equal(await page.locator('#historyPlay').getAttribute('aria-label'),'재생');
    assert(await page.locator('#historyPlay svg').isVisible());
    assert(await page.locator('#historySlider.noUi-target').isVisible());
    assert(await page.locator('.history-date-input').isVisible());
    // Speed cycles x0.5 → x1 → x2 → x4 → x8 → x0.5 on each click.
    const speeds=[];
    for(let i=0;i<5;i++){ await page.locator('#historySpeed').click(); speeds.push(await page.evaluate(()=>historySpeed)); }
    assert.deepEqual(speeds,[2,4,8,0.5,1]);
    assert.equal((await page.locator('#historySpeed').textContent()).trim(),'×1');
    for(let i=0;i<4;i++) await page.locator('#historySpeed').click();
    assert.equal(await page.evaluate(()=>historySpeed),0.5);
    await page.locator('#historyPlay').click();
    await page.waitForFunction(()=>document.querySelector('#historyStatus').textContent.includes('1/2'));
    assert.equal(await page.locator('.node-group.is-selected').getAttribute('data-domain'),'alpha.test');
    assert.equal(await page.locator('.history-stop').count(),2);
    assert.equal(await page.locator('.history-stop[aria-current="true"]').count(),1);
    assert.equal(await page.locator('.edge-highlight').count(),0, 'Replay must not highlight edges');
    assert.equal(await page.locator('.node-group:not(.dimmed)').count(),1, 'Replay must focus only the current node');
    assert.equal(await page.locator('#historyPlay').getAttribute('aria-label'),'일시정지');
    for(let i=0;i<3;i++) await page.locator('#historySpeed').click();
    assert.equal(await page.evaluate(()=>historySpeed),4);
    await page.waitForFunction(()=>document.querySelector('#historyStatus').textContent.includes('2/2'));
    assert.equal(await page.locator('.node-group.is-selected').getAttribute('data-domain'),'beta.test');
    assert.equal(await page.locator('.edge-highlight').count(),0);
    await page.locator('.history-stop').first().click();
    assert.equal(await page.locator('.node-group.is-selected').getAttribute('data-domain'),'alpha.test');
    assert.equal(await page.evaluate(()=>historyTimer),null);
    await page.locator('.history-stop').last().click();
    assert.equal(await page.locator('.node-group:not(.dimmed)').count(),1, 'Connected nodes must stay dimmed');
    assert.equal(await page.evaluate(()=>historyTimer),null);
    assert.equal(await page.locator('#historyPlay').getAttribute('aria-label'),'재생');
    // Clicking the start of the noUiSlider track scrubs back to the first visit.
    const track=await page.locator('#historySlider').boundingBox();
    await page.mouse.click(track.x+2,track.y+track.height/2);
    await page.waitForFunction(()=>document.querySelector('#historyStatus').textContent.includes('1/2'));
    await page.locator('#historySlider .noUi-handle').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(()=>document.querySelector('#historyStatus').textContent.includes('2/2'));
    // Leaving replay happens through the period filter.
    await page.locator('[data-period="today"]').click();
    await page.waitForFunction(()=>document.querySelector('#periodComparison').textContent.includes('새 방문'));
    await page.locator('[data-period="all"]').click();
    await page.waitForFunction(()=>document.querySelector('#periodComparison').textContent.includes('비교가 없습니다'));
    await page.locator('[data-period="today"]').click();
    await page.waitForFunction(()=>document.querySelector('#periodComparison').textContent.includes('새 방문'));
    await page.locator('.history-date-input').click();
    assert(await page.locator('.flatpickr-calendar.open').isVisible());
    await page.keyboard.press('Escape');
    await page.evaluate(()=>historyDatePicker.setDate('2000-01-01',true));
    await page.waitForFunction(()=>document.querySelector('#historyDate').value==='2000-01-01' && document.querySelector('.history-date-input').value.includes('2000년'));
    await page.locator('#historyPlay').click();
    await page.waitForFunction(()=>document.querySelector('#historyStatus').textContent.includes('기록이 없습니다'));
    await page.keyboard.press('Escape');
    await page.locator('.ranking-item').first().click();
    assert.equal(await page.locator('.node-group.is-selected').count(),1);
    assert(await page.locator('.edge-highlight .edge-ribbon').first().isVisible());
    assert(!(await page.locator('.edge-highlight .edge-line').first().isVisible()));
    assert.equal(await page.locator('.edge-highlight .edge-ribbon').first().evaluate(el=>getComputedStyle(el).fill),'none');
    assert.equal(await page.locator('.edge-highlight .edge-ribbon').first().evaluate(el=>getComputedStyle(el).fillOpacity),'1');
    assert.equal(await page.locator('.edge-highlight .edge-ribbon').first().evaluate(el=>getComputedStyle(el).stroke),'none');
    assert.equal(await page.locator('.node-refracted-background').count(),2);
    assert((await page.locator('.node-bubble').first().getAttribute('href')).includes('bubble-clean.png'));
    assert(await page.evaluate(()=>Math.abs(lensSample(0.001)/0.001-0.5)<0.001 && (lensSample(1)-lensSample(0.999))/0.001>1.8));
    const refraction = page.locator('.edge-highlight .edge-refracted-background').first();
    assert(await refraction.isVisible());
    for (const attribute of ['href','x','y','width','height','preserveAspectRatio']) {
      assert.equal(await refraction.getAttribute(attribute),await page.locator('.map-background').getAttribute(attribute));
    }
    assert(Number(await page.locator('filter[id^="edge-refraction-"] feDisplacementMap').first().getAttribute('scale')) > 0);
    const rim = page.locator('.node-group.is-selected .node-hover-rim');
    const rimBox = await rim.boundingBox();
    await page.mouse.move(rimBox.x+rimBox.width/2,rimBox.y+rimBox.height/2);
    await page.waitForFunction(()=>document.querySelector('.node-group.is-hovered .node-hover-rim') && Number(getComputedStyle(document.querySelector('.node-group.is-hovered .node-hover-rim')).opacity)>0.8);
    // The field and filter viewport must stay fixed while the lens moves.
    assert(await page.evaluate(async()=>{
      const filters=[...document.querySelectorAll('filter[id$="-filter"]')].filter(el=>el.querySelector('feDisplacementMap'));
      const snapshot=()=>filters.map(el=>[
        ...['x','y','width','height'].map(name=>el.getAttribute(name)),
        el.querySelector('feImage').getAttribute('href')
      ]);
      const before=JSON.stringify(snapshot());
      const group=document.querySelector('.edge-highlight .edge-glass');
      const transform=group.getAttribute('transform');
      for(let i=0;i<24;i++) await new Promise(requestAnimationFrame);
      return before===JSON.stringify(snapshot()) && group.getAttribute('transform')!==transform &&
        filters.every(el=>el.getAttribute('width')==='1' && el.getAttribute('height')==='1');
    }), 'Moving lenses must retain their optical fields and normalized filter viewport');
    assert(await page.locator('.edge-highlight .edge-glass-shadow').isVisible());
    // Freeze node motion and compare actual pixels with/without the lens.
    await page.evaluate(()=>cancelAnimationFrame(animationFrameId));
    const lensOn = await page.locator('#network').screenshot();
    const saved = await refraction.evaluate(el=>{
      const value=el.parentElement.getAttribute('filter');
      el.parentElement.removeAttribute('filter');return value;
    });
    const lensOff = await page.locator('#network').screenshot();
    assert(!lensOn.equals(lensOff),'Refraction must visibly change rendered pixels');
    await refraction.evaluate((el,value)=>el.parentElement.setAttribute('filter',value),saved);
    if (process.env.MAP_SCREENSHOT) await page.screenshot({path:process.env.MAP_SCREENSHOT.replace('.png','-gel.png'),fullPage:true});
    await page.locator('[data-period="7days"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-period="7days"]').getAttribute('aria-pressed')==='true');
    await page.locator('.data-settings summary').click();
    await page.locator('#trackingToggle').click();
    await page.waitForFunction(()=>document.querySelector('#trackingToggle').textContent.includes('재개'));
    const downloadEvent=page.waitForEvent('download');
    await page.locator('#exportData').click();
    const download=await downloadEvent;
    assert(download.suggestedFilename().endsWith('.json'));
    await page.waitForFunction(()=>!document.querySelector('#importData').disabled);
    const sessions = await page.evaluate(()=>window.fixtureSessions);
    await page.locator('#importFile').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'internet-map',version:1,sessions}))});
    await page.waitForFunction(()=>document.querySelector('#dataStatus').textContent.includes('중복 3개'));
    page.once('dialog', dialog=>dialog.dismiss());
    await page.locator('#clearData').click();
    assert.equal(await page.evaluate(()=>window.fixtureSessions.length),3);
    page.once('dialog', dialog=>dialog.accept());
    await page.locator('#clearData').click();
    await page.waitForFunction(()=>document.querySelector('#dataStatus').textContent.includes('삭제했습니다'));
    assert.equal(await page.locator('.ranking-item').count(),0);
    assert.equal(await page.locator('.node-group').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS UI: period rendering/comparison, replay order/reset/scrub/exit/empty day, selection, pause, export, duplicate import, clear cancel/confirm, empty state, no runtime errors');
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
