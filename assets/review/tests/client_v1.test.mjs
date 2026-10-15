import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import worker,{hash} from '../server/worker_v1.mjs';
const require=createRequire(process.env.KOPURI_TEST_MODULES?path.join(process.env.KOPURI_TEST_MODULES,'package.json'):import.meta.url);
const {Window}=require('happy-dom'),{IDBFactory}=require('fake-indexeddb');
class D1{constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(readFileSync(new URL('../server/migrations/0001_review_v1.sql',import.meta.url),'utf8'))}prepare(sql){const s=this.db.prepare(sql);let args=[];return {bind(...a){args=a;return this},async first(){return s.get(...args)||null},async all(){return {results:s.all(...args)}},async run(){return s.run(...args)}}}}
const base='https://harahettarou.github.io/fullpuri/';
async function device(env,{idb=new IDBFactory(),url=base+'pages/review.html',offline=false}={}){
 const w=new Window({url});let networkDown=offline;
 const fetcher=async(input,options={})=>{
  const url=String(input);if(networkDown)throw Error('offline');
  if(url.startsWith('https://api.example')){return worker.fetch(new Request(url,{...options,headers:{...options.headers,Origin:new URL(base).origin}}),env)}
  const file=new URL(url).pathname.replace('/fullpuri/','');return new Response(readFileSync(new URL('../../../'+file,import.meta.url)),{headers:{'Content-Type':'application/json'}});
 };
 const context=vm.createContext({window:w,document:w.document,location:w.location,navigator:w.navigator,sessionStorage:w.sessionStorage,localStorage:w.localStorage,indexedDB:idb,crypto:globalThis.crypto,structuredClone,TextEncoder,URL,URLSearchParams,AbortSignal,EventTarget:w.EventTarget,Event:w.Event,btoa,fetch:fetcher,console,setTimeout,clearTimeout,setInterval:()=>0,matchMedia:w.matchMedia.bind(w),ResizeObserver:class{observe(){}},requestAnimationFrame:fn=>fn()});
 const modules=new Map();
 async function load(file){
  if(modules.has(file))return modules.get(file);
  const source=file==='config_v1.js'?"export const API_URL='https://api.example';":readFileSync(new URL('../'+file,import.meta.url),'utf8');
  const m=new vm.SourceTextModule(source,{context,initializeImportMeta(meta){meta.url=base+'assets/review/'+file}});modules.set(file,m);await m.link(spec=>load(spec.replace('./','')));return m;
 }
 const m=await load('core_v1.js');await m.evaluate();const R=m.namespace;
 return {w,R,idb,load,offline(v){networkDown=v}};
}
async function setup(){const DB=new D1(),env={DB,SITE_URL:base,GITHUB_CLIENT_ID:'test',GITHUB_CLIENT_SECRET:'test'};for(const [token,user]of [['a'.repeat(43),'github:1'],['b'.repeat(43),'github:2']])await DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hash(token),user,user,Date.now()+1000000).run();return env}
const auth=(user=1)=>({token:(user===1?'a':'b').repeat(43),user_id:'github:'+user,login:'user'+user});
const target={kind:'word',no:85,page:'No085_p1',text:'test',color:'red',rect:[.1,.2,.1,.02]};
test('client → real API/SQLite → independent client → completion → reload history',async()=>{
 const env=await setup(),a=await device(env),b=await device(env);
 await a.R.change('auth',()=>auth());await a.R.init();await a.R.act('register',target);
 assert.equal(a.R.state().queue.length,0);assert.equal(a.R.state().entries.length,1);
 await b.R.change('auth',()=>auth());await b.R.init();assert.equal(b.R.state().entries.length,1);
 await b.R.act('complete',target);await a.R.refresh();assert.equal(a.R.state().entries[0].review_count,1);assert.equal(a.R.state().entries[0].state,'done');
 const reload=await device(env,{idb:a.idb});await reload.R.init();assert.equal(reload.R.state().entries[0].review_count,1);
 await reload.R.act('reopen',target);await reload.R.act('complete',target);assert.equal(reload.R.state().entries[0].review_count,2);
 const h=await reload.R.history(reload.R.state().entries[0].id);assert.equal(h.history.filter(h=>h.action==='complete').length,2);
});
test('offline mutation survives reload and replays once after reconnection',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();a.offline(true);await a.R.act('register',target);
 assert.equal(a.R.state().queue.length,1);assert.equal(a.R.state().entries[0].pending,true);assert.match(a.R.state().status,/保存失敗/);
 const b=await device(env,{idb:a.idb,offline:true});await b.R.init();assert.equal(b.R.state().queue.length,1);
 b.offline(false);await b.R.flush();assert.equal(b.R.state().queue.length,0);assert.equal(b.R.state().entries.length,1);assert.equal(env.DB.db.prepare('SELECT count(*) n FROM history').get().n,1);
});
test('concurrent change is explicit; reapplying already completed entry does not double-count',async()=>{
 const env=await setup(),a=await device(env),b=await device(env);await a.R.change('auth',()=>auth());await b.R.change('auth',()=>auth());await a.R.init();await a.R.act('register',target);await b.R.init();b.offline(true);await b.R.act('complete',target);await a.R.act('complete',target);b.offline(false);await b.R.flush();assert.equal(b.R.state().conflict,true);assert.equal(b.R.state().queue.length,1);
 await b.R.resolveConflict(true);assert.equal(b.R.state().queue.length,0);assert.equal(b.R.state().entries[0].review_count,1);
});
test('cached entries and offline queue stay scoped to each account',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();a.offline(true);await a.R.act('register',target);await a.R.change('auth',()=>auth(2));a.offline(false);await a.R.init();assert.equal(a.R.state().entries.length,0);assert.equal(a.R.state().queue.length,0);
 await a.R.change('auth',()=>auth());await a.R.init();assert.equal(a.R.state().entries.length,1);assert.equal(a.R.state().queue.length,0);
});
test('black words selected from same OCR line remain separate registrations',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();await a.R.act('register',{...target,color:'black',text:'単語A'});await a.R.act('register',{...target,color:'black',text:'単語B'});assert.equal(a.R.state().entries.length,2);
});
test('viewer DOM: three colors and direct/tap/hidden display modes',async()=>{
 const env=await setup(),a=await device(env,{url:base+'pages/No001-009.html'});
 a.w.document.body.innerHTML='<div id="scroller"><div id="stage"></div></div>';
 const data=JSON.parse(readFileSync(new URL('../targets/No123.json',import.meta.url),'utf8'))[0];
 a.w.KopuriReviewAdapter={page:()=>({key:data.key,no:data.no,label:data.label})};
 const stage=a.w.document.getElementById('stage');stage.getBoundingClientRect=()=>({left:0,top:0,width:1623,height:2293});
 const viewer=await a.load('viewer_v1.js');await viewer.evaluate();assert.equal(a.w.document.querySelectorAll('.kr-launch').length,1);
 const select=a.w.document.querySelector('select');select.value='direct';select.dispatchEvent(new a.w.Event('change'));assert.ok(a.w.document.querySelectorAll('.kr-mark').length>0);
 assert.ok(a.w.document.querySelector('[data-color=red]'));assert.ok(a.w.document.querySelector('[data-color=green]'));assert.ok(a.w.document.querySelector('[data-color=orange]'));
 select.value='tap';select.dispatchEvent(new a.w.Event('change'));assert.equal(a.w.document.querySelectorAll('.kr-mark').length,0);
 select.value='hidden';select.dispatchEvent(new a.w.Event('change'));assert.equal(a.w.document.querySelectorAll('.kr-mark').length,0);
 assert.equal(a.w.localStorage.getItem('kopuri-review-display-v1'),'hidden');
});
test('logout clears local private cache and leaves server-side records intact',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();await a.R.act('register',target);await a.R.logout();assert.equal(a.R.state().auth,null);assert.equal(a.R.state().entries.length,0);assert.equal(await a.R.read('user:github:1'),undefined);assert.equal(env.DB.db.prepare('SELECT count(*) n FROM entries').get().n,1);
});
test('viewer DOM: explicit range selection registers actual source coordinates',async()=>{
 const env=await setup(),a=await device(env,{url:base+'pages/No085.html'});await a.R.change('auth',()=>auth());
 a.w.document.body.innerHTML='<div id="scroller"><div id="stage"></div></div>';
 a.w.KopuriReviewAdapter={page:()=>({key:'No085_p1',no:85,label:'No.85'})};
 const stage=a.w.document.getElementById('stage');stage.getBoundingClientRect=()=>({left:10,top:20,width:1000,height:2000});
 a.w.HTMLElement.prototype.setPointerCapture=()=>{};
 const viewer=await a.load('viewer_v1.js');await viewer.evaluate();
 const choose=[...a.w.document.querySelectorAll('button')].find(b=>b.textContent==='範囲を囲んで登録');await choose.onclick();
 const selection=a.w.document.querySelector('.kr-selection');assert.ok(selection);
 selection.dispatchEvent(new a.w.PointerEvent('pointerdown',{clientX:110,clientY:220,pointerId:1,bubbles:true}));
 selection.dispatchEvent(new a.w.PointerEvent('pointermove',{clientX:410,clientY:620,pointerId:1,bubbles:true}));
 selection.dispatchEvent(new a.w.PointerEvent('pointerup',{clientX:410,clientY:620,pointerId:1,bubbles:true}));
 const register=[...a.w.document.querySelectorAll('button')].find(b=>b.textContent==='登録');assert.ok(register);await register.onclick();
 const entry=a.R.state().entries[0];assert.equal(entry.target.kind,'range');assert.deepEqual(Array.from(entry.target.rect),[.1,.1,.3,.2]);assert.equal(a.R.state().queue.length,0);assert.equal(a.w.document.querySelector('.kr-selection'),null);
});
test('manager DOM filters and counts match saved records',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();await a.R.act('register',target);await a.R.act('register',{...target,kind:'page',color:'',text:'No.85',rect:[0,0,1,1]});
 a.w.document.body.innerHTML=readFileSync(new URL('../../../pages/review.html',import.meta.url),'utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
 const m=await a.load('manager_v1.js');await m.evaluate();assert.match(a.w.document.getElementById('stats').textContent,/要復習 2件/);assert.equal(a.w.document.querySelectorAll('article').length,2);
 const filter=a.w.document.getElementById('kind');filter.value='word';filter.dispatchEvent(new a.w.Event('change'));assert.equal(a.w.document.querySelectorAll('article').length,1);
 const link=a.w.document.querySelector('article a');assert.match(link.href,/page=No085_p1/);assert.match(link.href,/review=/);
 const complete=[...a.w.document.querySelectorAll('article button')].find(b=>b.textContent==='復習完了');await complete.onclick();assert.equal(a.w.document.querySelectorAll('article').length,0);
 a.w.document.getElementById('state').value='done';a.w.document.getElementById('state').dispatchEvent(new a.w.Event('change'));assert.equal(a.w.document.querySelectorAll('article').length,1);assert.match(a.w.document.querySelector('article').textContent,/復習 1回/);
});
test('black OCR text selection registers only user-chosen text without auto buttons',async()=>{
 const env=await setup(),a=await device(env,{url:base+'pages/No085.html'});await a.R.change('auth',()=>auth());
 a.w.document.body.innerHTML='<div id="scroller"><div id="stage"></div></div>';a.w.KopuriReviewAdapter={page:()=>({key:'No085_p1',no:85,label:'No.85'})};
 const stage=a.w.document.getElementById('stage');stage.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:2000});a.w.HTMLElement.prototype.setPointerCapture=()=>{};
 const m=await a.load('viewer_v1.js');await m.evaluate();assert.equal(a.w.document.querySelector('[data-color=black]'),null);
 const data=JSON.parse(readFileSync(new URL('../targets/No085.json',import.meta.url),'utf8'))[0],line=data.lines.find(l=>l.text.length>4),x=(line.rect[0]+line.rect[2]/2)*1000,y=(line.rect[1]+line.rect[3]/2)*2000;
 const choose=[...a.w.document.querySelectorAll('button')].find(b=>b.textContent==='黒文字を選んで登録');await choose.onclick();const box=a.w.document.querySelector('.kr-selection');
 box.dispatchEvent(new a.w.PointerEvent('pointerdown',{clientX:x,clientY:y,pointerId:1,bubbles:true}));box.dispatchEvent(new a.w.PointerEvent('pointerup',{clientX:x,clientY:y,pointerId:1,bubbles:true}));
 const text=a.w.document.querySelector('textarea');assert.ok(text);text.setSelectionRange(1,3);const chosen=text.value.slice(1,3).trim();const register=[...a.w.document.querySelectorAll('button')].find(b=>b.textContent==='選択した文字を要復習に登録');await register.onclick();assert.equal(a.R.state().entries[0].target.text,chosen);assert.equal(a.R.state().entries[0].target.color,'black');
});
test('saved target deep link highlights frozen original-image coordinates',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();await a.R.act('register',target);const id=a.R.state().entries[0].id;
 const b=await device(env,{idb:a.idb,url:base+'pages/No085.html?page=No085_p1&review='+id});b.w.document.body.innerHTML='<div id="scroller"><div id="stage"></div></div>';b.w.KopuriReviewAdapter={page:()=>({key:'No085_p1',no:85,label:'No.85'})};
 const stage=b.w.document.getElementById('stage');stage.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:2000});b.w.document.getElementById('scroller').scrollBy=()=>{};
 const m=await b.load('viewer_v1.js');await m.evaluate();const mark=b.w.document.querySelector('.kr-focus');assert.ok(mark);assert.equal(mark.style.left,'10%');assert.equal(mark.style.top,'20%');assert.equal(mark.style.width,'10%');assert.equal(mark.style.height,'2%');
 // Width/height scale with stage layout rather than persisting CSS pixel coordinates.
 stage.style.width='4000px';assert.equal(mark.style.left,'10%');assert.equal(mark.style.top,'20%');
});
