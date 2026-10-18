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
 if(t.page.startsWith('mat_')&&t.material===undefined)fail(400,'教材の参照が必要です');
 const value={kind:t.kind,no:t.no,page:t.page,text:t.text,color:t.color,rect:t.rect.map(v=>Math.round(v*1e6)/1e6)};
 if(t.material!==undefined){const m=t.material;if(!m||!materialId(m.id)||!Number.isInteger(m.page)||m.page<1||m.page>1000||t.no!==0||t.kind==='print'||t.page!==`mat_${m.id}_${m.page}`||typeof m.title!=='string'||m.title.length>200||typeof m.subject!=='string'||m.subject.length>60)fail(400,'教材の参照が不正です');value.material={id:m.id,page:m.page,title:m.title,subject:m.subject}}return value;
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

function sharedAdmin(env,uid){return String(env.ADMIN_USER_IDS||'').split(',').map(s=>s.trim()).filter(Boolean).includes(uid)}
function sharedRow(row,admin){return {...row,target:JSON.parse(row.target),...(!admin&&row.deleted?{body:''}:{})}}
async function sharedRoute(req,env,url,user){
 const uid=user.user_id,admin=sharedAdmin(env,uid),path=url.pathname;
 if(path==='/shared-notes'&&req.method==='GET'){
  const rows=await env.DB.prepare('SELECT * FROM shared_notes ORDER BY updated_at DESC').all();
  return json({notes:(await visibleSharedRows(env,rows.results,user)).map(n=>sharedRow(n,admin)),is_admin:admin});
 }
 if(path==='/shared-note-history'&&req.method==='GET'){
  const id=url.searchParams.get('id');if(!validToken(id))fail(400,'対象が不正です');
  const note=await env.DB.prepare('SELECT deleted,target FROM shared_notes WHERE id=?').bind(id).first();
  if(!note||note.deleted&&!admin)fail(404,'メモが見つかりません');await materialTargetAccess(env,JSON.parse(note.target),user);
  const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(before)||before<1)fail(400,'履歴の指定が不正です');
  const rows=await env.DB.prepare('SELECT version,action,at,actor_label,body,deleted FROM shared_note_history WHERE entry_id=? AND version<? ORDER BY version DESC LIMIT 51').bind(id,before).all();
  return json({history:rows.results.slice(0,50),has_more:rows.results.length>50,next_before:rows.results.length>50?rows.results[49].version:null});
 }
 if(path==='/shared-note-operations'&&req.method==='POST'){
  const b=await body(req);if(!b||typeof b!=='object'||Array.isArray(b))fail(400,'共通メモの操作が不正です');
  if(!validToken(b.op_id)||!validToken(b.id)||!Number.isSafeInteger(b.expected)||b.expected<0||!['put','delete','restore'].includes(b.action))fail(400,'共通メモの操作が不正です');
  // The role is derived exclusively from the authenticated session and Worker configuration.
  if(b.action!=='put'&&!admin)fail(403,'共通メモの削除・復元は管理者だけが行えます');
  if(typeof b.body!=='string'||b.body.length>6000||b.action==='put'&&!b.body.trim())fail(400,'メモは1〜6000文字で入力してください');
  const t=validateTarget(b.target);if(b.action==='put'||b.action==='register'||path==='/shared-note-operations')await materialTargetAccess(env,t,user);if(await targetId(t)!==b.id)fail(400,'対象IDが一致しません');
  const old=await env.DB.prepare('SELECT * FROM shared_note_operations WHERE actor_id=? AND op_id=?').bind(uid,b.op_id).first();
  if(old&&(old.entry_id!==b.id||old.action!==b.action||old.expected!==b.expected||old.body!==(b.action==='put'?b.body:'')))fail(400,'操作IDが重複しています');
  if(!old){
   const current=await env.DB.prepare('SELECT * FROM shared_notes WHERE id=?').bind(b.id).first();
   if(current&&!current.deleted&&b.action==='put'&&current.body===b.body&&current.version===b.expected)return json({note:sharedRow(current,admin),is_admin:admin});
   try{await env.DB.prepare('INSERT OR IGNORE INTO shared_note_operations VALUES(?,?,?,?,?,?,?,?,?,?)').bind(uid,b.op_id,b.id,b.action,JSON.stringify(t),b.action==='put'?b.body:'',b.expected,new Date().toISOString(),'ユーザー '+(await hash(uid)).slice(0,8),admin?1:0).run()}
   catch(error){if(String(error).includes('version_conflict'))fail(409,'他のユーザーが更新しました。両方の内容を確認してください');if(String(error).includes('restore_required'))fail(409,'この共通メモは削除済みです。管理者による復元が必要です');if(String(error).includes('admin_required'))fail(403,'管理者だけが行えます');throw error}
  }
  const row=await env.DB.prepare('SELECT * FROM shared_notes WHERE id=?').bind(b.id).first();
  return json({note:sharedRow(row,admin),is_admin:admin});
 }
 fail(404,'見つかりません');
}
// Included in the single-file Worker build. Original PDF objects are immutable.
const MATERIAL_MAX_BYTES=50*1024*1024,materialId=s=>typeof s==='string'&&/^[a-f0-9]{32}$/.test(s);
async function materialBody(req){const text=await req.text();if(encoder.encode(text).byteLength>300000)fail(413,'教材の編集データが大きすぎます');try{return JSON.parse(text)}catch{fail(400,'不正なJSONです')}}
function materialData(d,pages){
 if(!d||typeof d!=='object'||typeof d.title!=='string'||!d.title.trim()||d.title.length>200||typeof d.subject!=='string'||!d.subject.trim()||d.subject.length>60||typeof d.folder!=='string'||d.folder.length>100||!Array.isArray(d.annotations)||d.annotations.length>1000)fail(400,'教材名・教科・フォルダーを確認してください');
 const ids=new Set(),annotations=d.annotations.map(a=>{
  if(!a||typeof a.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(a.id)||ids.has(a.id)||!Number.isInteger(a.page)||a.page<1||a.page>pages||!['text','red-mask','green-mask'].includes(a.kind)||!Array.isArray(a.rect)||a.rect.length!==4||!a.rect.every(Number.isFinite)||a.rect.some(v=>v<0)||a.rect[2]<=0||a.rect[3]<=0||a.rect[0]+a.rect[2]>1.000001||a.rect[1]+a.rect[3]>1.000001)fail(400,'追加文字・範囲の位置が不正です');
  ids.add(a.id);const value={id:a.id,page:a.page,kind:a.kind,rect:a.rect.map(v=>Math.round(v*1e6)/1e6)};
  if(a.kind==='text'){if(typeof a.text!=='string'||!a.text.trim()||a.text.length>500||!['orange','red','green','black'].includes(a.color)||!Number.isFinite(a.font_size)||a.font_size<4||a.font_size>144)fail(400,'文字・色・大きさを確認してください');Object.assign(value,{text:a.text,color:a.color,font_size:a.font_size})}return value;
 });
 const value={title:d.title.trim(),subject:d.subject.trim(),folder:d.folder.trim(),annotations};if(encoder.encode(JSON.stringify(value)).byteLength>240000)fail(413,'編集内容が多すぎます。教材を分けてください');return value;
}
async function materialAccess(env,id,user){
 if(!materialId(id))fail(404,'教材が見つかりません');
 const row=await env.DB.prepare('SELECT * FROM materials WHERE id=?').bind(id).first();
 if(!row||!sharedAdmin(env,user.user_id)&&(row.archived||!row.uploaded||!row.published))fail(404,'教材が見つかりません');return row;
}
function materialView(row,admin,edit=false){
 const snapshot=JSON.parse(edit?row.draft:row.published||row.draft);
 return {id:row.id,...snapshot,page_count:row.page_count,file_size:row.file_size,sha256:row.sha256,uploaded:!!row.uploaded,published:!!row.published,archived:!!row.archived,version:row.version,created_at:row.created_at,updated_at:admin?row.updated_at:row.published_at,published_at:row.published_at,is_admin:admin,...(admin?{draft:JSON.parse(row.draft)}:{})};
}
async function materialTargetAccess(env,t,user){if(t.material){const row=await materialAccess(env,t.material.id,user);if(t.material.page>row.page_count)fail(400,'ページが存在しません')}}
async function visibleSharedRows(env,rows,user){
 const parsed=rows.map(n=>({...n,target:JSON.parse(n.target)}));if(sharedAdmin(env,user.user_id))return rows;
 if(!parsed.some(n=>n.target.material))return rows;
 const visible=new Set((await env.DB.prepare('SELECT id FROM materials WHERE archived=0 AND uploaded=1 AND published IS NOT NULL').all()).results.map(n=>n.id));
 return rows.map((n,i)=>!parsed[i].target.material||visible.has(parsed[i].target.material.id)?n:{...n,deleted:1,body:'',target:JSON.stringify({...parsed[i].target,text:'非公開の教材',material:{...parsed[i].target.material,title:'非公開の教材',subject:''}})});
}
async function materialRoute(req,env,url,user){
 const path=url.pathname,admin=sharedAdmin(env,user.user_id);
 if(path==='/materials/config'&&req.method==='GET')return json({enabled:!!env.MATERIALS_BUCKET,is_admin:admin,max_bytes:MATERIAL_MAX_BYTES});
 if(!env.MATERIALS_BUCKET)fail(503,'教材のファイル保存先を設定してください');
 if(path==='/materials'&&req.method==='GET'){
  const doc=admin?'draft':'published';
  const rows=await env.DB.prepare(`SELECT id,page_count,file_size,sha256,uploaded,archived,version,created_at,${admin?'updated_at':'published_at'} AS updated_at,published_at,published IS NOT NULL AS is_published,json_extract(${doc},'$.title') AS title,json_extract(${doc},'$.subject') AS subject,json_extract(${doc},'$.folder') AS folder FROM materials ${admin?'':'WHERE archived=0 AND uploaded=1 AND published IS NOT NULL'} ORDER BY ${admin?'updated_at':'published_at'} DESC`).all();
  return json({is_admin:admin,materials:rows.results.map(({is_published,...row})=>({...row,published:!!is_published,uploaded:!!row.uploaded,archived:!!row.archived,is_admin:admin}))});
 }
 if(path==='/materials'&&req.method==='POST'){
  if(!admin)fail(403,'教材の追加は管理者だけが行えます');const b=await materialBody(req);
  if(!b||!materialId(b.id)||!Number.isInteger(b.file_size)||b.file_size<5||b.file_size>MATERIAL_MAX_BYTES||!Number.isInteger(b.page_count)||b.page_count<1||b.page_count>1000||typeof b.sha256!=='string'||!/^[a-f0-9]{64}$/.test(b.sha256))fail(400,'PDFの形式・容量・ページ数を確認してください');
  const data=materialData({...b,annotations:[]},b.page_count),old=await env.DB.prepare('SELECT * FROM materials WHERE id=?').bind(b.id).first();
  if(old){if(old.sha256!==b.sha256||old.file_size!==b.file_size||old.page_count!==b.page_count)fail(409,'別のPDFと登録IDが重複しています');return json({material:materialView(old,true,true)})}
  const now=new Date().toISOString();await env.DB.prepare('INSERT INTO materials(id,pdf_key,sha256,file_size,page_count,draft,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(b.id,'materials/'+b.id+'.pdf',b.sha256,b.file_size,b.page_count,JSON.stringify(data),user.user_id,now,now).run();
  return json({material:materialView(await materialAccess(env,b.id,user),true,true)});
 }
 const match=path.match(/^\/materials\/([a-f0-9]{32})(?:\/(pdf|operations|history))?$/);if(!match)fail(404,'見つかりません');
 const [,id,action]=match,row=await materialAccess(env,id,user);
 if(!action&&req.method==='GET')return json({material:materialView(row,admin,url.searchParams.get('edit')==='1'&&admin)});
 if(action==='pdf'&&req.method==='PUT'){
  if(!admin)fail(403,'PDFの追加は管理者だけが行えます');
  if(req.headers.get('x-file-sha256')!==row.sha256||req.headers.has('content-length')&&Number(req.headers.get('content-length'))!==row.file_size)fail(400,'PDFの容量または識別情報が一致しません');
  if(!row.uploaded){
   const reader=req.body?.getReader();if(!reader)fail(400,'PDFがありません');let prefix=new Uint8Array(0),done=false;
   while(prefix.length<5&&!done){const part=await reader.read();done=part.done;if(part.value){const combined=new Uint8Array(prefix.length+part.value.length);combined.set(prefix);combined.set(part.value,prefix.length);prefix=combined}}
   if(new TextDecoder().decode(prefix.slice(0,5))!=='%PDF-'){await reader.cancel();fail(400,'PDFファイルを選択してください')}
   let total=prefix.length;let stream=new ReadableStream({start(controller){controller.enqueue(prefix)},async pull(controller){const part=await reader.read();if(part.done){if(total!==row.file_size)controller.error(Error('PDFの容量が一致しません'));else controller.close();return}total+=part.value.length;if(total>row.file_size){await reader.cancel();controller.error(Error('PDFが大きすぎます'));return}controller.enqueue(part.value)},cancel(){return reader.cancel()}});
   let pipe=Promise.resolve();if(typeof FixedLengthStream==='function'){const sized=new FixedLengthStream(row.file_size);pipe=stream.pipeTo(sized.writable);stream=sized.readable}
   const [result]=await Promise.all([env.MATERIALS_BUCKET.put(row.pdf_key,stream,{sha256:row.sha256,httpMetadata:{contentType:'application/pdf',contentDisposition:'attachment; filename="material.pdf"'}}),pipe]);
   const stored=result||await env.MATERIALS_BUCKET.head(row.pdf_key);if(!stored||stored.size!==row.file_size)fail(409,'PDFを保存できませんでした。再送してください');
   await env.DB.prepare('UPDATE materials SET uploaded=1,updated_at=? WHERE id=?').bind(new Date().toISOString(),id).run();
  }
  return json({material:materialView(await materialAccess(env,id,user),true,true)});
 }
 if(action==='pdf'&&req.method==='GET'){
  if(!row.uploaded)fail(404,'PDFのアップロードが完了していません');const object=await env.MATERIALS_BUCKET.get(row.pdf_key);if(!object)fail(404,'原本PDFが見つかりません');
  return new Response(object.body,{headers:{'Content-Type':'application/pdf','Content-Length':String(object.size),'Content-Disposition':'attachment; filename="material.pdf"'}});
 }
 if(action==='history'&&req.method==='GET'){
  if(!admin)fail(403,'教材の編集履歴は管理者のみです');const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(before)||before<1)fail(400,'履歴の指定が不正です');
  const rows=await env.DB.prepare('SELECT version,action,at FROM material_history WHERE material_id=? AND version<? ORDER BY version DESC LIMIT 51').bind(id,before).all();return json({history:rows.results.slice(0,50),has_more:rows.results.length>50,next_before:rows.results.length>50?rows.results[49].version:null});
 }
 if(action==='operations'&&req.method==='POST'){
  if(!admin)fail(403,'教材の編集・公開は管理者のみです');const b=await materialBody(req);
  if(!b||!validToken(b.op_id)||!Number.isSafeInteger(b.expected)||b.expected<1||!['save','publish','unpublish','archive','restore'].includes(b.action))fail(400,'教材の操作が不正です');
  const data=b.action==='save'?JSON.stringify(materialData(b.data,row.page_count)):'';
  const old=await env.DB.prepare('SELECT * FROM material_operations WHERE actor_id=? AND op_id=?').bind(user.user_id,b.op_id).first();
  if(old&&(old.material_id!==id||old.action!==b.action||old.expected!==b.expected||old.data!==data))fail(400,'操作IDが重複しています');
  try{await env.DB.prepare('INSERT OR IGNORE INTO material_operations VALUES(?,?,?,?,?,?,?,?)').bind(user.user_id,b.op_id,id,b.action,data,b.expected,new Date().toISOString(),1).run()}
  catch(error){if(String(error).includes('version_conflict'))fail(409,'他の画面で教材が更新されました。入力を保存してから最新を読み込んでください');if(String(error).includes('not_ready'))fail(409,'PDFのアップロードを完了し、アーカイブを解除してから公開してください');if(String(error).includes('archived'))fail(409,'先にアーカイブを解除してください');throw error}
  return json({material:materialView(await materialAccess(env,id,user),true,true)});
 }
 fail(404,'見つかりません');
}

async function route(req,env){
 const url=new URL(req.url),path=url.pathname,origin=site(env).origin;
 if(path==='/health')return json({ok:true,version:15,materials_configured:!!env.MATERIALS_BUCKET,features:['review','notes','google-login','account-linking','shared-notes','shared-note-history','materials'],shared_admin_configured:!!String(env.ADMIN_USER_IDS||'').trim(),google_configured:googleReady(env)});
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
 if(path==='/materials'||path.startsWith('/materials/'))return await materialRoute(req,env,url,user);
 if(path==='/auth/google/link'&&req.method==='POST'){const b=await body(req);return json({url:await startGoogle(req,env,b.challenge,user)})}
 if(path==='/me'&&req.method==='GET'){const linked=await env.DB.prepare('SELECT display_login FROM google_identities WHERE user_id=?').bind(uid).first();return json({user_id:uid,login:user.login,expires:user.expires,account:{google_linked:!!linked,google_label:linked?.display_login||'',shared_notes_admin:sharedAdmin(env,uid)}})}
 if(path==='/auth/logout'&&req.method==='POST'){
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(user.token_hash).run();return json({ok:true});
 }
 if(['/shared-notes','/shared-note-operations','/shared-note-history'].includes(path))return await sharedRoute(req,env,url,user);
 if(path==='/notes'&&req.method==='GET'){
  const rows=await env.DB.prepare('SELECT * FROM notes WHERE user_id=?').bind(uid).all();
  return json({notes:rows.results.map(({user_id,...n})=>({...n,target:JSON.parse(n.target)}))});
 }
 if(path==='/note-operations'&&req.method==='POST'){
  const b=await body(req);
  if(!validToken(b.op_id)||!validToken(b.id)||!Number.isSafeInteger(b.expected)||b.expected<0||!['put','delete'].includes(b.action))fail(400,'メモ操作が不正です');
  if(typeof b.body!=='string'||b.body.length>6000||b.action==='put'&&!b.body.trim())fail(400,'メモは1〜6000文字で入力してください');
  const t=validateTarget(b.target);if(b.action==='put'||b.action==='register'||path==='/shared-note-operations')await materialTargetAccess(env,t,user);if(await targetId(t)!==b.id)fail(400,'対象IDが一致しません');
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
  const t=validateTarget(b.target);if(b.action==='put'||b.action==='register'||path==='/shared-note-operations')await materialTargetAccess(env,t,user);if(await targetId(t)!==b.id)fail(400,'対象IDが一致しません');
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
  if(req.method==='OPTIONS')return new Response(null,{status:req.headers.get('origin')===allowed?204:403,headers:{'Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, X-File-SHA256','Access-Control-Max-Age':'600',Vary:'Origin'}});
  let res;try{if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET||!env.DB)fail(503,'認証・保存サービスの設定が必要です');res=await route(req,env)}catch(error){res=json({error:error.status?error.message:'保存サービスでエラーが発生しました'},error.status||500)}
  const headers=new Headers(res.headers);headers.set('Access-Control-Allow-Origin',allowed);headers.set('Vary','Origin');headers.set('Cache-Control','no-store');headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');
  return new Response(res.body,{status:res.status,headers});
 },
 async scheduled(_event,env){const now=Date.now();await env.DB.batch(['sessions','oauth_states','tickets','google_states','google_tickets'].map(t=>env.DB.prepare(`DELETE FROM ${t} WHERE expires<?`).bind(now)))}
};
