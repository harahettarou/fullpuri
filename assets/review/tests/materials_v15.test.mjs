import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{hash,targetId,validateTarget} from '../server/worker_v15.mjs';
import {target,rectBetween,snapshot,visible,materialLink,documentLabel} from '../../materials/model_v15.js';
class D1{
 constructor(){this.db=new DatabaseSync(':memory:');for(const f of ['0001_review_v1','0002_notes_v3','0003_google_v8','0004_shared_notes_v12','0005_materials_v15'])this.db.exec(readFileSync(new URL('../server/migrations/'+f+'.sql',import.meta.url),'utf8'))}
 prepare(sql){const s=this.db.prepare(sql);let args=[];return {bind(...a){args=a;return this},async first(){return s.get(...args)||null},async all(){return {results:s.all(...args)}},async run(){return s.run(...args)}}}async batch(ss){return Promise.all(ss.map(s=>s.run()))}
}
const hex=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
class R2{
 objects=new Map();async put(key,body,options){const bytes=new Uint8Array(await new Response(body).arrayBuffer());assert.equal(await hex(bytes),options.sha256,'R2 enforces checksum before commit');this.objects.set(key,bytes);return {size:bytes.length}}async head(key){return this.objects.has(key)?{size:this.objects.get(key).length}:null}async get(key){const b=this.objects.get(key);return b?{size:b.length,body:new Blob([b]).stream()}:null}
}
const origin='https://harahettarou.github.io',id='1234567890abcdef1234567890abcdef';
async function setup(){
 const env={DB:new D1(),MATERIALS_BUCKET:new R2(),SITE_URL:origin+'/fullpuri/',GITHUB_CLIENT_ID:'x',GITHUB_CLIENT_SECRET:'x',ADMIN_USER_IDS:'github:1'},tokens=['a'.repeat(43),'b'.repeat(43),'c'.repeat(43)];for(const [i,t]of tokens.entries())await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hash(t),'github:'+(i+1),'user'+i,Date.now()+100000).run();
 const request=async(path,body=null,who=0,method=body?'POST':'GET',extra={})=>{const response=await worker.fetch(new Request('https://api.example'+path,{method,headers:{Origin:origin,Authorization:'Bearer '+tokens[who],'Content-Type':'application/json',...extra},...(body!==null?{body:body instanceof Uint8Array?body:JSON.stringify(body)}:{})}),env);return {status:response.status,data:response.headers.get('content-type')?.includes('application/json')?await response.json():new Uint8Array(await response.arrayBuffer())}};
 const pdf=new TextEncoder().encode('%PDF-1.7\noriginal bytes\n%%EOF'),sha=await hex(pdf),base={id,title:'英語 文法',subject:'英語',folder:'1学期',file_size:pdf.length,page_count:2,sha256:sha};let seq=1;
 const create=()=>request('/materials',base),upload=(bytes=pdf,who=0)=>request(`/materials/${id}/pdf`,bytes,who,'PUT',{'content-length':String(bytes.length),'x-file-sha256':sha});
 const op=(action,expected,data)=>({op_id:String(seq++).padStart(43,'x'),action,expected,...(data?{data}:{})});const operate=(action,expected,data)=>request(`/materials/${id}/operations`,op(action,expected,data));
 const draft={title:base.title,subject:base.subject,folder:base.folder,annotations:[]};
 return {env,request,pdf,base,create,upload,operate,op,draft};
}
test('only configured authenticated admin can create, upload, edit, publish and archive',async()=>{
 const s=await setup();assert.equal((await s.request('/materials',s.base,1)).status,403);await s.create();assert.equal((await s.upload(s.pdf,1)).status,404);await s.upload();await s.operate('publish',1);
 for(const action of ['save','publish','unpublish','archive','restore'])assert.equal((await s.request(`/materials/${id}/operations`,{...s.op(action,2,s.draft),is_admin:true,user_id:'github:1'},1)).status,403);
 assert.equal((await s.request(`/materials/${id}/pdf`,s.pdf,1,'PUT',{'content-length':String(s.pdf.length),'x-file-sha256':s.base.sha256})).status,403);
});
test('draft/PDF/history invisible to another user until explicit publish; edit query cannot bypass ACL',async()=>{
 const s=await setup();await s.create();await s.upload();assert.equal((await s.request('/materials',null,1)).data.materials.length,0);for(const suffix of ['','?edit=1','/pdf','/history'])assert.equal((await s.request(`/materials/${id}`+suffix,null,1)).status,404);await s.operate('publish',1);const shown=await s.request(`/materials/${id}?edit=1`,null,1);assert.equal(shown.status,200);assert.equal(shown.data.material.title,s.draft.title);assert.equal(shown.data.material.draft,undefined);assert.equal(shown.data.material.is_admin,false);assert.equal((await s.request(`/materials/${id}/history`,null,1)).status,403);
});
test('PDF stored and served byte-for-byte, upload/retry immutable; publish requires original',async()=>{
 const s=await setup();await s.create();assert.equal((await s.operate('publish',1)).status,409);assert.equal((await s.upload()).status,200);assert.deepEqual(s.env.MATERIALS_BUCKET.objects.get('materials/'+id+'.pdf'),s.pdf);assert.equal((await s.upload()).status,200);await s.operate('publish',1);assert.deepEqual((await s.request(`/materials/${id}/pdf`,null,1)).data,s.pdf);assert.equal((await s.request('/materials',{...s.base,sha256:'e'.repeat(64)})).status,409);
});
test('draft edits never modify published snapshot until a new explicit publish',async()=>{
 const s=await setup();await s.create();await s.upload();await s.operate('publish',1);const draft={...s.draft,title:'下書きの秘密',annotations:[{id:'orange1',page:2,kind:'text',rect:[.2,.3,.4,.1],text:'答え',color:'orange',font_size:16}]};assert.equal((await s.operate('save',2,draft)).status,200);assert.equal((await s.request(`/materials/${id}`,null,1)).data.material.title,s.draft.title);assert.equal((await s.request('/materials',null,1)).data.materials[0].title,s.draft.title);assert.equal((await s.request(`/materials/${id}?edit=1`)).data.material.title,draft.title);await s.operate('publish',3);const current=(await s.request(`/materials/${id}`,null,1)).data.material;assert.equal(current.title,draft.title);assert.equal(current.annotations[0].text,'答え');
});
test('optimistic concurrent saves, exact idempotent replay and operation ID misuse',async()=>{
 const s=await setup();await s.create();await s.upload();const op=s.op('save',1,{...s.draft,title:'保存1'}),path=`/materials/${id}/operations`;assert.equal((await s.request(path,op)).data.material.version,2);assert.equal((await s.request(path,op)).data.material.version,2);assert.equal((await s.request(path,{...op,data:{...s.draft,title:'不正な再送'}})).status,400);assert.equal((await s.operate('save',1,{...s.draft,title:'古い版'})).status,409);assert.equal((await s.request(`/materials/${id}/history`)).data.history.length,1);assert.equal((await s.request(`/materials/${id}?edit=1`)).data.material.title,'保存1');
});
test('unpublish/archive hide originals and notes while preserving history; restore explicit',async()=>{
 const s=await setup();await s.create();await s.upload();await s.operate('publish',1);await s.operate('archive',2);assert.equal((await s.request(`/materials/${id}`,null,1)).status,404);assert.equal((await s.request(`/materials/${id}/pdf`,null,1)).status,404);assert.equal((await s.operate('save',3,s.draft)).status,409);await s.operate('restore',3);assert.equal((await s.request(`/materials/${id}`,null,1)).status,200);await s.operate('unpublish',4);assert.equal((await s.request(`/materials/${id}`,null,1)).status,404);assert.deepEqual((await s.request(`/materials/${id}/history`)).data.history.map(x=>x.action),['unpublish','restore','archive','publish']);assert.equal(s.env.MATERIALS_BUCKET.objects.size,1);
});
test('invalid metadata, excessive sizes, malformed annotations and out-of-bounds rectangles rejected',async()=>{
 const s=await setup();for(const extra of [{file_size:51*1024*1024},{page_count:1001},{sha256:'bad'},{subject:''}])assert.equal((await s.request('/materials',{...s.base,...extra})).status,400);await s.create();
 const a={id:'a',kind:'text',page:1,rect:[.1,.1,.2,.1],text:'語句',color:'orange',font_size:14};for(const extra of [{page:3},{rect:[.9,.1,.2,.1]},{font_size:0},{color:'blue'},{text:''}])assert.equal((await s.operate('save',1,{...s.draft,annotations:[{...a,...extra}]})).status,400);assert.equal((await s.operate('save',1,{...s.draft,annotations:[a,a]})).status,400);assert.equal((await s.operate('save',1,{...s.draft,annotations:[a,{id:'b',kind:'green-mask',page:2,rect:[.1,.1,.2,.1]}]})).status,200);
});
test('upload rejects non-PDF, wrong length or checksum without marking ready',async()=>{
 const s=await setup();await s.create();assert.equal((await s.upload(new TextEncoder().encode('hello world'))).status,400);assert.equal((await s.request(`/materials/${id}/pdf`,s.pdf,0,'PUT',{'content-length':'5','x-file-sha256':s.base.sha256})).status,400);const corrupted=s.pdf.slice();corrupted[8]=65;assert.equal((await s.upload(corrupted)).status,500);assert.equal((await s.request(`/materials/${id}?edit=1`)).data.material.uploaded,false);
});
test('material review, private/shared notes, sync, completion and history reuse authenticated storage',async()=>{
 const s=await setup();await s.create();await s.upload();await s.operate('publish',1);const t=target({...s.base},2,'word',[.2,.2,.3,.1],'答え','orange'),eid=await targetId(t);let seq=20;const op=(action,expected,body='')=>({op_id:String(seq++).padStart(43,'o'),id:eid,target:t,action,expected,body});
 assert.equal((await s.request('/operations',op('register',0),1)).status,200);assert.equal((await s.request('/entries',null,2)).data.entries.length,0);assert.equal((await s.request('/entries',null,1)).data.entries[0].target.material.page,2);assert.equal((await s.request('/operations',op('complete',1),1)).data.entry.review_count,1);assert.equal((await s.request('/history?id='+eid,null,1)).data.history.length,2);
 assert.equal((await s.request('/note-operations',op('put',0,'個人'),1)).status,200);assert.equal((await s.request('/notes',null,2)).data.notes.length,0);assert.equal((await s.request('/shared-note-operations',op('put',0,'共通'),1)).status,200);assert.equal((await s.request('/shared-notes',null,2)).data.notes[0].body,'共通');
 await s.operate('unpublish',2);const hidden=(await s.request('/shared-notes',null,2)).data.notes[0];assert.equal(hidden.deleted,1);assert.equal(hidden.body,'');assert.equal(hidden.target.material.title,'非公開の教材');assert.equal((await s.request('/shared-note-history?id='+eid,null,2)).status,404);assert.equal((await s.request('/shared-note-operations',op('put',1,'侵入'),2)).status,404);
 // Owner can still remove private records even after archive, without leaking an original.
 assert.equal((await s.request('/note-operations',op('delete',1),1)).status,200);assert.equal((await s.request('/operations',op('delete',2),1)).status,200);
 await s.operate('publish',3);assert.equal((await s.request('/shared-notes',null,2)).data.notes[0].body,'共通');assert.equal((await s.request('/shared-notes',null,2)).data.notes[0].deleted,0);
});
test('material identity cannot bypass ACL by dropping or forging metadata',async()=>{
 const s=await setup();await s.create();const t=target(s.base,1,'range',[.1,.1,.2,.2]),eid=await targetId(t),op={op_id:'z'.repeat(43),id:eid,action:'put',expected:0,body:'メモ',target:t};assert.equal((await s.request('/shared-note-operations',op,1)).status,404);const missing={...t};delete missing.material;assert.throws(()=>validateTarget(missing));assert.throws(()=>validateTarget({...t,material:{...t.material,page:2}}));const tooMany=target(s.base,3);assert.equal((await s.request('/operations',{...op,action:'register',target:tooMany,id:await targetId(tooMany)})).status,400);
});
test('geometry, visibility, stable IDs and deep links remain independent of zoom and color switches',async()=>{
 const m={id,title:'数学',subject:'数学',folder:'',annotations:[]},a=target(m,1,'word',[.1,.2,.3,.04],'説明','orange');assert.deepEqual(rectBetween([.7,.8],[.1,.2]),[.1,.2,.6,.6]);assert.equal(await targetId(a),await targetId({...a,text:'文言の修正'}));assert.notEqual(await targetId(a),await targetId(target({...m,id:'f'.repeat(32)},1,'word',a.rect,a.text,a.color)));assert.equal(visible({kind:'text',color:'orange'},{orange:false}),false);assert.equal(visible({kind:'text',color:'orange'},{orange:false},true),true);assert.match(documentLabel(a),/数学.*1ページ/);assert.equal(new URL(materialLink(a,{note:'abc'})).searchParams.get('note'),'abc');assert.deepEqual(snapshot(m),{title:'数学',subject:'数学',folder:'',annotations:[]});
});
test('missing R2 reports setup state; bad origin and invalid sessions fail closed',async()=>{
 const s=await setup();delete s.env.MATERIALS_BUCKET;assert.equal((await s.request('/materials/config')).data.enabled,false);assert.equal((await s.request('/materials')).status,503);const bad=await worker.fetch(new Request('https://api.example/materials',{headers:{Origin:'https://evil.example',Authorization:'Bearer '+'a'.repeat(43)}}),s.env);assert.equal(bad.status,403);const anonymous=await worker.fetch(new Request('https://api.example/materials',{headers:{Origin:origin}}),s.env);assert.equal(anonymous.status,401);
});
