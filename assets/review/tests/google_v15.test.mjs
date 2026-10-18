import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{hash,targetId,verifyGoogleIdToken} from '../server/worker_v15.mjs';
class D1{
 constructor(){this.db=new DatabaseSync(':memory:');for(const name of ['0001_review_v1.sql','0002_notes_v3.sql','0003_google_v8.sql','0004_shared_notes_v12.sql'])this.db.exec(readFileSync(new URL('../server/migrations/'+name,import.meta.url),'utf8'))}
 prepare(sql){const s=this.db.prepare(sql);let args=[];return {bind(...a){args=a;return this},async first(){return s.get(...args)||null},async all(){return {results:s.all(...args)}},async run(){return s.run(...args)}}}
 async batch(ss){return Promise.all(ss.map(s=>s.run()))}
}
const origin='https://harahettarou.github.io',base='https://fullpuri-review.niwatorikounotori.workers.dev';
const enc=new TextEncoder(),b64=b=>Buffer.from(b).toString('base64url');
const rsa=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const publicJwk={...await crypto.subtle.exportKey('jwk',rsa.publicKey),kid:'google-test-v8',use:'sig',alg:'RS256'};
async function jwt(nonce,sub='google-person-1',overrides={},header={}){const now=Math.floor(Date.now()/1000);const h=b64(JSON.stringify({alg:'RS256',kid:publicJwk.kid,...header})),p=b64(JSON.stringify({iss:'https://accounts.google.com',aud:'google-client.apps.googleusercontent.com',iat:now,exp:now+3600,nonce,sub,email:sub+'@example.com',email_verified:true,...overrides}));return h+'.'+p+'.'+b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',rsa.privateKey,enc.encode(h+'.'+p)))}
async function scenario(fn){
 const DB=new D1(),env={DB,SITE_URL:origin+'/fullpuri/',GITHUB_CLIENT_ID:'github-client',GITHUB_CLIENT_SECRET:'github-secret',GOOGLE_CLIENT_ID:'google-client.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'google-secret'},tokens=['a'.repeat(43),'b'.repeat(43)];
 for(let i=0;i<2;i++)await DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hash(tokens[i]),'github:'+(i+1),'old-user'+(i+1),Date.now()+1000000).run();
 const request=async(path,body,token=tokens[0],from=origin)=>{const response=await worker.fetch(new Request(base+path,{method:body?'POST':'GET',headers:{Origin:from,Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env),data=response.headers.get('content-type')?.includes('json')?await response.json():null;return {response,status:response.status,data}};
 const originalFetch=globalThis.fetch,codes=new Map();globalThis.fetch=async(input,options={})=>{const u=String(input);if(u==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[publicJwk]},{headers:{'Cache-Control':'public, max-age=3600'}});if(u==='https://oauth2.googleapis.com/token'){const form=new URLSearchParams(options.body),value=codes.get(form.get('code'));assert.ok(value);assert.equal(await hash(form.get('code_verifier')),value.challenge);assert.equal(form.get('redirect_uri'),base+'/auth/google/callback');assert.equal(form.get('client_secret'),env.GOOGLE_CLIENT_SECRET);return Response.json({id_token:await jwt(value.nonce,value.sub,value.overrides||{}),access_token:'not-saved'})}throw Error('unexpected outbound URL '+u)};
 let sequence=0;
 const start=async({link=false,token=tokens[0],sub='google-person-1',overrides={}}={})=>{const verifier='v'.repeat(42)+(sequence++%10),challenge=await hash(verifier);const r=link?await request('/auth/google/link',{challenge,user_id:'github:999'},token):await request('/auth/google/start?challenge='+challenge);assert.equal(r.status,link?200:302);const u=new URL(link?r.data.url:r.response.headers.get('location'));assert.equal(u.origin,'https://accounts.google.com');assert.equal(u.searchParams.get('scope'),'openid email');assert.equal(u.searchParams.get('prompt'),'select_account');const code='code-'+sequence;codes.set(code,{nonce:u.searchParams.get('nonce'),challenge:u.searchParams.get('code_challenge'),sub,overrides});return {verifier,state:u.searchParams.get('state'),code,url:u}};
 const callback=async flow=>{const r=await request('/auth/google/callback?state='+flow.state+'&code='+flow.code);if(r.status!==302)return r;return {...r,ticket:new URL(r.response.headers.get('location')).hash.slice('#ticket='.length)}};
 const finish=async flow=>{const cb=await callback(flow);if(cb.status!==302)return cb;return request('/auth/exchange',{ticket:cb.ticket,verifier:flow.verifier})};
 try{await fn({DB,env,request,tokens,start,callback,finish})}finally{globalThis.fetch=originalFetch}
}
test('Google explicit link preserves legacy GitHub review, notes and history across future logins',async()=>scenario(async({DB,request,start,finish})=>{
 const t={kind:'word',no:85,page:'No085_p1',color:'red',text:'旧記録',rect:[.1,.2,.1,.03]},id=await targetId(t);
 await request('/operations',{op_id:'r'.repeat(43),id,target:t,expected:0,action:'register'});await request('/operations',{op_id:'s'.repeat(43),id,target:t,expected:1,action:'complete'});await request('/note-operations',{op_id:'n'.repeat(43),id,target:t,body:'以前のメモ',expected:0,action:'put'});
 const flow=await start({link:true}),linked=await finish(flow);assert.equal(linked.status,200);assert.equal(linked.data.user_id,'github:1');assert.equal(linked.data.provider,'google');
 const login=await finish(await start());assert.equal(login.data.user_id,'github:1');const token=login.data.token;assert.equal((await request('/entries',null,token)).data.entries[0].review_count,1);assert.equal((await request('/notes',null,token)).data.notes[0].body,'以前のメモ');assert.equal((await request('/history?id='+id,null,token)).data.history.length,2);assert.equal((await request('/me')).data.account.google_linked,true);assert.equal(DB.db.prepare('SELECT count(*) n FROM entries').get().n,1);
}));
test('Google standalone account stays isolated and cannot be silently merged into GitHub',async()=>scenario(async({request,start,finish})=>{
 const standalone=await finish(await start());assert.equal(standalone.status,200);assert.equal(standalone.data.user_id,'google:google-person-1');
 const attempt=await finish(await start({link:true}));assert.equal(attempt.status,409);assert.equal((await request('/me')).data.account.google_linked,false);assert.equal((await request('/entries',null,standalone.data.token)).data.entries.length,0);
}));
test('a Google identity cannot be taken over or replaced; source session is checked at exchange',async()=>scenario(async({DB,request,tokens,start,finish})=>{
 assert.equal((await finish(await start({link:true}))).status,200);
 assert.equal((await finish(await start({link:true,token:tokens[1]}))).status,409);
 assert.equal((await finish(await start({link:true,sub:'another-person'}))).status,409);
 const pending=await start({link:true,token:tokens[1],sub:'third-person'});await request('/auth/logout',{},tokens[1]);assert.equal((await finish(pending)).status,401);assert.equal(DB.db.prepare('SELECT count(*) n FROM google_identities').get().n,1);
}));
test('Google flow rejects wrong state, expired state, wrong front verifier and ticket replay',async()=>scenario(async({DB,request,start,callback})=>{
 const flow=await start({link:true});assert.equal((await request('/auth/google/callback?state='+'z'.repeat(43)+'&code='+flow.code)).status,400);const cb=await callback(flow);assert.equal(cb.status,302);
 assert.equal((await request('/auth/exchange',{ticket:cb.ticket,verifier:'x'.repeat(43)})).status,401);assert.equal(DB.db.prepare('SELECT count(*) n FROM google_identities').get().n,0);
 assert.equal((await request('/auth/exchange',{ticket:cb.ticket,verifier:flow.verifier})).status,200);assert.equal((await request('/auth/exchange',{ticket:cb.ticket,verifier:flow.verifier})).status,401);assert.equal((await callback(flow)).status,400);
 const stale=await start();DB.db.exec('UPDATE google_states SET expires=0');assert.equal((await callback(stale)).status,400);
}));
test('Google tokens require a valid signature, issuer, audience, nonce, time and subject',async()=>scenario(async({env})=>{
 const nonce='n'.repeat(43),good=await jwt(nonce);assert.equal((await verifyGoogleIdToken(good,env,nonce)).subject,'google-person-1');
 for(const overrides of [{iss:'https://evil.example'},{aud:'someone-else'},{nonce:'bad'},{exp:1},{iat:Math.floor(Date.now()/1000)+600},{sub:''},{azp:'other-client'},{aud:[env.GOOGLE_CLIENT_ID,'other-client']}])await assert.rejects(verifyGoogleIdToken(await jwt(nonce,'google-person-1',overrides),env,nonce));
 const parts=good.split('.');parts[1]=b64(JSON.stringify({aud:env.GOOGLE_CLIENT_ID,nonce,sub:'forged'}));await assert.rejects(verifyGoogleIdToken(parts.join('.'),env,nonce));await assert.rejects(verifyGoogleIdToken(await jwt(nonce,'google-person-1',{}, {alg:'none'}),env,nonce));
}));
test('link endpoints enforce authentication and origin; cancellation does not link an account',async()=>scenario(async({DB,request,start})=>{
 assert.equal((await request('/auth/google/link',{challenge:'c'.repeat(43)},'bad')).status,401);assert.equal((await request('/auth/google/link',{challenge:'c'.repeat(43)},'a'.repeat(43),'https://evil.example')).status,403);
 const flow=await start({link:true});const cancel=await request('/auth/google/callback?state='+flow.state+'&error=access_denied');assert.equal(cancel.status,302);assert.match(cancel.response.headers.get('location'),/auth_error=google_cancelled/);assert.equal(DB.db.prepare('SELECT count(*) n FROM google_identities').get().n,0);
}));
test('matching email addresses do not merge distinct Google subjects',async()=>scenario(async({request,start,finish})=>{
 const first=await finish(await start({sub:'subject-A',overrides:{email:'same@example.com'}}));const second=await finish(await start({sub:'subject-B',overrides:{email:'same@example.com'}}));assert.equal(first.status,200);assert.equal(second.status,200);assert.notEqual(first.data.user_id,second.data.user_id);
 const t={kind:'page',no:85,page:'No085_p1',color:'',text:'ページ',rect:[0,0,1,1]},id=await targetId(t);await request('/operations',{op_id:'c'.repeat(43),id,target:t,action:'register',expected:0},first.data.token);assert.equal((await request('/entries',null,second.data.token)).data.entries.length,0);
}));
