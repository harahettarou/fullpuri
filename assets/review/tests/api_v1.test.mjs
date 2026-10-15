import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{hash,targetId,validateTarget} from '../server/worker_v1.mjs';
// D1 statement interface backed by real SQLite, including actual production SQL triggers.
class D1{
 constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(readFileSync(new URL('../server/migrations/0001_review_v1.sql',import.meta.url),'utf8'))}
 prepare(sql){const s=this.db.prepare(sql);let args=[];return {bind(...a){args=a;return this},async first(){return s.get(...args)||null},async all(){return {results:s.all(...args)}},async run(){return s.run(...args)}}}
 async batch(ss){return Promise.all(ss.map(s=>s.run()))}
}
const origin='https://harahettarou.github.io';
const base='https://review.example';
async function setup(){
 const DB=new D1(),env={DB,SITE_URL:origin+'/fullpuri/',GITHUB_CLIENT_ID:'test',GITHUB_CLIENT_SECRET:'test'};
 const ta='a'.repeat(43),tb='b'.repeat(43);
 for(const [token,user]of [[ta,'github:1'],[tb,'github:2']])await DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hash(token),user,user,Date.now()+100000).run();
 let seq=1;
 const request=async(path,body,token=ta,from=origin)=>{
  const req=new Request(base+path,{method:body?'POST':'GET',headers:{Origin:from,Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const response=await worker.fetch(req,env);return {status:response.status,data:await response.json()};
 };
 const t=validateTarget({kind:'word',no:85,page:'No085_p1',text:'ルネサンス',color:'red',rect:[.1,.2,.1,.03]}),id=await targetId(t);
 const op=(action,expected,extra={})=>({op_id:String(seq++).padStart(43,'x'),id,action,expected,target:t,...extra});
 return {DB,env,request,op,t,id,ta,tb};
}
test('register → synchronize → complete → reopen → complete retains exact server history',async()=>{
 const {request,op,id}=await setup();
 const registered=await request('/operations',op('register',0));assert.equal(registered.status,200);assert.equal(registered.data.entry.version,1);assert.ok(registered.data.entry.created_at);
 // A separate device uses only the same authenticated API, not shared local state.
 const device2=await request('/entries');assert.equal(device2.data.entries[0].id,id);
 const complete=await request('/operations',op('complete',1));assert.equal(complete.data.entry.review_count,1);assert.equal(complete.data.entry.state,'done');assert.ok(complete.data.entry.completed_at);assert.equal(complete.data.entry.completed_at,complete.data.entry.last_reviewed_at);
 const reopened=await request('/operations',op('reopen',2));assert.equal(reopened.data.entry.state,'todo');assert.equal(reopened.data.entry.review_count,1);assert.equal(reopened.data.entry.completed_at,null);assert.equal(reopened.data.entry.last_reviewed_at,complete.data.entry.last_reviewed_at);
 const twice=await request('/operations',op('complete',3));assert.equal(twice.data.entry.review_count,2);
 const h=await request('/history?id='+id);assert.deepEqual(h.data.history.map(h=>h.action),['register','complete','reopen','complete']);
 assert.equal((await request('/entries')).data.entries[0].review_count,2);
});
test('replay and duplicate completion never increase review count',async()=>{
 const {request,op,id}=await setup();await request('/operations',op('register',0));const c=op('complete',1);
 assert.equal((await request('/operations',c)).data.entry.review_count,1);
 assert.equal((await request('/operations',c)).data.entry.review_count,1);
 const same=await request('/operations',op('complete',2));assert.equal(same.data.entry.review_count,1);assert.equal(same.data.entry.version,2);
 assert.equal((await request('/history?id='+id)).data.history.length,2);
});
test('users cannot read, complete or delete each other’s entries and history',async()=>{
 const {request,op,tb,id}=await setup();await request('/operations',op('register',0));
 assert.equal((await request('/entries',null,tb)).data.entries.length,0);
 assert.equal((await request('/history?id='+id,null,tb)).data.history.length,0);
 assert.equal((await request('/operations',op('complete',1,{user_id:'github:1'}),tb)).status,409);
 assert.equal((await request('/operations',op('delete',1),tb)).status,409);
 assert.equal((await request('/entries')).data.entries[0].state,'todo');
 await request('/operations',op('register',0),tb);assert.equal((await request('/entries',null,tb)).data.entries.length,1);
});
test('concurrent revisions reject lost updates and keep all changes atomic',async()=>{
 const {request,op,id}=await setup();await request('/operations',op('register',0));await request('/operations',op('complete',1));
 assert.equal((await request('/operations',op('delete',1))).status,409);
 assert.equal((await request('/history?id='+id)).data.history.length,2);
 assert.equal((await request('/entries')).data.entries[0].deleted,0);
});
test('deletion leaves tombstone, explicit re-registration retains review history',async()=>{
 const {request,op,id}=await setup();await request('/operations',op('register',0));await request('/operations',op('complete',1));
 assert.equal((await request('/operations',op('delete',2))).data.entry.deleted,1);
 const r=await request('/operations',op('register',3));assert.equal(r.data.entry.deleted,0);assert.equal(r.data.entry.review_count,1);assert.equal(r.data.entry.state,'todo');assert.equal((await request('/history?id='+id)).data.history.length,4);
});
test('all target kinds, coordinate validation and untrusted IDs',async()=>{
 const {request,op,t}=await setup();
 for(const kind of ['print','page','word','range'])for(const color of kind==='word'?['red','green','orange','black']:['']){
  const target={...t,kind,color},id=await targetId(target);assert.equal((await request('/operations',op('register',0,{id,target}))).status,200);
 }
 assert.equal((await request('/operations',op('register',0,{target:{...t,rect:[0,0,2,1]}}))).status,400);
 assert.equal((await request('/operations',op('register',0,{id:'z'.repeat(43)}))).status,400);
 const id=await targetId(t);assert.equal(await targetId({...t,text:'OCR修正後'}),id);
});
test('authentication, origin and revoked/expired sessions are enforced on server',async()=>{
 const {request,op,ta,DB}=await setup();
 assert.equal((await request('/entries',null,'invalid')).status,401);
 assert.equal((await request('/operations',op('register',0),ta,'https://evil.example')).status,403);
 await request('/operations',op('register',0));assert.equal((await request('/auth/logout',{})).status,200);
 assert.equal((await request('/entries')).status,401);
 assert.equal(DB.db.prepare('SELECT count(*) n FROM entries').get().n,1);
});
test('OAuth state, PKCE challenge, one-time exchange and ticket expiry',async()=>{
 const {env,request,ta}=await setup();const verifier='v'.repeat(43),challenge=await hash(verifier);
 const start=await worker.fetch(new Request(base+'/auth/start?challenge='+challenge),env);assert.equal(start.status,302);
 const redirect=new URL(start.headers.get('location'));assert.equal(redirect.origin,'https://github.com');assert.equal(redirect.searchParams.get('scope'),'');assert.equal(redirect.searchParams.get('code_challenge_method'),'S256');
 const invalid=await worker.fetch(new Request(base+'/auth/callback?state='+'z'.repeat(43)+'&code=bad'),env);assert.equal(invalid.status,400);
 const ticket='t'.repeat(43);await env.DB.prepare('INSERT INTO tickets VALUES(?,?,?,?,?)').bind(await hash(ticket),challenge,'github:8','eight',Date.now()+100000).run();
 assert.equal((await request('/auth/exchange',{ticket,verifier:'w'.repeat(43)})).status,401);
 const exchange=await request('/auth/exchange',{ticket,verifier});assert.equal(exchange.status,200);assert.equal(exchange.data.user_id,'github:8');assert.equal((await request('/entries',null,exchange.data.token)).status,200);
 assert.equal((await request('/auth/exchange',{ticket,verifier})).status,401);
 const expired='e'.repeat(43);await env.DB.prepare('INSERT INTO tickets VALUES(?,?,?,?,?)').bind(await hash(expired),challenge,'github:9','nine',Date.now()-1).run();assert.equal((await request('/auth/exchange',{ticket:expired,verifier})).status,401);
 assert.equal((await request('/entries',null,ta)).data.entries.length,0);
});
