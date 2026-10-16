// GitHub Pages frontend + isolated authenticated D1 API. No user-supplied identity is trusted.
const encoder=new TextEncoder();
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
export const hash=async value=>b64(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
const fail=(code,message)=>{throw Object.assign(new Error(message),{status:code})};
const json=(value,status=200)=>Response.json(value,{status});
function site(env){const u=new URL(env.SITE_URL);if(u.protocol!=='https:')fail(503,'設定を確認してください');return u;}
async function body(req){if(Number(req.headers.get('content-length'))>24000)fail(413,'データが大きすぎます');const s=await req.text();if(s.length>24000)fail(413,'データが大きすぎます');try{return JSON.parse(s)}catch{fail(400,'不正なJSONです')}}
const validToken=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{43}$/.test(s);
export function validateTarget(t){
 if(!t||!['print','page','word','range'].includes(t.kind)||!Number.isInteger(t.no)||t.no<0||t.no>9999||typeof t.page!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(t.page))fail(400,'対象が不正です');
 if(typeof t.text!=='string'||t.text.length>1000||!['red','green','orange','black',''].includes(t.color))fail(400,'語句が不正です');
 if(!Array.isArray(t.rect)||t.rect.length!==4||!t.rect.every(Number.isFinite)||t.rect.some(v=>v<0)||t.rect[2]<=0||t.rect[3]<=0||t.rect[0]+t.rect[2]>1.000001||t.rect[1]+t.rect[3]>1.000001)fail(400,'座標が不正です');
 if(t.kind==='word'&&!t.color||t.kind!=='word'&&t.color)fail(400,'対象の種類と色が一致しません');
 return {kind:t.kind,no:t.no,page:t.page,text:t.text,color:t.color,rect:t.rect.map(v=>Math.round(v*1e6)/1e6)};
}
export async function targetId(t){
 // Text is deliberately excluded: OCR correction cannot change identity.
 return hash(JSON.stringify([t.kind,t.kind==='print'?t.no:t.page,t.color,t.kind==='print'||t.kind==='page'?[]:t.rect,t.color==='black'?t.text:'']));
}
async function authenticate(req,env){
 const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
 if(!validToken(token))fail(401,'ログインしてください');
 const session=await env.DB.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires>?').bind(await hash(token),Date.now()).first();
 if(!session)fail(401,'ログインし直してください');return session;
}
// Google authorization-code flow. The provider identity is verified on the server.
let googleKeyCache={keys:[],expires:0};
async function googleKeys(force=false){
 if(!force&&googleKeyCache.expires>Date.now())return googleKeyCache.keys;
 const response=await fetch('https://www.googleapis.com/oauth2/v3/certs',{signal:AbortSignal.timeout(15000)});
 if(!response.ok)fail(503,'Googleの認証鍵を取得できません。時間をおいて再試行してください');
 const data=await response.json();if(!Array.isArray(data.keys))fail(503,'Googleの認証鍵を確認できません');
 const age=Math.min(3600,Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1])||300);
 googleKeyCache={keys:data.keys,expires:Date.now()+age*1000};return data.keys;
}
function decodePart(value){if(!/^[A-Za-z0-9_-]+$/.test(value))fail(401,'Google認証情報が不正です');try{return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))}catch{fail(401,'Google認証情報が不正です')}}
export async function verifyGoogleIdToken(token,env,nonce){
 if(typeof token!=='string'||token.length>20000)fail(401,'Google認証情報が不正です');
 const parts=token.split('.');if(parts.length!==3)fail(401,'Google認証情報が不正です');
 let header,claims;try{header=JSON.parse(new TextDecoder().decode(decodePart(parts[0])));claims=JSON.parse(new TextDecoder().decode(decodePart(parts[1])))}catch{fail(401,'Google認証情報が不正です')}
 if(!header||header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200||header.crit)fail(401,'Google認証方式を確認できません');
 let keys=await googleKeys(),key=keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig')&&(!k.alg||k.alg==='RS256'));
 if(!key){keys=await googleKeys(true);key=keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig')&&(!k.alg||k.alg==='RS256'))}
 if(!key)fail(401,'Googleの署名を確認できません');
 let valid=false;try{const imported=await crypto.subtle.importKey('jwk',key,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',imported,decodePart(parts[2]),encoder.encode(parts[0]+'.'+parts[1]))}catch{}
 if(!valid)fail(401,'Googleの署名を確認できません');
 const now=Math.floor(Date.now()/1000),aud=claims?.aud;
 if(!claims||!['https://accounts.google.com','accounts.google.com'].includes(claims.iss)||!(aud===env.GOOGLE_CLIENT_ID||Array.isArray(aud)&&aud.includes(env.GOOGLE_CLIENT_ID))||(claims.azp!==undefined&&claims.azp!==env.GOOGLE_CLIENT_ID)||(Array.isArray(aud)&&aud.length>1&&claims.azp!==env.GOOGLE_CLIENT_ID)||!Number.isInteger(claims.exp)||claims.exp<=now||!Number.isInteger(claims.iat)||claims.iat>now+60||claims.exp<=claims.iat||claims.nonce!==nonce||!validToken(nonce)||typeof claims.sub!=='string'||!/^[\x21-\x7e]{1,255}$/.test(claims.sub))fail(401,'Google認証の宛先・有効期限・本人情報を確認できません');
 return {subject:claims.sub,login:claims.email_verified===true&&typeof claims.email==='string'&&claims.email.length<=254?claims.email:'Googleユーザー'};
}
function googleReady(env){return !!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET)}
async function startGoogle(req,env,challenge,source=null){
 if(!googleReady(env))fail(503,'Googleログインは準備中です');
 if(!validToken(challenge))fail(400,'認証情報が不正です');
 const state=random(),verifier=random(),nonce=random();
 await env.DB.prepare('INSERT INTO google_states VALUES(?,?,?,?,?,?,?)').bind(await hash(state),challenge,verifier,nonce,source?.user_id||null,source?.token_hash||null,Date.now()+600000).run();
 const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 for(const [k,v]of Object.entries({client_id:env.GOOGLE_CLIENT_ID,response_type:'code',redirect_uri:new URL('/auth/google/callback',req.url).href,scope:'openid email',state,nonce,prompt:'select_account',code_challenge:await hash(verifier),code_challenge_method:'S256'}))u.searchParams.set(k,v);
 return u.href;
}
async function googleCallback(req,env,url){
 if(!googleReady(env))fail(503,'Googleログインは準備中です');
 const state=url.searchParams.get('state');if(!validToken(state))fail(400,'Google認証をやり直してください');
 const saved=await env.DB.prepare('DELETE FROM google_states WHERE state_hash=? AND expires>? RETURNING *').bind(await hash(state),Date.now()).first();
 if(!saved)fail(400,'Google認証をやり直してください');
 if(url.searchParams.get('error')==='access_denied')return Response.redirect(new URL('pages/review.html#auth_error=google_cancelled',env.SITE_URL).href,302);
 if(!url.searchParams.get('code'))fail(400,'Google認証をやり直してください');
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,code:url.searchParams.get('code'),code_verifier:saved.verifier,grant_type:'authorization_code',redirect_uri:new URL('/auth/google/callback',req.url).href}),signal:AbortSignal.timeout(15000)});
 const auth=await response.json();if(!response.ok||!auth.id_token)fail(401,'Google認証に失敗しました');
 const identity=await verifyGoogleIdToken(auth.id_token,env,saved.nonce),ticket=random();
 await env.DB.prepare('INSERT INTO google_tickets VALUES(?,?,?,?,?,?,?)').bind(await hash(ticket),saved.challenge,identity.subject,identity.login,saved.source_user_id,saved.source_session_hash,Date.now()+120000).run();
 return Response.redirect(new URL('pages/review.html#ticket='+ticket,env.SITE_URL).href,302);
}
async function exchangeGoogle(env,ticket,verifier){
 const row=await env.DB.prepare('DELETE FROM google_tickets WHERE ticket_hash=? AND challenge=? AND expires>? RETURNING *').bind(await hash(ticket),await hash(verifier),Date.now()).first();
 if(!row)fail(401,'認証をやり直してください');
 if(row.source_user_id){
  const session=await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND user_id=? AND expires>?').bind(row.source_session_hash,row.source_user_id,Date.now()).first();
  if(!session)fail(401,'元のログインが失効しました。GitHubでログインし直してからGoogleを連携してください');
 }
 const uid=row.source_user_id||'google:'+row.subject;
 // Two UNIQUE constraints prevent takeover of another Google identity or replacing an existing link.
 try{await env.DB.prepare('INSERT INTO google_identities VALUES(?,?,?,?) ON CONFLICT(subject) DO NOTHING').bind(row.subject,uid,row.display_login,new Date().toISOString()).run()}
 catch(error){if(String(error).includes('UNIQUE'))fail(409,'この学習アカウントには別のGoogleアカウントが連携済みです');throw error}
 const identity=await env.DB.prepare('SELECT * FROM google_identities WHERE subject=?').bind(row.subject).first();
 if(!identity||row.source_user_id&&identity.user_id!==row.source_user_id)fail(409,'このGoogleアカウントは別の学習アカウントで使用済みです。記録を自動統合せず連携を中止しました');
 await env.DB.prepare('UPDATE google_identities SET display_login=? WHERE subject=? AND user_id=?').bind(row.display_login,row.subject,identity.user_id).run();
 return {user_id:identity.user_id,login:row.display_login,provider:'google'};
}

async function route(req,env){
 const url=new URL(req.url),path=url.pathname,origin=site(env).origin;
 if(path==='/health')return json({ok:true,version:8,features:['review','notes','google-login','account-linking'],google_configured:googleReady(env)});
 if(path==='/auth/google/start'&&req.method==='GET')return Response.redirect(await startGoogle(req,env,url.searchParams.get('challenge')),302);
 if(path==='/auth/google/callback'&&req.method==='GET')return googleCallback(req,env,url);
 if(path==='/auth/start'&&req.method==='GET'){
  const challenge=url.searchParams.get('challenge');if(!validToken(challenge))fail(400,'認証情報が不正です');
  const state=random(),verifier=random();
  await env.DB.prepare('INSERT INTO oauth_states VALUES(?,?,?,?)').bind(await hash(state),challenge,verifier,Date.now()+600000).run();
  const u=new URL('https://github.com/login/oauth/authorize');
  for(const [k,v]of Object.entries({client_id:env.GITHUB_CLIENT_ID,redirect_uri:new URL('/auth/callback',req.url).href,state,scope:'',code_challenge:await hash(verifier),code_challenge_method:'S256'}))u.searchParams.set(k,v);
  return Response.redirect(u.href,302);
 }
 if(path==='/auth/callback'&&req.method==='GET'){
  const state=url.searchParams.get('state');if(!validToken(state))fail(400,'認証をやり直してください');
  const saved=await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=? AND expires>? RETURNING *').bind(await hash(state),Date.now()).first();
  if(!saved||!url.searchParams.get('code'))fail(400,'認証をやり直してください');
  const response=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code:url.searchParams.get('code'),redirect_uri:new URL('/auth/callback',req.url).href,code_verifier:saved.verifier})});
  const auth=await response.json();if(!response.ok||!auth.access_token)fail(401,'GitHub認証に失敗しました');
  const userResponse=await fetch('https://api.github.com/user',{headers:{Authorization:`Bearer ${auth.access_token}`,Accept:'application/vnd.github+json','User-Agent':'fullpuri-review'}});
  const user=await userResponse.json();if(!userResponse.ok||!Number.isSafeInteger(user.id))fail(401,'アカウントを確認できません');
  const ticket=random();await env.DB.prepare('INSERT INTO tickets VALUES(?,?,?,?,?)').bind(await hash(ticket),saved.challenge,`github:${user.id}`,String(user.login),Date.now()+120000).run();
  return Response.redirect(new URL(`pages/review.html#ticket=${ticket}`,env.SITE_URL).href,302);
 }
 // Bearer-only API; no third-party cookies or client-asserted user IDs.
 if(req.headers.get('origin')!==origin)fail(403,'許可されていない接続元です');
 if(path==='/auth/providers'&&req.method==='GET')return json({github:!!env.GITHUB_CLIENT_ID,google:googleReady(env)});
 if(path==='/auth/exchange'&&req.method==='POST'){
  const b=await body(req);if(!validToken(b.ticket)||!validToken(b.verifier))fail(400,'認証情報が不正です');
  const row=await env.DB.prepare('DELETE FROM tickets WHERE ticket_hash=? AND challenge=? AND expires>? RETURNING *').bind(await hash(b.ticket),await hash(b.verifier),Date.now()).first();
  const identity=row?{...row,provider:'github'}:await exchangeGoogle(env,b.ticket,b.verifier);
  const token=random(),expires=Date.now()+30*86400000;
  await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hash(token),identity.user_id,identity.login,expires).run();
  return json({token,user_id:identity.user_id,login:identity.login,expires,provider:identity.provider});
 }
 const user=await authenticate(req,env),uid=user.user_id;
 if(path==='/auth/google/link'&&req.method==='POST'){const b=await body(req);return json({url:await startGoogle(req,env,b.challenge,user)})}
 if(path==='/me'&&req.method==='GET'){const linked=await env.DB.prepare('SELECT display_login FROM google_identities WHERE user_id=?').bind(uid).first();return json({user_id:uid,login:user.login,expires:user.expires,account:{google_linked:!!linked,google_label:linked?.display_login||''}})}
 if(path==='/auth/logout'&&req.method==='POST'){
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(user.token_hash).run();return json({ok:true});
 }
 if(path==='/notes'&&req.method==='GET'){
  const rows=await env.DB.prepare('SELECT * FROM notes WHERE user_id=?').bind(uid).all();
  return json({notes:rows.results.map(({user_id,...n})=>({...n,target:JSON.parse(n.target)}))});
 }
 if(path==='/note-operations'&&req.method==='POST'){
  const b=await body(req);
  if(!validToken(b.op_id)||!validToken(b.id)||!Number.isSafeInteger(b.expected)||b.expected<0||!['put','delete'].includes(b.action))fail(400,'メモ操作が不正です');
  if(typeof b.body!=='string'||b.body.length>6000||b.action==='put'&&!b.body.trim())fail(400,'メモは1〜6000文字で入力してください');
  const t=validateTarget(b.target);if(await targetId(t)!==b.id)fail(400,'対象IDが一致しません');
  try{await env.DB.prepare('INSERT OR IGNORE INTO note_operations VALUES(?,?,?,?,?,?,?,?)').bind(uid,b.op_id,b.id,b.action,JSON.stringify(t),b.action==='delete'?'':b.body,b.expected,new Date().toISOString()).run()}
  catch(error){if(String(error).includes('version_conflict'))fail(409,'別端末でメモが更新されました。両方の内容を確認してください');throw error}
  const row=await env.DB.prepare('SELECT * FROM notes WHERE user_id=? AND id=?').bind(uid,b.id).first();
  return json({note:{...row,user_id:undefined,target:JSON.parse(row.target)}});
 }
 if(path==='/entries'&&req.method==='GET'){
  const rows=await env.DB.prepare('SELECT * FROM entries WHERE user_id=?').bind(uid).all();
  return json({entries:rows.results.map(({user_id,...r})=>({...r,target:JSON.parse(r.target)}))});
 }
 if(path==='/history'&&req.method==='GET'){
  const id=url.searchParams.get('id');if(!validToken(id))fail(400,'対象が不正です');
  return json({history:(await env.DB.prepare('SELECT action,at,op_id FROM history WHERE user_id=? AND entry_id=? ORDER BY at,rowid').bind(uid,id).all()).results});
 }
 if(path==='/operations'&&req.method==='POST'){
  const b=await body(req);
  if(!validToken(b.op_id)||!validToken(b.id)||!Number.isInteger(b.expected)||b.expected<0||!['register','complete','reopen','delete'].includes(b.action))fail(400,'操作が不正です');
  const t=validateTarget(b.target);if(await targetId(t)!==b.id)fail(400,'対象IDが一致しません');
  // A single INSERT and database triggers atomically validate revision, mutate and log history.
  try{await env.DB.prepare('INSERT OR IGNORE INTO operations VALUES(?,?,?,?,?,?,?)').bind(uid,b.op_id,b.id,b.action,JSON.stringify(t),b.expected,new Date().toISOString()).run()}
  catch(error){if(String(error).includes('version_conflict'))fail(409,'別端末で更新されました。変更内容を確認してください');throw error}
  const row=await env.DB.prepare('SELECT * FROM entries WHERE user_id=? AND id=?').bind(uid,b.id).first();
  return json({entry:{...row,user_id:undefined,target:JSON.parse(row.target)}});
 }
 fail(404,'見つかりません');
}
export default {
 async fetch(req,env){
  let allowed='';try{allowed=site(env).origin}catch{return json({error:'SITE_URLを設定してください'},503)}
  if(req.method==='OPTIONS')return new Response(null,{status:req.headers.get('origin')===allowed?204:403,headers:{'Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600',Vary:'Origin'}});
  let res;try{if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET||!env.DB)fail(503,'認証・保存サービスの設定が必要です');res=await route(req,env)}catch(error){res=json({error:error.status?error.message:'保存サービスでエラーが発生しました'},error.status||500)}
  const headers=new Headers(res.headers);headers.set('Access-Control-Allow-Origin',allowed);headers.set('Vary','Origin');headers.set('Cache-Control','no-store');headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');
  return new Response(res.body,{status:res.status,headers});
 },
 async scheduled(_event,env){const now=Date.now();await env.DB.batch(['sessions','oauth_states','tickets','google_states','google_tickets'].map(t=>env.DB.prepare(`DELETE FROM ${t} WHERE expires<?`).bind(now)))}
};
