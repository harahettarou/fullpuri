import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {Window} from 'happy-dom';
const root=new URL('../../../',import.meta.url);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(version=26){
 const w=new Window({url:'https://test.invalid/pages/test.html'});w.document.body.innerHTML='<div id="stage"></div><div class="nav"></div><div id="scroller"></div>';
 const stage=w.document.getElementById('stage');let width=800,fetches=0,accounts=0;const observers=[];
 stage.getBoundingClientRect=()=>({left:0,top:0,width,height:width*1.4});
 let page={key:'No085_p1',no:85,label:'test'},notes=[],entries=[];const callbacks=[];
 const target={kind:'word',no:85,page:'No085_p1',color:'red',text:'test',rect:[.2,.2,.1,.03]};
 const R={rootURL:new URL('https://test.invalid/'),state:()=>({entries,queue:[],status:'ready',account:{}}),subscribe:f=>callbacks.push(f),init:async()=>{},formatDate:()=>''};
 const N={state:()=>({notes,allNotes:notes,queue:[],view:'shared',status:'ready'}),subscribe:f=>callbacks.push(f),init:async()=>{},creationScope:()=> 'shared'};
 w.KopuriReviewAdapter={page:()=>page};
 const context=vm.createContext({window:w,document:w.document,location:w.location,localStorage:w.localStorage,URL,URLSearchParams,Event:w.Event,EventTarget:w.EventTarget,console,setTimeout,clearTimeout,requestAnimationFrame:f=>setTimeout(f,0),matchMedia:()=>({matches:false}),ResizeObserver:class{constructor(fn){this.fn=fn}observe(n){observers.push({n,fn:this.fn})}},fetch:async()=>{fetches++;return {ok:true,json:async()=>[1,2].map(i=>({key:'No085_p'+i,targets:[target],lines:[]}))}}});
 const modules=new Map();function mock(id,values){return new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v)},{context,identifier:id})}
 const source=readFileSync(new URL(`../${version===26?'viewer_v26.js':`viewer_v${version}_perf_v26.js`}`,import.meta.url),'utf8');
 const main=new vm.SourceTextModule(source,{context});
 await main.link(spec=>{if(modules.has(spec))return modules.get(spec);let m;if(spec==='./layout_v26.js')m=new vm.SourceTextModule(readFileSync(new URL('../layout_v26.js',import.meta.url),'utf8'),{context});else if(spec.includes('notes_core'))m=mock(spec,N);else if(spec.includes('core_v12'))m=mock(spec,R);else if(spec.includes('account_controls'))m=mock(spec,{fillAccount:()=>accounts++});else if(spec.includes('sequence'))m=mock(spec,{initSequence:async()=>{},startReview:()=>{}});else if(spec.includes('note_editor'))m=mock(spec,{openEditor:()=>{}});else m=mock(spec,{initClassicEditor:async()=>{}});modules.set(spec,m);return m});
 await main.evaluate();
 return {w,stage,target,stats:()=>({fetches,accounts}),emit:()=>callbacks.forEach(f=>f()),notes:value=>notes=value,resize(value){width=value;observers.find(o=>o.n===stage).fn([{contentRect:{width,height:width*1.4}}])},async page(i){page={...page,key:'No085_p'+i};w.document.dispatchEvent(new w.Event('kopuri:page'));await sleep(5)},mode(value){const s=w.document.querySelector('[aria-label="チェックボタンの表示方式"]');s.value=value;s.onchange()},close:()=>w.happyDOM.abort()};
}
for(const version of [14,18,26])test(`v${version}: resize preserves note anchors and settings; final direct placement coalesces`,async()=>{
 const d=await setup(version);d.notes([{id:'note',target:d.target,scope:'shared',body:'saved',version:1}]);d.emit();const outline=d.w.document.querySelector('.kn-note-outline');assert.equal(outline.style.left,'20%');
 const settings=d.w.document.querySelector('.kr-action-groups').firstChild,accountCount=d.stats().accounts;
 for(let i=0;i<60;i++)d.resize(800+i*10);
 assert.equal(d.w.document.querySelector('.kn-note-outline'),outline);assert.equal(d.stats().accounts,accountCount);
 await sleep(160);assert.equal(d.w.document.querySelector('.kr-action-groups').firstChild,settings);assert.equal(d.w.document.querySelector('.kn-note-outline').style.left,'20%');
 d.mode('hidden');assert.equal(d.w.document.querySelectorAll('.kn-note-outline,.kr-mark').length,0);
 d.mode('direct');assert.ok(d.w.document.querySelector('.kr-mark').style.left.endsWith('%'));await d.page(2);await d.page(1);assert.equal(d.stats().fetches,1);await d.close();
});
test('resize without visible notes does not replace the layer',async()=>{const d=await setup();const layer=d.w.document.querySelector('.kr-layer');d.resize(1600);await sleep(160);assert.equal(d.w.document.querySelector('.kr-layer'),layer);await d.close()});
test('target cache deduplicates, evicts least-recent entries, and retries failures',async()=>{
 let calls=0,fail=false;const context=vm.createContext({URL,fetch:async()=>{calls++;return {ok:!fail,json:async()=>[calls]}}});
 const m=new vm.SourceTextModule(readFileSync(new URL('../layout_v26.js',import.meta.url),'utf8'),{context});await m.link(()=>{});await m.evaluate();
 const get=m.namespace.targetCache('https://test.invalid/',2);const first=get(1);assert.equal(get(1),first);await first;await get(2);await get(1);await get(3);await get(2);assert.equal(calls,4);
 fail=true;await assert.rejects(get(4));fail=false;await get(4);assert.equal(calls,6);
});
test('all embedded original page data and inline scripts are preserved/parseable',()=>{
 const files=execFileSync('git',['ls-files','-z','pages'],{cwd:root}).toString().split('\0').filter(f=>f.endsWith('.html'));
 let count=0;for(const file of files){const current=readFileSync(new URL(file,root),'utf8');if(!current.includes('function applyZoom(options={})'))continue;const previous=execFileSync('git',['show','53d74216bddc6348869350e38ce01d2fd7d0a830:'+file],{cwd:root,maxBuffer:20e6}).toString();const data=s=>s.match(/const PAGES\s*=\s*(\[.*?\]);/s)?.[1];assert.equal(data(current),data(previous),file);for(const m of current.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){if(!m[1].trim())continue;new vm.Script(m[1],{filename:file})}count++}assert.equal(count,48);
});
