'use strict';
// Isolated CI experiment. No app source changes. Run from repository root.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'experiment', 'results', 'browser', 'results.json');
const PLAYER = path.join(ROOT, 'node_modules', 'asciinema-player');
const CAP = 1000, CELL_CAP = 40000; // Experimental policy candidates, not production recommendations.
const results = [];
const report = { metadata: { node: process.version, markerCap: CAP, cellCap: CELL_CAP, maxTestMarkers: 3000, repetitions: 1, caveat: 'Controlled CI measurements do not establish safe production or mobile thresholds. This run exercises total-cell checks through an adapter seam rather than the optional loader cell budget.' }, results };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const save = () => fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
const hardStop = setTimeout(() => { report.fatal = 'Overall 240-second experiment deadline'; save(); process.exit(1); }, 240000);
const fixtures = new Map();
function markers(n) {
  const events = [[0,'o','START\r\n'],[2.5,'o','END\r\n'],[3,'o','DONE\r\n']];
  for (let i=0;i<n;i++) events.push([0.1+i*2.3/Math.max(n,1),'m',`mark-${i}`]);
  events.sort((a,b)=>a[0]-b[0]);
  return [JSON.stringify({version:2,width:40,height:6}),...events.map(JSON.stringify)].join('\n')+'\n';
}
for (const n of [0,100,500,1000,1001,3000]) fixtures.set(`markers-${n}`,markers(n));
for (const name of ['hello.cast','v1-pretty.cast','v3-comments.cast']) fixtures.set(name,fs.readFileSync(path.join(ROOT,'tests','fixtures',name),'utf8'));
fixtures.set('late-resize','{"version":2,"width":40,"height":6}\n[0,"o","START"]\n[1,"r","1001x24"]\n[3,"o","END"]\n');
fixtures.set('large-initial-cells','{"version":2,"width":1000,"height":1000}\n[0,"o","START"]\n[3,"o","END"]\n');
fixtures.set('large-resize-cells','{"version":2,"width":40,"height":6}\n[0,"o","START"]\n[1,"r","1000x1000"]\n[3,"o","END"]\n');
fixtures.set('compat-zero-dimensions','{"version":2,"width":0,"height":0}\n[0,"o","COMPAT\\r\\n"]\n[3,"o","done"]\n');
fixtures.set('compat-blank-lines','{"version":2,"width":40,"height":6}\n\n[0,"o","COMPAT\\r\\n"]\n[3,"o","done"]\n');
const html='<!doctype html><html><head><link rel="icon" href="data:,"><link rel="stylesheet" href="/player.css"></head><body><div id="player"></div><script src="/player.js"></script></body></html>';
const assets = new Map([
 ['/player.js',[path.join(PLAYER,'dist/bundle/asciinema-player.min.js'),'text/javascript']],
 ['/player.css',[path.join(PLAYER,'dist/bundle/asciinema-player.css'),'text/css']],
 ['/loader.mjs',[path.join(ROOT,'experiment/bounded-loader.mjs'),'text/javascript']]
]);
let server;
async function runCase(origin, c) {
  let browser;
  const errors=[];
  const timer=setTimeout(()=>{results.push({...c,error:'Hard 25-second case deadline'});save();process.exit(1);},25000);
  try {
    browser=await chromium.launch({headless:true,timeout:10000,...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE}: {}),args:['--js-flags=--max-old-space-size=256','--enable-precise-memory-info']});
    report.metadata.chromium=browser.version();
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:900}});
    await context.route('**/*', async route=>{
      const u=new URL(route.request().url());
      const allowed=u.origin===origin && (u.pathname==='/' || u.pathname==='/frame' || assets.has(u.pathname) || (u.pathname.startsWith('/fixture/') && fixtures.has(decodeURIComponent(u.pathname.slice(9)))));
      if(allowed) await route.continue(); else { errors.push(`Blocked unexpected request: ${u.origin}${u.pathname}`); await route.abort(); }
    });
    const page=await context.newPage();page.setDefaultTimeout(10000);
    page.on('pageerror', e=>errors.push(String(e)));
    await page.goto(origin+'/',{waitUntil:'load'});
    let frame=page.mainFrame();
    if(c.realm==='iframe') {
      await page.evaluate(()=>{const f=document.createElement('iframe');f.id='test-frame';f.src='/frame';document.body.appendChild(f);});
      const handle=await page.waitForSelector('#test-frame');frame=await handle.contentFrame();
      await frame.waitForFunction(()=>typeof AsciinemaPlayer!=='undefined');
    }
    const r=await frame.evaluate(async c=>{
      const {loadBounded}=await import('/loader.mjs');
      const heapBefore=performance.memory?.usedJSHeapSize??null;const metrics={};const before=document.querySelectorAll('*').length;
      let playerCalls=0, p, data;const started=performance.now();
      // Adapter seam deliberately runs after bounded parsing and before real player creation.
      function checkCells(parsed) {
        const h=Array.isArray(parsed)?parsed[0]:parsed;
        const w=h.version===3?h.term.cols:h.width, rows=h.version===3?h.term.rows:h.height;
        if(w*rows>c.cellCap) throw Error('cells');
        if(Array.isArray(parsed)) for(const e of parsed.slice(1)) if(e[1]==='r') {
          const [cols,rows]=e[2].split('x').map(Number);if(cols*rows>c.cellCap)throw Error('cells');
        }
      }
      try {
        const response=await fetch('/fixture/'+encodeURIComponent(c.fixture));
        if(c.mode==='prototype') {data=await loadBounded(response,{markers:c.cap},metrics);checkCells(data);}
        else data=await response.text();
      } catch(e) {
        return {rejected:true,error:e.message,playerCalls,metrics,elapsedMs:performance.now()-started,domAdded:document.querySelectorAll('*').length-before,markerElements:document.querySelectorAll('.ap-marker-container').length};
      }
      const loadedMs=performance.now()-started;
      playerCalls++;p=AsciinemaPlayer.create({data},document.getElementById('player'),{preload:true,controls:true});
      try {
        await p.play();await p.pause();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        void document.body.offsetHeight;
        const readyMs=performance.now()-started;
        const domElements=document.querySelectorAll('*').length;
        const markerElements=document.querySelectorAll('.ap-marker-container').length;
        const duration=await p.getDuration();
        await p.seek(0);await p.play();
        const playbackStart=performance.now();let advanced=0;
        while(performance.now()-playbackStart<2500) {advanced=await p.getCurrentTime();if(advanced>0.02)break;await new Promise(r=>setTimeout(r,50));}
        await p.pause();const seekTo=c.markerCount===undefined?Math.max(0.2,duration*0.8):2.8;
        const seekStart=performance.now();await p.seek(seekTo);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const seekMs=performance.now()-seekStart,seekTime=await p.getCurrentTime();
        const terminal=document.querySelector('.ap-term-text')?.textContent||'';
        const heapAfter=performance.memory?.usedJSHeapSize??null;return {heapBefore,heapAfter,heapDelta:heapAfter===null?null:heapAfter-heapBefore,rejected:false,playerCalls,metrics,loadedMs,readyMs,domElements,domAdded:domElements-before,markerElements,duration,advanced,seekTo,seekTime,seekMs,terminal,playbackOk:advanced>0.02,seekOk:Math.abs(seekTime-seekTo)<0.05&&terminal.includes(c.expectedText)&&(c.markerCount===undefined||!terminal.includes('DONE'))};
      } finally {p.dispose();}
    },{...c,cap:CAP,cellCap:CELL_CAP});
    const row={...c,...r,pageErrors:errors};results.push(row);save();
    assert.deepEqual(errors,[],`${c.fixture}: browser errors or unexpected requests`);
    if(c.reject) {assert.equal(r.rejected,true);assert.equal(r.error,c.reject);assert.equal(r.playerCalls,0);assert.equal(r.domAdded,0);assert.equal(r.markerElements,0);}
    else {assert.equal(r.rejected,false);assert.equal(r.playerCalls,1);assert.equal(r.playbackOk,true);assert.equal(r.seekOk,true);assert.equal(r.markerElements,c.markerCount??0);assert.ok(r.duration>0);}
    row.passed=true;save();console.log(JSON.stringify({fixture:c.fixture,mode:c.mode,realm:c.realm,passed:true,rejected:r.rejected,markers:r.markerElements,readyMs:r.readyMs,seekMs:r.seekMs}));
  } catch(e) {results.push({...c,failed:true,error:String(e)});save();throw e;}
  finally {if(browser)await browser.close();clearTimeout(timer);}
}
(async()=>{
  report.metadata.player=JSON.parse(fs.readFileSync(path.join(PLAYER,'package.json'),'utf8')).version;
  assert.equal(report.metadata.player,'3.17.0');
  report.metadata.playwright=require('playwright/package.json').version;
  report.metadata.bundleSha256=crypto.createHash('sha256').update(fs.readFileSync(assets.get('/player.js')[0])).digest('hex');save();
  server=http.createServer((req,res)=>{
    const u=new URL(req.url,'http://127.0.0.1');
    if(req.method!=='GET'){res.writeHead(405).end();return;}
    if(u.pathname==='/'||u.pathname==='/frame'){res.writeHead(200,{'Content-Type':'text/html'}).end(html);return;}
    if(assets.has(u.pathname)){const [file,type]=assets.get(u.pathname);res.writeHead(200,{'Content-Type':type}).end(fs.readFileSync(file));return;}
    if(u.pathname.startsWith('/fixture/')){const text=fixtures.get(decodeURIComponent(u.pathname.slice(9)));if(text!==undefined){res.writeHead(200,{'Content-Type':'application/x-asciicast'}).end(text);return;}}
    res.writeHead(404).end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  for(const count of [0,100,500,1000,1001,3000]) for(const mode of ['baseline','prototype'])
    await runCase(origin,{fixture:`markers-${count}`,markerCount:count,mode,realm:'top',expectedText:'END',...(mode==='prototype'&&count>CAP?{reject:'markers'}:{})});
  for(const [fixture,expectedText] of [['hello.cast','Hello from wp-asciiplayer'],['v1-pretty.cast','Pretty v1 recording'],['v3-comments.cast','Commented v3 recording']])
    for(const realm of ['top','iframe']) for(const mode of ['baseline','prototype'])await runCase(origin,{fixture,expectedText,mode,realm});
  // Observe rather than hide upstream-tolerated compatibility differences.
  for(const [fixture,reject] of [['compat-zero-dimensions','dimensions'],['compat-blank-lines','event']])for(const mode of ['baseline','prototype'])await runCase(origin,{fixture,expectedText:'COMPAT',mode,realm:'top',...(mode==='prototype'?{reject}:{})});
  // No baseline for dangerous dimensions: zero real player calls required.
  for(const [fixture,reject] of [['late-resize','dimensions'],['large-initial-cells','cells'],['large-resize-cells','cells']])await runCase(origin,{fixture,reject,mode:'prototype',realm:'top'});
  report.completed=true;save();console.log(`PASS: ${results.filter(r=>r.passed).length} controlled browser cases. Marker cap ${CAP} is experimental.`);
})().catch(e=>{report.fatal=String(e);save();console.error(e);process.exitCode=1;}).finally(()=>{if(server)server.close();clearTimeout(hardStop);});
