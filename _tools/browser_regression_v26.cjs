const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../qa_performance_v26');
const server=http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(new URL(req.url,'http://local').pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}fs.readFile(file,(e,data)=>{if(e){res.writeHead(404).end();return}res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(data)})});
function* walk(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,d.name);if(d.isDirectory())yield* walk(f);else if(f.endsWith('.html')&&fs.readFileSync(f,'utf8').includes('function applyZoom(options={})'))yield f}}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const results=[];
try{
 const ctx=await browser.newContext({viewport:{width:1024,height:1366},hasTouch:true});
 await ctx.route('https://fullpuri-review.niwatorikounotori.workers.dev/**',route=>route.fulfill({json:route.request().url().includes('/auth/providers')?{github:true,google:true}:{pages:[]}}));
 const page=await ctx.newPage();let errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const file of walk(path.join(root,'pages'))){errors=[];const rel=path.relative(root,file).replaceAll('\\','/');const url=`http://127.0.0.1:${server.address().port}/${rel}`+(rel.includes('centuries/')?'?century=c-15':'');
 await page.goto(url);await page.waitForFunction(()=>window.KopuriReviewAdapter?.page()&&document.querySelector('#baseImg').naturalWidth>0&&document.querySelector('.kr-layer'));
 const result=await page.evaluate(async()=>{
  const p=PAGES[idx],size=[oc.width,oc.height],hash=()=>oc.toDataURL();const initial=hash();
  const states=[];for(const z of [25,100,200,400]){zoom=z;applyZoom();await new Promise(requestAnimationFrame);const r=stage.getBoundingClientRect();states.push({z,width:r.width,height:r.height,ratio:r.width/r.height})}
  if(initial!==hash())throw Error('Zoom changed original canvas pixels');
  if(size[0]!==oc.width||size[1]!==oc.height)throw Error('Zoom resized canvas');
  for(const id of ['orangeToggle','greenToggle']){const t=document.getElementById(id);t.checked=!t.checked;t.dispatchEvent(new Event('change'));t.checked=!t.checked;t.dispatchEvent(new Event('change'))}
  if(initial!==hash())throw Error('Toggle round-trip changed overlay');
  const originalOptions=document.getElementById('pageSelect').firstChild;
  if(PAGES.length>1){idx=(idx+1)%PAGES.length;loadPage();idx=(idx-1+PAGES.length)%PAGES.length;loadPage()}
  const stableOptions=originalOptions===document.getElementById('pageSelect').firstChild;
  zoom=200;applyZoom();const sc=document.getElementById('scroller');sc.scrollLeft=100;sc.scrollTop=200;
  const rect=sc.getBoundingClientRect(),touches=[{clientX:rect.left+100,clientY:rect.top+150},{clientX:rect.left+200,clientY:rect.top+150}];
  const event=(type,t)=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:t});sc.dispatchEvent(e)};
  event('touchstart',touches);event('touchmove',[touches[0],{clientX:rect.left+250,clientY:rect.top+150}]);event('touchend',[]);
  if(zoom!==300||stage.classList.contains('pinching'))throw Error('Pinch did not flush final frame');
  const scroll=[sc.scrollLeft,sc.scrollTop];
  event('touchstart',touches);event('touchmove',[touches[0],{clientX:rect.left+1000,clientY:rect.top+150}]);event('touchcancel',[]);if(zoom!==400)throw Error('Pinch upper clamp');
  const current=PAGES[idx];return {key:current.key,count:PAGES.length,size,states,stableOptions,pinchZoom:300,scroll,source:base.getAttribute('src')};
 });
 assert.ok(result.stableOptions,rel);assert.deepEqual(errors,[],rel);for(const s of result.states)assert.ok(Math.abs(s.ratio-result.size[0]/result.size[1])<.002,rel+' aspect');
 results.push({file:rel,...result});console.log('PASS',rel);
 }
 // Real mouse events exercise pointer capture and dragging.
 await page.goto(`http://127.0.0.1:${server.address().port}/pages/No085_ルネサンス.html`);await page.waitForFunction(()=>document.querySelector('.kr-layer'));
 await page.evaluate(()=>{zoom=400;applyZoom();document.getElementById('scroller').scrollTop=200});
 const box=await page.locator('#scroller').boundingBox();const y=box.y+100;await page.mouse.move(box.x+100,y);await page.mouse.down();await page.mouse.move(box.x+100,y-70,{steps:5});await page.mouse.up();assert.ok(await page.evaluate(()=>document.getElementById('scroller').scrollTop)>250);
 await ctx.close();
}finally{await browser.close();server.close();fs.writeFileSync(path.join(out,'browser-regression.json'),JSON.stringify(results,null,2))}
console.log('Viewer pages passed:',results.length);
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
