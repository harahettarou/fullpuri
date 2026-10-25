const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {default:worker,hash}=require('../assets/review/server/worker_v19.mjs');
const root=path.resolve(__dirname,'..'),base='https://harahettarou.github.io/fullpuri/',api='https://fullpuri-review.niwatorikounotori.workers.dev';
const out=path.resolve(root,'../qa_performance_v26');
class D1{constructor(){this.db=new DatabaseSync(':memory:');for(const f of fs.readdirSync(path.join(root,'assets/review/server/migrations')).filter(f=>f.endsWith('.sql')).sort())this.db.exec(fs.readFileSync(path.join(root,'assets/review/server/migrations',f),'utf8'))}prepare(sql){const s=this.db.prepare(sql);let a=[];return {bind(...v){a=v;return this},async first(){return s.get(...a)||null},async all(){return {results:s.all(...a)}},async run(){return s.run(...a)}}}}
async function apiRequest(env,p,b){const r=await worker.fetch(new Request(api+p,{method:b?'POST':'GET',headers:{Origin:new URL(base).origin,Authorization:'Bearer '+'a'.repeat(43),'Content-Type':'application/json'},...(b?{body:JSON.stringify(b)}:{})}),env);const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data}
const target=(page='No085_p1',kind='range',rect=[.2,.3,.15,.04])=>({no:Number(page.slice(2,5)),page,kind,rect,color:'',text:'audit memo'});
async function seed(env,t,scope='shared',body='stored '+scope){t={...t,rect:t.rect.map(v=>Math.round(v*1e6)/1e6)};const id=await hash(JSON.stringify([t.kind,t.no&&t.kind==='print'?t.no:t.page,t.color,['print','page'].includes(t.kind)?[]:t.rect,t.color==='black'?t.text:'']));return apiRequest(env,scope==='shared'?'/shared-note-operations':'/note-operations',{op_id:await hash(JSON.stringify(t)+scope),id,action:'put',target:t,body,expected:0})}
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const results=[];
try{for(const variant of ['v25','v26','v28']){
 const env={DB:new D1(),SITE_URL:base,GITHUB_CLIENT_ID:'test',GITHUB_CLIENT_SECRET:'test',ADMIN_USER_IDS:'github:1'};
 await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hash('a'.repeat(43)),'github:1','audit-user',Date.now()+3600000).run();
 await seed(env,target());await seed(env,target('No085_p2'));await seed(env,target('No085_p1','page',[0,0,1,1]),'private');await seed(env,target('No086_p1'));
 for(let i=0;i<3;i++)await seed(env,target('No163_p2','range',[.1,.2+i*.1,.15,.04]));
 const ctx=await browser.newContext({viewport:{width:1024,height:1366},hasTouch:true});const requests=[],errors=[];
 await ctx.route(base+'**',route=>{const rel=decodeURIComponent(new URL(route.request().url()).pathname).replace('/fullpuri/','');if(rel==='audit-blank.html')return route.fulfill({contentType:'text/html',body:'<html></html>'});const file=path.join(root,rel);try{let data=fs.readFileSync(file);if(variant!=='v28'&&file.endsWith('.html'))data=Buffer.from(data.toString().replaceAll('review/viewer_v28.js','review/viewer_'+variant+'.js').replaceAll('review/viewer_v14_perf_v28.js',variant==='v25'?'review/viewer_v14.js':'review/viewer_v14_perf_v26.js').replaceAll('review/viewer_v18_perf_v28.js',variant==='v25'?'review/viewer_v18.js':'review/viewer_v18_perf_v26.js'));return route.fulfill({body:data,contentType:({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream'})}catch{return route.fulfill({status:404,body:''})}});
 await ctx.route(api+'/**',async route=>{const req=route.request();const p=new URL(req.url()).pathname;requests.push(p);try{const headers={...await req.allHeaders(),origin:new URL(base).origin};const r=await worker.fetch(new Request(req.url(),{method:req.method(),headers,...(req.postData()?{body:req.postData()}:{})}),env);return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:await r.text()})}catch(e){errors.push(String(e));return route.fulfill({status:500,json:{error:String(e)}})}});
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(base+'audit-blank.html');await page.evaluate(async()=>{const R=await import('/fullpuri/assets/review/core_v12.js');await R.change('auth',()=>({token:'a'.repeat(43),user_id:'github:1',login:'audit-user'}))});
 for(const rel of ['pages/No085_ルネサンス.html','pages/regions/europe.html?page=No085_p1','pages/centuries/view.html?century=c-15&page=No085_p1']){
  await page.goto(base+rel);await page.waitForFunction(()=>document.querySelector('.kr-layer'));
  await page.evaluate(()=>{const i=PAGES.findIndex(p=>p.key==='No085_p1');if(i>=0&&PAGES[idx].key!=='No085_p1'){document.getElementById('pageSelect').value=String(i);document.getElementById('pageSelect').dispatchEvent(new Event('change'))}});
  await page.waitForTimeout(450);
  const snapshot=await page.evaluate(async()=>{const R=await import('/fullpuri/assets/review/core_v12.js'),N=await import('/fullpuri/assets/review/notes_core_v14.js');return {launcher:document.querySelector('.kr-launch').textContent,page:window.KopuriReviewAdapter.page(),notes:N.state().notes.map(n=>({id:n.id,page:n.target.page,no:n.target.no,scope:n.scope})),status:N.state().status,actions:[...document.querySelectorAll('.kr-action-groups button')].map(n=>n.textContent),outlines:document.querySelectorAll('.kn-note-outline').length}});
  results.push({variant,rel,initial:snapshot});
  console.log(variant,rel,JSON.stringify({launcher:snapshot.launcher,notes:snapshot.notes.length,outlines:snapshot.outlines,status:snapshot.status}));
  assert.match(snapshot.launcher,variant==='v28'?/メモ 2件/:/メモ 3件/);
  if(variant==='v28')assert.equal(await page.getByRole('button',{name:'共通・個人のメモを表示',exact:true}).count(),0);
  assert.equal(snapshot.outlines,2);
  await page.evaluate(()=>{const sel=document.getElementById('pageSelect');sel.value=String(PAGES.findIndex(p=>p.key==='No085_p2'));sel.dispatchEvent(new Event('change'))});await page.waitForTimeout(220);
  assert.equal(await page.locator('.kn-note-outline').count(),1);
  const menu=page.locator('.kr-launch');await menu.click();await page.getByText('表示設定',{exact:true}).click();await page.getByLabel('メモの表示範囲',{exact:true}).selectOption('private');await page.waitForTimeout(50);assert.equal(await page.locator('.kn-note-outline').count(),0);
  await page.getByLabel('メモの表示範囲',{exact:true}).selectOption('both');await page.getByRole('button',{name:'閉じる',exact:true}).first().click();
  await page.evaluate(async()=>{const N=await import('/fullpuri/assets/review/notes_core_v14.js');const n=N.state().allNotes.find(n=>n.scope==='shared'&&n.target.kind==='page'&&n.target.page==='No085_p2');if(n?.deleted)await N.restore(n.target,n.version)});
  await menu.click();await page.getByRole('button',{name:'このページにメモ',exact:true}).click();await page.getByLabel('メモ本文',{exact:true}).fill('new memo '+rel);await page.getByRole('button',{name:'メモを保存',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.kn-editor'));
  const savedCount=variant==='v28'?'メモ 2件':'メモ 4件',deletedCount=variant==='v28'?'メモ 1件':'メモ 3件';
  await page.waitForFunction(t=>document.querySelector('.kr-launch').textContent.includes(t),savedCount);assert.equal(await page.locator('.kn-note-outline').count(),2);
  const savedTarget=target('No085_p2','page',[0,0,1,1]);
  await page.evaluate(async t=>{const E=await import('/fullpuri/assets/review/note_editor_v14.js');await E.openEditor(t)},savedTarget);await page.getByLabel('メモ本文',{exact:true}).fill('edited memo');await page.getByRole('button',{name:'メモを保存',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.kn-editor'));
  await page.evaluate(async t=>{const N=await import('/fullpuri/assets/review/notes_core_v14.js');const n=N.state().allNotes.find(n=>n.scope==='shared'&&n.target.kind==='page'&&n.target.page===t.page);await N.remove(n.target,n.version,'shared')},savedTarget);
  await page.waitForFunction(t=>document.querySelector('.kr-launch').textContent.includes(t),deletedCount);assert.equal(await page.locator('.kn-note-outline').count(),1);
  await page.evaluate(async t=>{const N=await import('/fullpuri/assets/review/notes_core_v14.js');let n=N.state().allNotes.find(n=>n.scope==='shared'&&n.target.kind==='page'&&n.target.page===t.page);await N.restore(n.target,n.version);n=N.state().allNotes.find(x=>x.id===n.id&&x.scope==='shared');await N.remove(n.target,n.version,'shared')},savedTarget);
  await page.waitForFunction(t=>document.querySelector('.kr-launch').textContent.includes(t),deletedCount);
 }
 await page.goto(base+'pages/regions/europe.html');await page.waitForFunction(()=>document.querySelector('.kr-layer'));
 await page.evaluate(async()=>{const N=await import('/fullpuri/assets/review/notes_core_v14.js');N.setView('private');const sel=document.getElementById('pageSelect');sel.value=String(PAGES.findIndex(p=>p.key==='No086_p1'));sel.dispatchEvent(new Event('change'))});await page.waitForTimeout(250);
 const filtered=await page.evaluate(async()=>{const N=await import('/fullpuri/assets/review/notes_core_v14.js');return {launcher:document.querySelector('.kr-launch').textContent,selectedView:N.state().view,visibleNotes:N.state().notes.filter(n=>!n.deleted&&n.target.no===86).length,storedNotes:N.state().allNotes.filter(n=>!n.deleted&&n.target.no===86).length}});
 console.log(variant,'FILTERED',JSON.stringify(filtered));results.push({variant,filtered});assert.equal(filtered.storedNotes,1);
 if(variant==='v28'){assert.match(filtered.launcher,/メモ 1件/);await page.locator('.kr-launch').click();await page.getByRole('button',{name:'共通・個人のメモを表示',exact:true}).click();assert.equal(await page.locator('.kn-note-outline').count(),1);await page.getByRole('button',{name:'閉じる',exact:true}).first().click()}else assert.doesNotMatch(filtered.launcher,/メモ/);
 const catalog=JSON.parse(fs.readFileSync(path.join(root,'assets/classic/catalog_v18.json'),'utf8'));
 await page.evaluate(async()=>{const N=await import('/fullpuri/assets/review/notes_core_v14.js');N.setView('both')});
 await page.goto(base+catalog.No163_p1.href);await page.waitForFunction(()=>document.querySelector('.kr-layer'));
 for(const part of [1,2,1]){await page.evaluate(part=>{const N=window.KopuriReviewAdapter;const sel=document.getElementById('pageSelect');sel.value=String(PAGES.findIndex(p=>p.key==='No163_p'+part));sel.dispatchEvent(new Event('change'))},part);await page.waitForTimeout(180);const badge=await page.locator('.kr-launch').textContent();results.push({variant,no163part:part,badge});console.log(variant,'No163_p'+part,badge);if(variant==='v28'&&part===1)assert.doesNotMatch(badge,/メモ/);else assert.match(badge,/メモ 3件/)}
 assert.deepEqual(errors,[]);results.push({variant,requests,errors});await ctx.close();
}}finally{await browser.close();fs.writeFileSync(path.join(out,'notes-audit-v28.json'),JSON.stringify(results,null,2))}
})().catch(e=>{console.error(e);process.exitCode=1});
