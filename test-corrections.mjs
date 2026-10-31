import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker,{hash,validateCorrection} from './assets/review/server/worker_v21.mjs';
const db=new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('./assets/review/server/ocr_corrections_v1.sql',import.meta.url),'utf8'));
db.exec('CREATE TABLE sessions(token_hash TEXT,user_id TEXT,login TEXT,expires INTEGER)');
const token='a'.repeat(43);db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(await hash(token),'user1','tester',Date.now()+100000);
const env={SITE_URL:'https://harahettarou.github.io/fullpuri/',DB:{prepare(sql){return {params:[],bind(...p){this.params=p;return this},async first(){return db.prepare(sql).get(...this.params)||null},async all(){return {results:db.prepare(sql).all(...this.params)}}}}}};
const target={kind:'word',page:'No001_p1',no:1,text:'エジプトはナイルの見易物',color:'black',rect:[.1,.2,.4,.03]};
const call=(method,data,authenticated=true,origin=env.SITE_URL.slice(0,-10))=>worker.fetch(new Request('https://test/ocr-corrections',{method,headers:{Origin:origin,...(authenticated?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})}),env);
const origin='https://harahettarou.github.io';
let response=await call('POST',{target,text:'エジプトはナイルの賜物',expected:0},true,origin);assert.equal(response.status,200);let saved=(await response.json()).correction;assert.equal(saved.version,1);assert.equal(saved.original,target.text);assert.ok(!('updated_by' in saved));
response=await call('POST',{target,text:'エジプトはナイルの賜物',expected:0},true,origin);assert.equal(response.status,200,'retry of same save is idempotent');
response=await call('POST',{target,text:'new',expected:0},true,origin);assert.equal(response.status,409,'stale create cannot overwrite');
response=await call('POST',{target,text:'賜物',expected:1},true,origin);assert.equal(response.status,200);assert.equal((await response.json()).correction.version,2);
response=await call('POST',{target,text:'bad overwrite',expected:1},true,origin);assert.equal(response.status,409);
response=await call('GET',null,false,origin);assert.equal(response.status,200);assert.equal((await response.json()).corrections[0].text,'賜物');
response=await call('POST',{target,text:'x',expected:2},false,origin);assert.equal(response.status,401);
response=await call('POST',{target,text:'x',expected:2},true,'https://example.com');assert.equal(response.status,403);
for(const bad of [{target:{...target,page:'No002_p1'},text:'x',expected:0},{target,text:'',expected:0},{target,text:'x',expected:-1},{target:{...target,rect:[1,0,.5,.1]},text:'x',expected:0}])assert.throws(()=>validateCorrection(bad));
assert.equal(db.prepare('SELECT count(*) AS n FROM ocr_corrections').get().n,1);
console.log('Server: persistent correction, update, conflict, retry, public read, auth, origin and input validation passed');

class Element {
 constructor(tag){this.tag=tag;this.children=[];this.style={};this.listeners={};this.value='';this.selectionStart=0;this.selectionEnd=0;this.open=false}
 append(...nodes){this.children.push(...nodes)}
 replaceChildren(...nodes){this.children=nodes}
 setAttribute(){} addEventListener(name,fn){this.listeners[name]=fn} removeEventListener(){}
 showModal(){this.open=true} close(){this.open=false;this.listeners.close?.()} remove(){} focus(){} select(){this.selectionStart=0;this.selectionEnd=this.value.length;this.listeners.select?.()}
}
const body=new Element('body');let registrations=[],corrections=[],failCorrection=false,failReview=false;
const R={state:()=>({auth:{user_id:'user1'},status:'サーバー保存済み'}),subscribe:()=>()=>{},act:async(_,t)=>{if(failReview)throw Error('review failed');registrations.push(t)}};
const C={refresh:async()=>{},find:()=>undefined,put:async(t,text,expected)=>{if(failCorrection)throw Error('save failed');corrections.push({t,text,expected});return {text,version:1}}};
const context=vm.createContext({document:{createElement:tag=>new Element(tag),body},console});
const module=new vm.SourceTextModule(readFileSync(new URL('./assets/review/word_actions_v1.js',import.meta.url),'utf8'),{context});
await module.link(spec=>{const exports=spec.includes('core_v12')?R:spec.includes('ocr_corrections')?C:{preserveNoteViewport:()=>{}};return new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v)},{context})});await module.evaluate();
const open=async()=>{await module.namespace.openWordActions(target);return body.children.at(-1)};
const nodes=n=>[n,...n.children.flatMap(nodes)];const textArea=d=>nodes(d).find(n=>n.tag==='textarea');const click=async(d,label)=>{const b=nodes(d).find(n=>n.tag==='button'&&n.textContent===label);assert.ok(b,'button '+label);await b.onclick()};
let d=await open();assert.deepEqual(nodes(d).filter(n=>n.tag==='button').map(n=>n.textContent),['保存','復習に登録','閉じる'],'editor has only three final actions');textArea(d).value='エジプトはナイルの賜物';await click(d,'保存');assert.equal(corrections.length,1);assert.equal(registrations.length,0);assert.equal(d.open,false);
d=await open();textArea(d).value='ナイルの賜物';await click(d,'復習に登録');assert.equal(corrections.length,2);assert.equal(registrations.length,1);assert.equal(registrations.at(-1).text,'ナイルの賜物');assert.equal(d.open,false);
d=await open();textArea(d).value='ナイルの賜物';textArea(d).selectionStart=4;textArea(d).selectionEnd=6;await click(d,'復習に登録');assert.equal(corrections.at(-1).text,'ナイルの賜物','full correction saved');assert.equal(registrations.at(-1).text,'賜物','selected review word');assert.equal(d.open,false);
const counts=[corrections.length,registrations.length];d=await open();await click(d,'閉じる');assert.deepEqual([corrections.length,registrations.length],counts,'close saves nothing');
failCorrection=true;d=await open();await click(d,'復習に登録');assert.equal(registrations.length,counts[1]);assert.equal(d.open,true);failCorrection=false;
failReview=true;d=await open();await click(d,'復習に登録');assert.equal(d.open,true);const correctionCount=corrections.length;failReview=false;await click(d,'復習に登録');assert.equal(corrections.length,correctionCount,'partial save retries without duplicate correction');assert.equal(d.open,false);
console.log('Editor: direct entry, three buttons, save only, save and review, selected word, close and failure retries passed');

const menu=new Element('dialog');let openedCorrection=0,openedNote=0;
const menuContext=vm.createContext({menu,R,N:{state:()=>({notes:[]}),creationScope:()=> 'shared'},entryFor:()=>undefined,noteFor:()=>undefined,live:()=>true,colors:{black:'黒'},el:(tag,cls,text)=>{const e=new Element(tag);e.className=cls;e.textContent=text;return e},button:(label,fn)=>{const b=new Element('button');b.textContent=label;b.onclick=fn;return b},openWordActions:async()=>{openedCorrection++},openEditor:async()=>{openedNote++},fillAccount:()=>{}});
const viewer=readFileSync(new URL('./assets/review/viewer_v28.js',import.meta.url),'utf8');
vm.runInContext(viewer.slice(viewer.indexOf('async function openTarget('),viewer.indexOf('function allTargets(')),menuContext);
await menuContext.openTarget(target);assert.deepEqual(nodes(menu).filter(n=>n.tag==='button').map(n=>n.textContent),['閉じる','文字を修正','復習に登録','メモを記入']);await click(menu,'文字を修正');assert.equal(openedCorrection,1);assert.equal(menu.open,false);
await menuContext.openTarget(target);const reviews=registrations.length;await click(menu,'復習に登録');assert.equal(registrations.length,reviews+1);assert.equal(menu.open,false);
await menuContext.openTarget(target);await click(menu,'メモを記入');assert.equal(openedNote,1);assert.equal(menu.open,false);
assert.ok(viewer.includes("await openTarget({...baseTarget('word')"),'long press opens the same initial menu');
console.log('Initial menu: correction goes directly to editor; original review and memo handlers preserved');
