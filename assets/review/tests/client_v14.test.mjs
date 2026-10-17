import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import worker,{hash} from '../server/worker_v12.mjs';
const require=createRequire(process.env.KOPURI_TEST_MODULES?path.join(process.env.KOPURI_TEST_MODULES,'package.json'):import.meta.url);
const {Window}=require('happy-dom'),{IDBFactory}=require('fake-indexeddb');
class D1{constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(readFileSync(new URL('../server/migrations/0001_review_v1.sql',import.meta.url),'utf8'));this.db.exec(readFileSync(new URL('../server/migrations/0002_notes_v3.sql',import.meta.url),'utf8'));this.db.exec(readFileSync(new URL('../server/migrations/0003_google_v8.sql',import.meta.url),'utf8'));this.db.exec(readFileSync(new URL('../server/migrations/0004_shared_notes_v12.sql',import.meta.url),'utf8'))}prepare(sql){const s=this.db.prepare(sql);let args=[];return {bind(...a){args=a;return this},async first(){return s.get(...args)||null},async all(){return {results:s.all(...args)}},async run(){return s.run(...args)}}}}
const base='https://harahettarou.github.io/fullpuri/';
async function device(env,{idb=new IDBFactory(),url=base+'pages/review.html',offline=false}={}){
 const w=new Window({url});let networkDown=offline,approve=()=>true;
 const fetcher=async(input,options={})=>{
  const url=String(input);if(networkDown)throw Error('offline');
  if(url.startsWith('https://api.example')){return worker.fetch(new Request(url,{...options,headers:{...options.headers,Origin:new URL(base).origin}}),env)}
  const file=new URL(url).pathname.replace('/fullpuri/','');return new Response(readFileSync(new URL('../../../'+file,import.meta.url)),{headers:{'Content-Type':'application/json'}});
 };
 const context=vm.createContext({window:w,document:w.document,location:w.location,navigator:w.navigator,sessionStorage:w.sessionStorage,localStorage:w.localStorage,indexedDB:idb,crypto:globalThis.crypto,structuredClone,TextEncoder,URL,URLSearchParams,AbortSignal,EventTarget:w.EventTarget,Event:w.Event,btoa,fetch:fetcher,confirm:message=>approve(message),console,setTimeout,clearTimeout,setInterval:()=>0,matchMedia:w.matchMedia.bind(w),ResizeObserver:class{observe(){}},requestAnimationFrame:fn=>fn()});
 const modules=new Map();
 function create(file){
  if(modules.has(file))return modules.get(file);
  const source=file==='config_v1.js'?"export const API_URL='https://api.example';":readFileSync(new URL('../'+file,import.meta.url),'utf8');
  const m=new vm.SourceTextModule(source,{context,initializeImportMeta(meta){meta.url=base+'assets/review/'+file}});modules.set(file,m);return m;
 }
 async function load(file){const m=create(file);if(m.status==='unlinked')await m.link(spec=>create(spec.replace('./','')));return m}
 const m=await load('core_v12.js');await m.evaluate();const R=m.namespace;
 return {w,R,idb,load,confirm(fn){approve=fn},offline(v){networkDown=v}};
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
 const viewer=await a.load('viewer_v14.js');await viewer.evaluate();assert.equal(a.w.document.querySelectorAll('.kr-launch').length,1);
 const select=a.w.document.querySelector('select[aria-label="チェックボタンの表示方式"]');select.value='direct';select.dispatchEvent(new a.w.Event('change'));assert.ok(a.w.document.querySelectorAll('.kr-mark').length>0);
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
 const viewer=await a.load('viewer_v14.js');await viewer.evaluate();
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
 const m=await a.load('manager_v14.js');await m.evaluate();assert.match(a.w.document.getElementById('stats').textContent,/要復習 2件/);assert.equal(a.w.document.querySelectorAll('article').length,2);
 const filter=a.w.document.getElementById('kind');filter.value='word';filter.dispatchEvent(new a.w.Event('change'));assert.equal(a.w.document.querySelectorAll('article').length,1);
 const link=a.w.document.querySelector('article a');assert.match(link.href,/page=No085_p1/);assert.match(link.href,/review=/);
 const complete=[...a.w.document.querySelectorAll('article button')].find(b=>b.textContent==='復習完了');await complete.onclick();assert.equal(a.w.document.querySelectorAll('article').length,0);
 a.w.document.getElementById('state').value='done';a.w.document.getElementById('state').dispatchEvent(new a.w.Event('change'));assert.equal(a.w.document.querySelectorAll('article').length,1);assert.match(a.w.document.querySelector('article').textContent,/復習 1回/);
});
test('black OCR text selection registers only user-chosen text without auto buttons',async()=>{
 const env=await setup(),a=await device(env,{url:base+'pages/No085.html'});await a.R.change('auth',()=>auth());
 a.w.document.body.innerHTML='<div id="scroller"><div id="stage"></div></div>';a.w.KopuriReviewAdapter={page:()=>({key:'No085_p1',no:85,label:'No.85'})};
 const stage=a.w.document.getElementById('stage');stage.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:2000});a.w.HTMLElement.prototype.setPointerCapture=()=>{};
 const m=await a.load('viewer_v14.js');await m.evaluate();assert.equal(a.w.document.querySelector('[data-color=black]'),null);
 const data=JSON.parse(readFileSync(new URL('../targets/No085.json',import.meta.url),'utf8'))[0],line=data.lines.find(l=>l.text.length>4),x=(line.rect[0]+line.rect[2]/2)*1000,y=(line.rect[1]+line.rect[3]/2)*2000;
 const choose=[...a.w.document.querySelectorAll('button')].find(b=>b.textContent==='黒文字を選んで登録');await choose.onclick();const box=a.w.document.querySelector('.kr-selection');
 box.dispatchEvent(new a.w.PointerEvent('pointerdown',{clientX:x,clientY:y,pointerId:1,bubbles:true}));box.dispatchEvent(new a.w.PointerEvent('pointerup',{clientX:x,clientY:y,pointerId:1,bubbles:true}));
 const text=a.w.document.querySelector('textarea');assert.ok(text);text.setSelectionRange(1,3);const chosen=text.value.slice(1,3).trim();const register=[...a.w.document.querySelectorAll('button')].find(b=>b.textContent==='選択した文字を要復習に登録');await register.onclick();assert.equal(a.R.state().entries[0].target.text,chosen);assert.equal(a.R.state().entries[0].target.color,'black');
});
test('saved target deep link highlights frozen original-image coordinates',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();await a.R.act('register',target);const id=a.R.state().entries[0].id;
 const b=await device(env,{idb:a.idb,url:base+'pages/No085.html?page=No085_p1&review='+id});b.w.document.body.innerHTML='<div id="scroller"><div id="stage"></div></div>';b.w.KopuriReviewAdapter={page:()=>({key:'No085_p1',no:85,label:'No.85'})};
 const stage=b.w.document.getElementById('stage');stage.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:2000});b.w.document.getElementById('scroller').scrollBy=()=>{};
 const m=await b.load('viewer_v14.js');await m.evaluate();const mark=b.w.document.querySelector('.kr-focus');assert.ok(mark);assert.equal(mark.style.left,'10%');assert.equal(mark.style.top,'20%');assert.equal(mark.style.width,'10%');assert.equal(mark.style.height,'2%');
 // Width/height scale with stage layout rather than persisting CSS pixel coordinates.
 stage.style.width='4000px';assert.equal(mark.style.left,'10%');assert.equal(mark.style.top,'20%');
});
async function notes(d){const m=await d.load('notes_core_v14.js');if(m.status!=='evaluated')await m.evaluate();await m.namespace.init();m.namespace.setView('private');return {...m.namespace,put:(t,b,e,scope='private')=>m.namespace.put(t,b,e,scope),remove:(t,e,scope='private')=>m.namespace.remove(t,e,scope)}}
test('notes two clients, offline reload, conflict merge, logout and account isolation',async()=>{
 const env=await setup(),a=await device(env),b=await device(env);for(const d of [a,b]){await d.R.change('auth',()=>auth());await d.R.init()}
 const A=await notes(a),B=await notes(b);await A.put(target,'覚え方\n補足');assert.equal(A.state().queue.length,0);assert.equal(a.R.state().entries.length,0);await B.refresh();assert.equal(B.state().notes[0].body,'覚え方\n補足');
 b.offline(true);await B.put(target,'Bで追記',1);assert.equal(B.state().queue.length,1);await assert.rejects(b.R.logout(),/メモに未送信/);
 await A.put(target,'Aで追記',1);const reloaded=await device(env,{idb:b.idb,offline:true});await reloaded.R.init();const C=await notes(reloaded);assert.equal(C.state().queue.length,1);reloaded.offline(false);await C.flush();assert.equal(C.state().conflict,true);await C.resolveConflict(true,'Aで追記\nBで追記');assert.equal(C.state().queue.length,0);await A.refresh();assert.equal(A.state().notes[0].body,'Aで追記\nBで追記');assert.equal(A.state().notes[0].version,3);
 await a.R.change('auth',()=>auth(2));await a.R.init();await A.init();assert.equal(A.state().notes.length,0);await A.put(target,'B専用');await a.R.logout();assert.equal(await a.R.read('notes:user:github:2'),undefined);assert.equal(env.DB.db.prepare('SELECT count(*) n FROM notes').get().n,2);
});
test('notes editor saves plain text without review registration and manager searches safely',async()=>{
 const env=await setup(),a=await device(env,{url:base+'pages/notes.html'});await a.R.change('auth',()=>auth());await a.R.init();const N=await notes(a);
 const m=await a.load('note_editor_v14.js');await m.evaluate();await m.namespace.openEditor(target,'private');let text=a.w.document.querySelector('textarea');text.value='<img src=x onerror=alert(1)>\n世界史の補足';const save=[...a.w.document.querySelectorAll('button')].find(b=>b.textContent==='メモを保存');await save.onclick();assert.equal(N.state().notes.length,1);assert.equal(a.R.state().entries.length,0);
 a.w.document.body.innerHTML=readFileSync(new URL('../../../pages/notes.html',import.meta.url),'utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)[1];const manager=await a.load('notes_manager_v14.js');await manager.evaluate();assert.equal(a.w.document.querySelectorAll('article').length,1);assert.equal(a.w.document.querySelector('article img'),null);assert.match(a.w.document.querySelector('article').textContent,/<img/);assert.match(a.w.document.querySelector('article a').href,/note=/);
 const search=a.w.document.getElementById('query');search.value='見つからない';search.dispatchEvent(new a.w.Event('input'));assert.equal(a.w.document.querySelectorAll('article').length,0);search.value='世界史';search.dispatchEvent(new a.w.Event('input'));assert.equal(a.w.document.querySelectorAll('article').length,1);
});
test('viewer notes icon follows source target, can be hidden, and range memo leaves reviews empty',async()=>{
 const env=await setup(),a=await device(env,{url:base+'pages/No085.html'});await a.R.change('auth',()=>auth());await a.R.init();const N=await notes(a);await N.put(target,'位置を保存');
 a.w.document.body.innerHTML='<div id="scroller"><div id="stage"></div></div>';a.w.KopuriReviewAdapter={page:()=>({key:'No085_p1',no:85,label:'No.85'})};const stage=a.w.document.getElementById('stage');stage.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:2000});a.w.HTMLElement.prototype.setPointerCapture=()=>{};
 const viewer=await a.load('viewer_v14.js');await viewer.evaluate();assert.ok([...a.w.document.querySelectorAll('.kr-mark')].some(b=>b.textContent==='✎'));const check=a.w.document.querySelector('input[type=checkbox]');check.checked=false;check.dispatchEvent(new a.w.Event('change'));assert.equal(a.w.document.querySelectorAll('.kr-mark').length,0);
 await [...a.w.document.querySelectorAll('button')].find(b=>b.textContent==='範囲を囲んでメモ').onclick();const sel=a.w.document.querySelector('.kr-selection');sel.dispatchEvent(new a.w.PointerEvent('pointerdown',{clientX:100,clientY:200,pointerId:1,bubbles:true}));sel.dispatchEvent(new a.w.PointerEvent('pointerup',{clientX:400,clientY:600,pointerId:1,bubbles:true}));await new Promise(r=>setTimeout(r,10));const text=a.w.document.querySelector('.kn-editor textarea');assert.ok(text);text.value='囲んだ箇所';await [...a.w.document.querySelectorAll('.kn-editor button')].find(b=>b.textContent==='メモを保存').onclick();assert.equal(N.state().allNotes.filter(n=>!n.deleted).length,2);assert.equal(a.R.state().entries.length,0);
});

test('notes deep link keeps original image coordinates and stale editor retains typed content',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();const A=await notes(a);await A.put(target,'元のメモ');const id=A.state().notes[0].id;
 const b=await device(env,{idb:a.idb,url:base+'pages/No085.html?page=No085_p1&note='+id});b.w.document.body.innerHTML='<div id="scroller"><div id="stage"></div></div>';b.w.KopuriReviewAdapter={page:()=>({key:'No085_p1',no:85,label:'No.85'})};const stage=b.w.document.getElementById('stage');stage.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:2000});b.w.document.getElementById('scroller').scrollBy=()=>{};const viewer=await b.load('viewer_v14.js');await viewer.evaluate();const mark=b.w.document.querySelector('.kr-focus');assert.ok(mark);assert.equal(mark.style.left,'10%');assert.equal(mark.style.top,'20%');
 const editor=await b.load('note_editor_v14.js');await editor.namespace.openEditor(target,'private');const textarea=b.w.document.querySelector('.kn-editor textarea');textarea.value='編集中のメモ';await A.put(target,'別の編集',1);const B=await notes(b);await B.refresh();await [...b.w.document.querySelectorAll('.kn-editor button')].find(x=>x.textContent==='メモを保存').onclick();assert.equal(textarea.value,'編集中のメモ');assert.ok(b.w.document.querySelector('.kn-editor'));assert.match(b.w.document.querySelector('.kn-editor .kr-error').textContent,/編集中/);assert.equal(A.state().notes[0].body,'別の編集');
});

test('launcher only shows memo count for the current No and hides it after deletion',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();const N=await notes(a);
 await N.put({...target,no:1,page:'No001_p1'},'別のNoのメモ');
 a.w.document.body.innerHTML='<div id="scroller"><div id="stage"></div></div><div class="nav"><div class="zoom"><button id="zoomOut">−</button><span>100%</span><button id="zoomIn">＋</button></div></div>';
 let page={key:'No085_p1',no:85,label:'No.85'};a.w.KopuriReviewAdapter={page:()=>page};a.w.document.getElementById('stage').getBoundingClientRect=()=>({left:0,top:0,width:350,height:500});
 const m=await a.load('viewer_v14.js');await m.evaluate();const button=a.w.document.querySelector('.kr-launch');assert.equal(button.textContent,'復習 0件');assert.equal(button.parentElement,a.w.document.body);assert.equal(a.w.document.querySelector('.nav .kr-launch'),null);
 const sameNo={...target,page:'No085_p2'};await N.put(sameNo,'同じNoの別ページのメモ');assert.equal(button.textContent,'復習 0件・メモ 1件');await N.put({...target,page:'No001_p1',no:1,rect:[.4,.2,.1,.02]},'別Noの2件目');assert.equal(button.textContent,'復習 0件・メモ 1件');
 await N.remove(sameNo);assert.equal(button.textContent,'復習 0件');
 page={key:'No001_p1',no:1,label:'No.1'};a.w.document.dispatchEvent(new a.w.Event('kopuri:page'));await new Promise(r=>setTimeout(r,10));assert.equal(button.textContent,'復習 0件・メモ 2件');
});
test('independent launcher clearance follows navigation height after resize',async()=>{
 const env=await setup(),a=await device(env);a.w.document.body.innerHTML='<div id="scroller"><div id="stage"></div></div><div class="nav"><div class="zoom"><button>−</button><span>100%</span><button>＋</button></div></div>';a.w.KopuriReviewAdapter={page:()=>({key:'No085_p1',no:85,label:'No.85'})};a.w.document.getElementById('stage').getBoundingClientRect=()=>({left:0,top:0,width:350,height:500});
 let height=150;const nav=a.w.document.querySelector('.nav');nav.getBoundingClientRect=()=>({height,top:a.w.innerHeight-height});const m=await a.load('viewer_v14.js');await m.evaluate();const launcher=a.w.document.querySelector('.kr-launch');assert.equal(launcher.style.getPropertyValue('--kr-nav-clearance'),'150px');height=90;a.w.dispatchEvent(new a.w.Event('resize'));assert.equal(launcher.style.getPropertyValue('--kr-nav-clearance'),'90px');assert.equal(nav.querySelector('.zoom').children.length,3);
});
test('Google link ticket keeps existing local cache, notes and account ownership',async()=>{
 const env=await setup();env.GOOGLE_CLIENT_ID='client';env.GOOGLE_CLIENT_SECRET='secret';const a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();await a.R.act('register',target);const A=await notes(a);await A.put(target,'既存のメモ');
 const ticket='t'.repeat(43),verifier='v'.repeat(43);await env.DB.prepare('INSERT INTO google_tickets VALUES(?,?,?,?,?,?,?)').bind(await hash(ticket),await hash(verifier),'google-person','me@example.com','github:1',await hash('a'.repeat(43)),Date.now()+100000).run();
 const back=await device(env,{idb:a.idb,url:base+'pages/review.html#ticket='+ticket});back.w.sessionStorage.setItem('kopuri-review-verifier',verifier);back.w.sessionStorage.setItem('kopuri-google-link-user','github:1');await back.R.init();assert.equal(back.R.state().auth.user_id,'github:1');assert.equal(back.R.state().auth.provider,'google');assert.equal(back.R.state().account.google_linked,true);assert.equal(back.R.state().entries.length,1);const B=await notes(back);assert.equal(B.state().notes[0].body,'既存のメモ');assert.equal(back.w.location.hash,'');
});
test('provider UI supports Google, legacy GitHub and explicit linking without showing review answers',async()=>{
 const env=await setup();env.GOOGLE_CLIENT_ID='client';env.GOOGLE_CLIENT_SECRET='secret';const a=await device(env);await a.R.init();const ui=await a.load('account_controls_v12.js');await ui.evaluate();const box=a.w.document.createElement('div');ui.namespace.fillAccount(box);assert.ok([...box.querySelectorAll('button')].some(b=>b.textContent==='Googleでログイン'&&!b.disabled));assert.ok([...box.querySelectorAll('button')].some(b=>b.textContent==='GitHubでログイン'));
 await a.R.change('auth',()=>auth());await a.R.init();ui.namespace.fillAccount(box);assert.ok([...box.querySelectorAll('button')].some(b=>b.textContent==='Googleアカウントを連携'));
 await a.R.linkGoogle();const state=env.DB.db.prepare('SELECT * FROM google_states').get();assert.equal(state.source_user_id,'github:1');assert.equal(state.source_session_hash,await hash('a'.repeat(43)));assert.equal(a.w.sessionStorage.getItem('kopuri-google-link-user'),'github:1');
});

test('memo anchors remain visible without room for an icon, follow scaled stage and hide independently',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();const N=await notes(a);await N.put(target,'場所のメモ');
 a.w.document.body.innerHTML='<div id="scroller"><div id="stage"></div></div>';let size=10;a.w.KopuriReviewAdapter={page:()=>({key:'No085_p1',no:85,label:'No.85'})};a.w.document.getElementById('stage').getBoundingClientRect=()=>({left:0,top:0,width:size,height:size*2});
 await (await a.load('viewer_v14.js')).evaluate();let mark=a.w.document.querySelector('.kn-note-outline');assert.ok(mark);assert.equal(mark.style.left,'10%');assert.equal(mark.style.top,'20%');assert.equal(mark.style.width,'10%');assert.equal(a.w.document.querySelectorAll('.kr-mark').length,0);
 size=1000;a.w.document.querySelector('select[aria-label="チェックボタンの表示方式"]').dispatchEvent(new a.w.Event('change'));mark=a.w.document.querySelector('.kn-note-outline');assert.equal(mark.style.left,'10%');assert.equal(mark.style.width,'10%');assert.equal(a.w.document.querySelector('.kr-mark').dataset.note,'true');
 const check=a.w.document.querySelector('input[type=checkbox]');check.checked=false;check.dispatchEvent(new a.w.Event('change'));assert.equal(a.w.document.querySelectorAll('.kn-note-outline').length,0);assert.equal(N.state().notes.length,1);check.checked=true;check.dispatchEvent(new a.w.Event('change'));
 const select=a.w.document.querySelector('select[aria-label="チェックボタンの表示方式"]');select.value='hidden';select.dispatchEvent(new a.w.Event('change'));assert.equal(a.w.document.querySelectorAll('.kn-note-outline,.kr-mark').length,0);select.value='tap';select.dispatchEvent(new a.w.Event('change'));assert.ok(a.w.document.querySelector('.kn-note-outline'));
 await N.remove(target);assert.equal(a.w.document.querySelectorAll('.kn-note-outline').length,0);
});
test('page notes list includes No-wide notes, excludes other pages, focuses exact anchor and opens editor',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();const N=await notes(a);await N.put(target,'語句のメモ');await N.put({...target,kind:'print',rect:[0,0,1,1]},'全体');await N.put({...target,page:'No085_p2'},'別ページ');await N.put({...target,kind:'page',rect:[0,0,1,1]},'このページ');
 a.w.document.body.innerHTML='<div id="scroller"><div id="stage"></div></div>';let scrolls=0;a.w.document.getElementById('scroller').scrollBy=()=>scrolls++;let page={key:'No085_p1',no:85,label:'No.85'};a.w.KopuriReviewAdapter={page:()=>page};a.w.document.getElementById('stage').getBoundingClientRect=()=>({left:0,top:0,width:350,height:500});await (await a.load('viewer_v14.js')).evaluate();assert.equal(a.w.document.querySelectorAll('.kn-note-outline').length,3);
 await [...a.w.document.querySelectorAll('button')].find(b=>b.textContent==='このページのメモ（3件）').onclick();await [...a.w.document.querySelectorAll('button')].find(b=>b.textContent==='位置を表示').onclick();assert.equal(scrolls,1);assert.ok(a.w.document.querySelector('.kn-note-focus'));assert.equal(a.w.document.querySelector('.kn-note-focus').style.left,'10%');
 await [...a.w.document.querySelectorAll('button')].find(b=>b.textContent==='このページのメモ（3件）').onclick();await [...a.w.document.querySelectorAll('button')].find(b=>b.textContent==='メモを見る・編集').onclick();assert.equal(a.w.document.querySelector('.kn-editor textarea').value,'語句のメモ');
 page={key:'No085_p2',no:85,label:'No.85 (2)'};a.w.document.dispatchEvent(new a.w.Event('kopuri:page'));await new Promise(r=>setTimeout(r,10));assert.equal(a.w.document.querySelectorAll('.kn-note-outline').length,2);assert.equal(a.w.document.querySelector('.kn-note-focus'),null);
});

test('study dialog groups review and memo actions and deduplicates account email and saved status',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>({...auth(),login:'me@example.com'}));await a.R.init();const N=await notes(a);await N.put(target,'残すメモ');await a.R.act('register',target);a.R.state().account.google_linked=true;a.R.state().account.google_label='me@example.com';
 a.w.document.body.innerHTML='<div id="scroller"><div id="stage"></div></div>';a.w.KopuriReviewAdapter={page:()=>({key:'No085_p1',no:85,label:'No.85'})};a.w.document.getElementById('stage').getBoundingClientRect=()=>({left:0,top:0,width:1000,height:2000});await (await a.load('viewer_v14.js')).evaluate();const dialog=a.w.document.querySelector('.kr-organized');
 assert.equal(dialog.querySelectorAll('.kr-action-group').length,2);assert.deepEqual([...dialog.querySelectorAll('.kr-action-group h3')].map(e=>e.textContent),['復習','メモ']);const groups=dialog.querySelectorAll('.kr-action-group');assert.equal(groups[0].querySelectorAll('button').length,5);assert.equal(groups[1].querySelectorAll('button').length,5);
 assert.equal(dialog.querySelectorAll('.kr-panel-links a').length,2);assert.equal(dialog.querySelectorAll('details').length,2);assert.ok([...dialog.querySelectorAll('details')].every(e=>!e.open));assert.equal((dialog.textContent.match(/me@example.com/g)||[]).length,1);assert.equal([...dialog.querySelectorAll('button')].some(b=>b.textContent==='ログインし直す'),false);assert.equal(dialog.querySelector('[role=status]').textContent,'復習・メモ：サーバー保存済み');assert.equal(N.state().notes[0].body,'残すメモ');assert.equal(a.R.state().entries.length,1);
});

async function common(d){const m=await d.load('notes_core_v14.js');if(m.status!=='evaluated')await m.evaluate();await m.namespace.init();m.namespace.setView('shared');return m.namespace}
test('new default is shared; independent signed-in users synchronize a memo and retain private scope separately',async()=>{
 const env=await setup(),a=await device(env),b=await device(env);await a.R.change('auth',()=>auth());await a.R.init();await b.R.change('auth',()=>auth(2));await b.R.init();const module=await a.load('notes_core_v14.js');await module.evaluate();assert.equal(module.namespace.state().view,'both');const A=await common(a),B=await common(b);
 await A.put(target,'共通の説明');await B.refresh();assert.equal(B.state().notes[0].body,'共通の説明');assert.equal(B.state().notes[0].scope,'shared');await B.put(target,'別ユーザーが追記',1);await A.refresh();assert.equal(A.state().notes[0].body,'別ユーザーが追記');
 await A.put(target,'自分だけの説明',undefined,'private');assert.equal(A.state().notes.length,1);A.setView('both');assert.equal(A.state().notes.length,2);assert.equal(B.state().allNotes.filter(n=>n.scope==='private').length,0);A.setView('private');assert.equal(A.state().notes[0].body,'自分だけの説明');
 const reload=await device(env,{idb:a.idb});await reload.R.init();const C=await common(reload);assert.equal(C.state().notes[0].body,'別ユーザーが追記');C.setView('private');assert.equal(C.state().notes[0].body,'自分だけの説明');assert.equal((await C.history(C.state().notes[0].id)).history.length,2);
});
test('shared offline writes survive reload and prevent logout, then replay once on recovery',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();const A=await common(a);a.offline(true);await A.put(target,'オフライン共通メモ');assert.equal(A.state().queue.length,1);await assert.rejects(a.R.logout(),/メモに未送信/);
 const b=await device(env,{idb:a.idb,offline:true});await b.R.init();const B=await common(b);assert.equal(B.state().notes[0].body,'オフライン共通メモ');assert.equal(B.state().queue[0].scope,'shared');b.offline(false);await B.sync();assert.equal(B.state().queue.length,0);await B.sync();assert.equal(env.DB.db.prepare('SELECT count(*) n FROM shared_note_history').get().n,1);
 await b.R.logout();assert.equal(B.state().notes.length,0);assert.equal(await b.R.read('shared-notes:user:github:1'),undefined);assert.equal(env.DB.db.prepare('SELECT body FROM shared_notes').get().body,'オフライン共通メモ');
});
test('shared conflict resolution retains local text, refuses restoring deleted rows through put, allows discard',async()=>{
 const env=await setup();env.ADMIN_USER_IDS='github:1';const a=await device(env),b=await device(env);await a.R.change('auth',()=>auth());await a.R.init();await b.R.change('auth',()=>auth(2));await b.R.init();const A=await common(a),B=await common(b);await A.put(target,'元の共通メモ');await B.refresh();b.offline(true);await B.put(target,'Bの追記',1);await A.put(target,'Aの追記',1);b.offline(false);await B.flush();assert.equal(B.state().conflict,true);assert.equal(B.state().queue[0].body,'Bの追記');await B.resolveConflict(true,'AとBの追記を統合');assert.equal(B.state().queue.length,0);assert.equal(B.state().notes[0].body,'AとBの追記を統合');await A.refresh();
 b.offline(true);await B.put(target,'削除と競合する内容',3);await A.remove(target,3,'shared');b.offline(false);await B.flush();assert.equal(B.state().conflict,true);await assert.rejects(B.resolveConflict(true,'残したい内容'),/削除済み/);assert.equal(B.state().queue[0].body,'削除と競合する内容');await B.resolveConflict(false);assert.equal(B.state().queue.length,0);assert.equal(B.state().notes.filter(n=>!n.deleted).length,0);
});
test('shared editor defaults to public scope; only admins receive delete UI and manager can restore with history',async()=>{
 const env=await setup();env.ADMIN_USER_IDS='github:1';const a=await device(env);await a.R.change('auth',()=>auth(2));await a.R.init();const A=await common(a);const editor=await a.load('note_editor_v14.js');await editor.evaluate();await editor.namespace.openEditor(target);assert.equal(a.w.document.querySelector('select[aria-label="メモの保存先"]').value,'shared');a.w.document.querySelector('textarea').value='全員で使う説明';await [...a.w.document.querySelectorAll('button')].find(b=>b.textContent==='メモを保存').onclick();assert.equal(A.state().notes[0].scope,'shared');
 await editor.namespace.openEditor(target,'shared',false);assert.equal([...a.w.document.querySelectorAll('button')].some(b=>b.textContent==='共通メモから削除'),false);assert.equal(a.w.document.querySelector('select[aria-label="メモの保存先"]').disabled,false);
 const admin=await device(env);await admin.R.change('auth',()=>auth());await admin.R.init();const C=await common(admin);admin.w.document.body.innerHTML=readFileSync(new URL('../../../pages/notes.html',import.meta.url),'utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)[1];const manager=await admin.load('notes_manager_v14.js');await manager.evaluate();await [...admin.w.document.querySelectorAll('article button')].find(b=>b.textContent==='共通メモから削除').onclick();assert.equal(C.state().notes[0].deleted,1);const check=admin.w.document.querySelector('#filters input[type=checkbox]');check.checked=true;check.dispatchEvent(new admin.w.Event('change'));await [...admin.w.document.querySelectorAll('article button')].find(b=>b.textContent==='共通メモに復元').onclick();assert.equal(C.state().notes[0].deleted,0);await [...admin.w.document.querySelectorAll('article button')].find(b=>b.textContent==='変更履歴').onclick();assert.ok(admin.w.document.querySelector('dialog').textContent.includes('復元'));assert.ok(admin.w.document.querySelector('dialog').textContent.includes('全員で使う説明'));
});
test('shared manager hides delete for a non-admin while personal delete remains available and deep links specify scope',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth(2));await a.R.init();const A=await common(a);await A.put(target,'共通の説明');await A.put(target,'個人の説明',undefined,'private');A.setView('both');a.w.document.body.innerHTML=readFileSync(new URL('../../../pages/notes.html',import.meta.url),'utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)[1];const manager=await a.load('notes_manager_v14.js');await manager.evaluate();const shared=a.w.document.querySelector('article[data-scope=shared]'),personal=a.w.document.querySelector('article[data-scope=private]');assert.equal([...shared.querySelectorAll('button')].some(b=>b.textContent==='共通メモから削除'),false);assert.ok([...personal.querySelectorAll('button')].some(b=>b.textContent==='個人メモを削除'));assert.match(shared.querySelector('a').href,/noteScope=shared/);assert.match(personal.querySelector('a').href,/noteScope=private/);
});
test('viewer defaults to shared, both scopes open independently and shared memo URL restores proper display',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();const A=await common(a);await A.put(target,'共通の本文');await A.put(target,'個人の本文',undefined,'private');A.setView('both');
 const id=A.state().notes[0].id;const b=await device(env,{idb:a.idb,url:base+'pages/No085.html?page=No085_p1&note='+id+'&noteScope=shared'});await b.R.init();const B=await common(b);B.setView('private');b.w.document.body.innerHTML='<div id="scroller"><div id="stage"></div></div>';b.w.KopuriReviewAdapter={page:()=>({key:'No085_p1',no:85,label:'No.85'})};b.w.document.getElementById('stage').getBoundingClientRect=()=>({left:0,top:0,width:1000,height:2000});b.w.document.getElementById('scroller').scrollBy=()=>{};await (await b.load('viewer_v14.js')).evaluate();assert.equal(B.state().view,'shared');assert.ok(b.w.document.querySelector('.kn-note-focus'));B.setView('both');await [...b.w.document.querySelectorAll('button')].find(x=>x.textContent==='このページのメモ（2件）').onclick();const actions=[...b.w.document.querySelectorAll('button')].filter(b=>b.textContent==='メモを見る・編集');assert.equal(actions.length,2);await actions[1].onclick();assert.equal(b.w.document.querySelector('.kn-editor textarea').value,'個人の本文');
});
test('account switch never renders another users personal memo while shared cache reloads',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();const A=await common(a);await A.put(target,'共通');await A.put(target,'非公開の内容',undefined,'private');A.setView('both');let exposed=false;const stop=a.R.subscribe(()=>{if(a.R.state().auth?.user_id==='github:2'&&A.state().allNotes.some(n=>n.scope==='private'))exposed=true});await a.R.change('auth',()=>auth(2));await a.R.init();await A.sync();stop();assert.equal(exposed,false);assert.equal(A.state().allNotes.some(n=>n.scope==='private'),false);assert.equal(A.state().notes[0].body,'共通');
});

test('new memo defaults to shared even while personal list is selected and existing private content is not auto-published',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();const A=await common(a);await A.put(target,'個人の既存内容',undefined,'private');A.setView('private');assert.equal(A.creationScope(),'shared');const editor=await a.load('note_editor_v14.js');await editor.evaluate();await editor.namespace.openEditor(target);assert.equal(a.w.document.querySelector('select[aria-label="メモの保存先"]').value,'shared');assert.equal(a.w.document.querySelector('textarea').value,'');assert.equal(env.DB.db.prepare('SELECT count(*) n FROM shared_notes').get().n,0);
});
test('existing private memo can be explicitly published and shared deletion leaves personal memo and audit intact',async()=>{
 const env=await setup();env.ADMIN_USER_IDS='github:1';const a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();const A=await common(a);await A.put(target,'残す個人の内容',undefined,'private');const editor=await a.load('note_editor_v14.js');await editor.evaluate();await editor.namespace.openEditor(target,'private',false);const select=a.w.document.querySelector('select[aria-label="メモの保存先"]');assert.equal(select.disabled,false);assert.ok([...a.w.document.querySelectorAll('button')].some(b=>b.textContent==='個人メモを削除'));
 let question='';a.confirm(s=>{question=s;return true});select.value='shared';await select.onchange();assert.match(question,/個人メモを残したまま/);assert.equal(a.w.document.querySelector('select[aria-label="メモの保存先"]').value,'shared');assert.ok([...a.w.document.querySelectorAll('button')].some(b=>b.textContent==='共通メモから削除'));
 const shared=A.state().allNotes.find(n=>n.scope==='shared'),personal=A.state().allNotes.find(n=>n.scope==='private');assert.equal(personal.deleted,0);assert.equal(personal.body,'残す個人の内容');assert.equal(shared.body,personal.body);await A.remove(target,shared.version,'shared');assert.equal(A.state().allNotes.find(n=>n.scope==='private').deleted,0);assert.equal((await A.history(shared.id)).history.length,2);assert.equal(env.DB.db.prepare('SELECT body,deleted FROM notes').get().body,'残す個人の内容');
});
test('cancelling publication leaves both server and input unchanged',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();const A=await common(a);await A.put(target,'元の個人メモ',undefined,'private');const editor=await a.load('note_editor_v14.js');await editor.evaluate();await editor.namespace.openEditor(target,'private',false);a.w.document.querySelector('textarea').value='まだ公開しない追記';a.confirm(()=>false);const select=a.w.document.querySelector('select');select.value='shared';await select.onchange();assert.equal(select.value,'private');assert.equal(a.w.document.querySelector('textarea').value,'まだ公開しない追記');assert.equal(env.DB.db.prepare('SELECT count(*) n FROM shared_notes').get().n,0);assert.equal(env.DB.db.prepare('SELECT body FROM notes').get().body,'元の個人メモ');
});
test('publishing into an existing different shared memo refuses overwrite and retains original input',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();const A=await common(a);await A.put(target,'他の人も使う内容',undefined,'shared');await A.put(target,'自分だけの内容',undefined,'private');const editor=await a.load('note_editor_v14.js');await editor.evaluate();await editor.namespace.openEditor(target,'private',false);const select=a.w.document.querySelector('select');select.value='shared';await select.onchange();assert.match(a.w.document.querySelector('.kn-editor .kr-error').textContent,/別の内容/);assert.equal(a.w.document.querySelector('textarea').value,'自分だけの内容');assert.equal(env.DB.db.prepare('SELECT body FROM shared_notes').get().body,'他の人も使う内容');assert.equal(env.DB.db.prepare('SELECT deleted FROM notes').get().deleted,0);
});
test('offline publication fails safely and can be retried after synchronization without removing personal source',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();const A=await common(a);await A.put(target,'個人の本文',undefined,'private');a.offline(true);await assert.rejects(A.copyScope(target,'公開したい本文',1,'private'),/再同期/);assert.equal(env.DB.db.prepare('SELECT count(*) n FROM shared_notes').get().n,0);assert.equal(env.DB.db.prepare('SELECT deleted FROM notes').get().deleted,0);a.offline(false);await A.sync();await A.copyScope(target,'公開したい本文',1,'private');assert.equal(env.DB.db.prepare('SELECT body FROM shared_notes').get().body,'公開したい本文');assert.equal(env.DB.db.prepare('SELECT body FROM notes').get().body,'個人の本文');
});
test('destination write failure queues publication while preserving personal source and retry logs only once',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();const A=await common(a);await A.put(target,'元の内容',undefined,'private');const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=sql=>sql.startsWith('INSERT OR IGNORE INTO shared_note_operations')?{bind(){return this},async run(){throw Error('temporary failure')}}:prepare(sql);await assert.rejects(A.copyScope(target,'公開する内容',1,'private'),/保存待ち/);assert.equal(A.state().queue.length,1);assert.equal(env.DB.db.prepare('SELECT deleted FROM notes').get().deleted,0);env.DB.prepare=prepare;await A.sync();await A.copyScope(target,'公開する内容',1,'private');assert.equal(env.DB.db.prepare('SELECT count(*) n FROM shared_note_history').get().n,1);assert.equal(env.DB.db.prepare('SELECT deleted FROM notes').get().deleted,0);
});
test('copying shared memo to personal and deleting personal do not remove shared memo',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth(2));await a.R.init();const A=await common(a);await A.put(target,'共通の内容');await A.copyScope(target,'共通の内容',1,'shared');assert.equal(A.canDelete('shared'),false);assert.equal(env.DB.db.prepare('SELECT deleted FROM shared_notes').get().deleted,0);const personal=A.state().allNotes.find(n=>n.scope==='private');await A.remove(target,personal.version,'private');assert.equal(env.DB.db.prepare('SELECT deleted FROM shared_notes').get().deleted,0);assert.equal(env.DB.db.prepare('SELECT count(*) n FROM shared_note_history').get().n,1);
});
test('shared delete button follows server role changes while editor stays open',async()=>{
 const env=await setup(),a=await device(env);await a.R.change('auth',()=>auth());await a.R.init();const A=await common(a);await A.put(target,'共通メモ');const editor=await a.load('note_editor_v14.js');await editor.evaluate();await editor.namespace.openEditor(target,'shared');const hasDelete=()=>[...a.w.document.querySelectorAll('button')].some(b=>b.textContent==='共通メモから削除');assert.equal(hasDelete(),false);env.ADMIN_USER_IDS='github:1';await A.refresh();assert.equal(hasDelete(),true);env.ADMIN_USER_IDS='github:2';await A.refresh();assert.equal(hasDelete(),false);
});
test('upgrade starts with both scopes displayed and opening a private deep link does not overwrite saved display preference',async()=>{
 const env=await setup(),a=await device(env);a.w.localStorage.setItem('kopuri-notes-view-v12','private');const m=await a.load('notes_core_v14.js');await m.evaluate();const N=m.namespace;assert.equal(N.state().view,'both');N.setView('private',false);assert.equal(N.state().view,'private');assert.equal(a.w.localStorage.getItem('kopuri-notes-view-v14'),null);N.setView('both');assert.equal(a.w.localStorage.getItem('kopuri-notes-view-v14'),'both');
});
