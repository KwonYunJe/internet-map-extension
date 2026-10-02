// Isolated real IndexedDB + service-worker API tests. Requires Playwright in NODE_PATH.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer(async (req,res) => {
    if(req.url==='/') {res.end('<html></html>');return;}
    try {res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(root,req.url)));}
    catch {res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    const page=await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result=await page.evaluate(async()=>{
      const check=(ok,message)=>{if(!ok)throw new Error(message)};
      const seed={domain:'alpha.test',startedAt:1000,endedAt:4000,duration:3000,fromDomain:null};
      await new Promise((resolve,reject)=>{
        const request=indexedDB.open('internet-map-db',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('sessions',{keyPath:'id',autoIncrement:true}).add(seed);
        request.onsuccess=()=>{request.result.close();resolve()};request.onerror=()=>reject(request.error);
      });
      const db=await import('/src/db.js');
      check((await db.getAllSessions()).length===1,'v1 migration preserves records');
      check((await db.openDatabase()).transaction('sessions').objectStore('sessions').indexNames.contains('endedAt'),'overlap index');
      check((await db.getSessionsInRange({start:2000,end:3000})).length===1,'cross-boundary inclusion');
      check((await db.getSessionsInRange({start:4000,end:5000})).length===0,'exclusive boundary');
      const second={domain:'beta.test',startedAt:5000,endedAt:6000,duration:1000,fromDomain:'alpha.test'};
      const merged=await db.importSessions([seed,second,second]);
      check(merged.imported===1&&merged.skipped===2,'in-file and stored duplicate exclusion');
      let rejected=false;
      try{await db.importSessions([{...second,startedAt:7000,endedAt:8000},{...seed,endedAt:0}])}catch{rejected=true}
      check(rejected&&(await db.getAllSessions()).length===2,'invalid import atomicity');
      const concurrent=await Promise.all([db.importSessions([{...second,startedAt:7000,endedAt:8000}]),db.importSessions([{...second,startedAt:7000,endedAt:8000}])]);
      check(concurrent.reduce((sum,r)=>sum+r.imported,0)===1,'concurrent imports dedupe');
      const local={},session={},events={};
      const storage=data=>({get:async key=>({[key]:data[key]}),set:async values=>Object.assign(data,values),remove:async key=>{delete data[key]}});
      const event=name=>({addListener:fn=>events[name]=fn});
      window.chrome={storage:{local:storage(local),session:storage(session)},runtime:{onMessage:event('message'),onInstalled:event('installed'),onStartup:event('startup'),getURL:p=>p},tabs:{onActivated:event('activated'),onUpdated:event('updated'),query:async()=>[{url:'https://active.test',active:true}]},windows:{getAll:async()=>[{id:1,focused:true}],onFocusChanged:event('focus'),WINDOW_ID_NONE:-1},action:{onClicked:event('action')}};
      await import('/background/service-worker.js');
      const call=message=>new Promise(resolve=>events.message(message,{},resolve));
      check((await call({type:'GET_TRACKING_STATUS'})).enabled,'tracking defaults enabled');
      session.currentSession={domain:'active.test',startedAt:Date.now()-5000};
      check((await call({type:'SET_TRACKING_ENABLED',enabled:false})).enabled===false,'pause API');
      check(!session.currentSession,'pause closes active');
      const pausedCount=(await db.getAllSessions()).length;
      events.activated();await call({type:'GET_TRACKING_STATUS'});
      check(!session.currentSession&&(await db.getAllSessions()).length===pausedCount,'paused events do not record');
      events.installed();await call({type:'GET_TRACKING_STATUS'});
      check(local.trackingEnabled===false,'update preserves pause');
      check((await call({type:'SET_TRACKING_ENABLED',enabled:true})).enabled&&session.currentSession,'resume starts active');
      check((await call({type:'IMPORT_SESSIONS',sessions:[seed]})).skipped===1,'import API');
      check((await call({type:'GET_SESSIONS',range:{start:2000,end:3000}})).sessions.length===1,'range API');
      check((await call({type:'EXPORT_SESSIONS'})).sessions.length>0,'export API');
      await call({type:'CLEAR_SESSIONS'});
      check((await db.getAllSessions()).length===0,'clear API');
      check(session.currentSession?.fromDomain===null,'clear resets active continuity');
      return 'PASS storage: v1 migration, indexed overlap, import validation/atomicity/concurrent dedupe, pause/resume, install preference, export, clear';
    });
    assert(result.startsWith('PASS'));console.log(result);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
