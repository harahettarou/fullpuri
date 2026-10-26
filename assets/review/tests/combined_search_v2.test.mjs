import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(process.env.KOPURI_TEST_MODULES?path.join(process.env.KOPURI_TEST_MODULES,'package.json'):import.meta.url);
const {Window}=require('happy-dom'),{IDBFactory}=require('fake-indexeddb');
const site=new URL('../../../',import.meta.url),base='https://example.test/';
async function setup({ocrFails=false,notesFail=false,delayIndex=false}={}){
 const w=new Window({url:base+'pages/search.html?q=世界史'});
 w.document.write(readFileSync(new URL('pages/search.html',site),'utf8'));
 const target={no:85,page:'No085_p1',kind:'range',rect:[.1,.1,.2,.2],text:'',color:'black'};
 let privateBody='世界史の個人 <img src=x onerror=alert(1)>',version=1;
 const index=JSON.stringify({pages:[{key:'No085_p1',no:85,label:'No.85',unit:'世界史',href:'print.html',width:100,height:100,lines:[{t:'世界史の原文',n:'世界史の原文',x:1,y:2,w:10,h:10}]},{key:'No086_p1',no:86,label:'No.86',unit:'世界史',href:'print.html',width:100,height:100,lines:[]}]});
 const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(index))).toString('hex');
 let release;const gate=new Promise(r=>{release=r});
 const fetcher=async(input)=>{
  const u=new URL(String(input),w.location.href);let data;
  if(u.hostname==='fullpuri-review.niwatorikounotori.workers.dev'){
   if(notesFail&&['/notes','/shared-notes'].includes(u.pathname))throw Error('offline');
   data=({'/auth/providers':{google:true,github:true},'/me':{user_id:'test-user',account:{google_linked:true}},'/entries':{entries:[]},'/notes':{notes:[{id:'p',target,body:privateBody,deleted:0,version}]},'/shared-notes':{notes:[{id:'s',target,body:'世界史の共通',deleted:0,version:1},{id:'d',target,body:'世界史の削除済み',deleted:1,version:2}]}})[u.pathname]||{};
  }else if(u.pathname.endsWith('/ocr-index.json')){if(delayIndex)await gate;if(ocrFails)return new Response('',{status:503});return new Response(index)}
  else if(u.pathname.endsWith('/orange-search-index.json'))data={version:1,source_sha256:hash,rows:[{page_key:'No086_p1',href:'print.html',id:'orange1',text:'世界史のオレンジ',box:[1,2,10,10]}]};
  else data=JSON.parse(readFileSync(new URL(u.pathname.slice(1),site),'utf8'));
  return new Response(JSON.stringify(data));
 };
 const context=vm.createContext({window:w,document:w.document,location:w.location,navigator:w.navigator,sessionStorage:w.sessionStorage,localStorage:w.localStorage,indexedDB:new IDBFactory(),crypto,structuredClone,TextEncoder,TextDecoder,URL,URLSearchParams,AbortSignal,EventTarget:w.EventTarget,Event:w.Event,btoa,fetch:fetcher,console,setTimeout,clearTimeout,setInterval:()=>0});
 const modules=new Map();
 function make(file){if(modules.has(file))return modules.get(file);const m=new vm.SourceTextModule(readFileSync(new URL(file.slice(1),site),'utf8'),{context,identifier:file.slice(1),initializeImportMeta(meta){meta.url=base+file.slice(1)}});modules.set(file,m);return m;}
 vm.runInContext(readFileSync(new URL('assets/search/search-app_v78.js',site),'utf8'),context);
 const main=make('/assets/search/memo-search_v2.js');await main.link((spec,ref)=>make(new URL(spec,base+ref.identifier).pathname));await main.evaluate();
 const R=modules.get('/assets/review/core_v12.js').namespace,N=modules.get('/assets/review/notes_core_v14.js').namespace;
 async function login(){await R.change('auth',()=>({user_id:'test-user',login:'test',token:'test-token'}));await R.init();await N.init()}
 const settle=()=>new Promise(r=>setTimeout(r,220));
 const cards=()=>[...w.document.querySelectorAll('#results .result')];
 async function query(q){w.document.getElementById('q').value=q;w.document.getElementById('q').dispatchEvent(new w.Event('input'));await settle()}
 return {w,R,N,cards,login,settle,query,release,edit:()=>{privateBody='世界史の変更後';version++}};
}
test('OCR, orange, shared and private notes always search together without selectors',async()=>{
 const s=await setup();await s.settle();assert.equal(s.cards().length,2);await s.login();await s.settle();
 assert.equal(s.w.document.querySelectorAll('select').length,0);assert.equal(s.cards().length,4);
 assert.ok(s.cards().some(n=>n.textContent.includes('原文')));assert.ok(s.cards().some(n=>n.textContent.includes('オレンジ')));
 assert.equal(s.w.document.querySelectorAll('#results img').length,0);
 for(const scope of ['shared','private','both']){s.N.setView(scope);assert.equal(s.cards().length,4)}
 const memoCards=()=>s.cards().filter(n=>n.classList.contains('memo-result'));
 assert.ok(memoCards().some(n=>n.href.includes('noteScope=private')));assert.ok(memoCards().some(n=>n.href.includes('noteScope=shared')));
 await s.query('個人');assert.equal(s.cards().length,1);assert.ok(s.cards()[0].textContent.includes('個人メモ'));
 await s.query('世界史');s.edit();await s.N.sync();assert.ok(s.cards().some(n=>n.textContent.includes('変更後')));
 await s.R.logout();assert.equal(memoCards().length,0);assert.equal(s.cards().length,2);
});
test('OCR load failure does not stop shared or private memo results',async()=>{
 const s=await setup({ocrFails:true});await s.login();await s.settle();assert.equal(s.cards().length,2);assert.match(s.w.document.getElementById('status').textContent,/OCRデータを読み込めません/);
});
test('memo sync failure does not stop original OCR and orange results',async()=>{
 const s=await setup({notesFail:true});await s.login();await s.settle();assert.equal(s.cards().length,2);assert.match(s.w.document.getElementById('memo-status').textContent,/失敗/);
});
test('late OCR loading never resets the query typed by the user',async()=>{
 const s=await setup({delayIndex:true});await s.login();await s.query('個人');s.release();await s.settle();assert.equal(s.w.document.getElementById('q').value,'個人');assert.equal(s.cards().length,1);
});
