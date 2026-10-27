import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';import worker,{hash} from '../server/worker_v20.mjs';import {emptyData,applyNative,redRegions,valid} from '../../classic/model_v19.js';
const catalog=JSON.parse(readFileSync(new URL('../../classic/catalog_v18.json',import.meta.url))),root=new URL('../../../',import.meta.url),sourceFile=key=>JSON.parse(readFileSync(new URL(catalog[key].href,root),'utf8').match(/const PAGES\s*=\s*(\[.*?\]);/s)[1]),pages=sourceFile('No007_p1'),page=pages.find(p=>p.key==='No007_p1');
// Trusted published GitHub source fixture; no external network or production writes.
const nativeFetch=globalThis.fetch;
const synthetic=structuredClone(sourceFile('No169_p3'));synthetic.push({...structuredClone(synthetic.find(p=>p.key==='No169_p3')),key:'No169_p4',part:4,parts:4,label:'No.169（4/4）'});
globalThis.fetch=async input=>{const url=new URL(String(input)),file=decodeURIComponent(url.pathname).replace('/fullpuri/','');if(url.origin!=='https://harahettarou.github.io')throw Error('unexpected source');return new Response(file===catalog.No169_p3.href?'const PAGES='+JSON.stringify(synthetic)+';':readFileSync(new URL(file,root),'utf8'),{status:200})};
class D1{constructor(){this.db=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../server/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())this.db.exec(readFileSync(new URL('../server/migrations/'+f,import.meta.url),'utf8'))}prepare(sql){const s=this.db.prepare(sql);let a=[];return{bind(...v){a=v;return this},async first(){return s.get(...a)||null},async all(){return{results:s.all(...a)}},async run(){return s.run(...a)}}}}
async function setup(){const env={DB:new D1(),SITE_URL:'https://harahettarou.github.io/fullpuri/',GITHUB_CLIENT_ID:'x',GITHUB_CLIENT_SECRET:'x',ADMIN_USER_IDS:'github:1'};for(const [token,uid]of [['a','github:1'],['b','github:2']])await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hash(token.repeat(43)),uid,uid,Date.now()+100000).run();return{env,async req(key,b=null,who='a'){const r=await worker.fetch(new Request('https://api.example/classic-edits/'+key,{method:b?'POST':'GET',headers:{Origin:'https://harahettarou.github.io','Content-Type':'application/json',...(who?{Authorization:'Bearer '+who.repeat(43)}:{})},...(b?{body:JSON.stringify(b)}:{})}),env);return{status:r.status,data:await r.json()}}}}
const op=(data,expected=0)=>({op_id:crypto.randomUUID().replaceAll('-','').padEnd(43,'x'),expected,action:'save',data});

for(const key of ['No168_p3','No169_p3'])test(key+': public unit retrieval, admin edit, green save and publish',async()=>{
 const {req}=await setup(),ps=sourceFile(key),p=ps.find(p=>p.key===key),d=emptyData(p,ps);
 const unit=await req('_unit?pages='+ps.map(p=>p.key).join(','),null,null);assert.equal(unit.status,200,JSON.stringify(unit.data));assert.deepEqual(unit.data.pages,[]);
 assert.equal((await req(key+'?edit=1')).status,200);
 assert.equal((await req(key+'?edit=1',null,'b')).status,403);
 d.annotations=[{id:'green_new',page:1,kind:'green-mask',rect:[.1,.2,.25,.03],color:'#58cf68'}];
 const saved=await req(key+'/operations',op(d));assert.equal(saved.status,200,JSON.stringify(saved.data));assert.deepEqual(saved.data.draft,d);
 const published=await req(key+'/operations',{op_id:'p'.repeat(43),expected:1,action:'publish'});assert.equal(published.status,200,JSON.stringify(published.data));
 const read=await req(key,null,null);assert.equal(read.status,200);assert.deepEqual(read.data.data,d);
 const refreshed=await req('_unit?pages='+ps.map(p=>p.key).join(','),null,null);assert.deepEqual(refreshed.data.pages,[{page_key:key,data:d}]);
 const pair={id:'pair_new',enabled:true,text:'答え',font_size:34,body_rect:[.1,.4,.2,.03],answer_page:key.replace('_p3','_p2'),answer_rect:[.2,.5,.2,.04]};d.pairs=[pair];assert.equal((await req(key+'/operations',op(d,2))).status,200);
});
test('unknown page keys remain rejected',async()=>{const {req}=await setup();assert.equal((await req('_unit?pages=No999_p1')).status,400);assert.equal((await req('No999_p1?edit=1')).status,404)});

test('a page added only to GitHub HTML can be read, edited and saved without Worker registration',async()=>{
 const {req}=await setup(),p=synthetic.find(p=>p.key==='No169_p4'),d=emptyData(p,synthetic);
 assert.equal((await req('_unit?pages=No169_p3,No169_p4',null,null)).status,200);
 assert.equal((await req('No169_p4?edit=1')).status,200);
 d.annotations=[{id:'future_green',page:1,kind:'green-mask',rect:[.1,.2,.2,.03]}];
 const result=await req('No169_p4/operations',op(d));assert.equal(result.status,200,JSON.stringify(result.data));assert.deepEqual(result.data.draft,d);
 const obsolete=structuredClone(d);obsolete.fingerprint='00000000';assert.equal((await req('No169_p4/operations',op(obsolete,1))).status,409);
 const otherUnit=structuredClone(d);otherUnit.pairs=[{id:'bad',enabled:true,text:'x',font_size:34,body_rect:[.1,.1,.1,.1],answer_page:'No168_p3',answer_rect:[.1,.1,.1,.1]}];assert.equal((await req('No169_p4/operations',op(otherUnit,1))).status,400);
});

test('the browser recognizes a future HTML-only page without the static catalog',async()=>{
 const {canonicalPageIndex}=await import('../../classic/catalog_from_html_v20.js');const p=synthetic.find(p=>p.key==='No169_p4');
 const index=await canonicalPageIndex(p,'https://harahettarou.github.io/fullpuri/');assert.equal(index[p.key].fingerprint,emptyData(p,synthetic).fingerprint);assert.equal(index[p.key].href,catalog.No169_p3.href);
});
