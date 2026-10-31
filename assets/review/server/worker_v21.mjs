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

const CLASSIC_PAGES={"No001_p1":"52e7baea","No001_p2":"4aedbf51","No002_p1":"a2240aa4","No002_p2":"c8a79c7b","No003_p1":"0204f1e0","No003_p2":"4ce142d1","No004_p1":"4a4e0733","No004_p2":"fe19a4ee","No005_p1":"14e33a36","No005_p2":"cae11c77","No006_p1":"372c45a7","No006_p2":"bb0f9add","No007_p1":"a4fec55f","No007_p2":"b937048a","No008_p1":"8a489859","No008_p2":"10030bbd","No009_p1":"01dd8e3e","No010_p1":"f5fed1ad","No010_p2":"3c757397","No011_p1":"a8857b40","No011_p2":"7b67479e","No012_p1":"1c299458","No012_p2":"a7e4e218","No013_p1":"82a81c84","No013_p2":"9200f163","No014_p1":"7c118e8b","No014_p2":"3655472b","No014_p3":"8b85c774","No015_p1":"fc4116e6","No015_p2":"ee751738","No016_p1":"4c392242","No016_p2":"690ece13","No017_p1":"86dd6df6","No017_p2":"2b1de971","No018_p1":"142cf93c","No018_p2":"71922b66","No019_p1":"f89173a9","No019_p2":"92eb49c5","No020_p1":"21012536","No020_p2":"cd671bbb","No021_p1":"9f809b1f","No021_p2":"fc93d867","No022_p1":"9826c21d","No022_p2":"f0d0e636","No023_p1":"560410a2","No023_p2":"a3e7d7c7","No024_p1":"61dcd4dd","No024_p2":"878f7aa9","No025_p1":"e712732e","No025_p2":"52becf2f","No026_p1":"5f1ec57e","No026_p2":"f66d72e8","No027_p1":"c54e4350","No027_p2":"0b4af143","No027_p3":"4770249f","No028_p1":"802d97f7","No028_p2":"19c35f98","No029_p1":"a0e6bfaf","No029_p2":"1e897339","No030_p1":"6b3d8cd2","No031_p1":"7fe9487a","No031_p2":"0426b522","No032_p1":"0e6d7ce6","No032_p2":"3a0bd634","No033_p1":"d55143aa","No033_p2":"8d7d56cc","No034_p1":"b2cf5d18","No034_p2":"f3a7bb0c","No034a_p1":"c40659c6","No034a_p2":"4095ae4a","No035_p1":"2f73d1da","No035_p2":"e4834017","No036_p1":"4e25d502","No036_p2":"81c493dc","No037_p1":"d45e4164","No038_p1":"5e066f5e","No038_p2":"391f2db7","No039_p1":"b0497935","No039_p2":"913246fa","No040_p1":"818bae27","No040_p2":"976ae452","No040_answer":"6e803998","05_china_p041":"aacabe6a","05_china_p042":"825bb0f2","05_china_p043":"5c756e6f","No041_p1":"36ab3419","No041_p2":"a967b551","No042_p1":"11144ab9","No042_p2":"65c91a28","No043_p1":"8fa7efc6","No043_p2":"f3f07d0f","No044_p1":"cb4c77f7","No044_p2":"e8450d64","No045_p1":"1b97a4e1","No045_p2":"d7fef2e8","No046_p1":"26b70fc2","No047_p1":"60266f29","No047_p2":"67b8afef","No048_p1":"feb2b0a6","No048_p2":"e742feb0","No049_p1":"51551e8c","No049_p2":"6e99dfc9","No050_p1":"425caff1","No050_p2":"ccd34120","No055_p1":"e9e34a64","No055_p2":"fbb85382","No056_p1":"341c6aa0","No056_p2":"d873f688","No057_p1":"f8cb6efd","No058_p1":"17e7d319","No058_p2":"9ee7aeb8","No059_p1":"f0586110","No059_p2":"916e79d2","No060_p1":"93e52966","No060_p2":"9a7e7e07","No061_p1":"bacabf9f","No061_p2":"740bec38","No062_p1":"4f4d9c0d","No062_p2":"cddcc253","No063_p1":"238686de","No063_p2":"3d6e6af8","No064_p1":"69562c05","No064_p2":"fdd026de","No065_p1":"393f463b","No065_p2":"977a1fd8","No066_p1":"c2b31af5","No066_p2":"a2c73c8a","No067_p1":"8d1fecba","No067_p2":"250f1218","No068_p1":"2f1b7ee4","No068_p2":"8fbca1e9","No069_p1":"41d5ff48","No069_p2":"b172924b","No070_p1":"9e709d9c","No070_p2":"0125eb8c","No071_p1":"970db30f","No071_p2":"3e6cc5fb","No071_p3":"c8305ac8","No072_p1":"3891e8fc","No072_p2":"5c538669","No073_p1":"a59288fe","No073_p2":"c7c14387","No074_p1":"720039d2","No074_p2":"f53f5ccc","No075_p1":"b0c62e2c","No075_p2":"8f97e34e","No076_p1":"7fb13b20","No076_p2":"fe62e6b8","No077_p1":"5fec1295","No077_p2":"1e67d882","No078_p1":"998c1b62","No078_p2":"e0bdc384","No079_p1":"69511d91","No079_p2":"5424cff0","No080_p1":"82c857d8","No080_p2":"50423cda","No081_p1":"c3ef5547","No082_p1":"c459e8c8","No082_p2":"b2043d01","No083_p1":"946945b5","No083_p2":"3006f9f0","No084_p1":"3886579d","No085_p1":"710f685f","No085_p2":"1279c03b","No085_p3":"0c8c7ccb","No086_p1":"614b0155","No086_p2":"a577448a","No087_p1":"dfbe91b6","No087_p2":"c5953e46","No088_p1":"6f27390d","No088_p2":"e82e15cf","No089_p1":"795e1a1a","No089_p2":"d8f5d902","No090_p1":"45ea2108","No090_p2":"3a4780fa","No091_p1":"bc8d7dcb","No091_p2":"3deacc5a","No092_p1":"53d153b8","No092_p2":"60b7b11b","No093_p1":"bba0da8e","No093_p2":"eed256c8","No094_p1":"4c295e9c","No095_p1":"05339a16","No095_p2":"3fead4fc","No096_p1":"3570fea7","No096_p2":"e575501f","No097_p1":"020d6486","No097_p2":"d982c79a","No098_p1":"57a63258","No098_p2":"f2ab5925","No099_p1":"d68abc08","No099_p2":"75b48fcf","No100_p1":"070c259e","No100_p2":"1589a523","No101_p1":"1ddb915b","No101_p2":"d72832aa","No102_p1":"48f8f907","No102_p2":"a5f298b9","No103_p1":"f1d46cc4","No103_p2":"a6ac00f2","No104_p1":"9d3b1446","No105_p1":"93fca7cc","No105_p2":"3d1d5212","No106_p1":"f14fed71","No106_p2":"3504d133","No107_p1":"f080fb45","No107_p2":"6a8c5fd8","No108_p1":"6081d157","No109_p1":"b5bed239","No109_p2":"abfce4a0","No110_p1":"0fd4e6b5","No110_p2":"4cd84cc7","No111_p1":"53f9143f","No111_p2":"a302a07d","No112_p1":"7f1c939a","No112_p2":"043b51dc","No113_p1":"e3724b7c","No113_p2":"121e9c4c","No114_p1":"cb7e440b","No114_p2":"1b88ce78","No115_p1":"d5b55214","No115_p2":"c8c90755","No116_p1":"4b27c50f","No116_p2":"e2a2d383","No117_p1":"ad54bb24","No117_p2":"a3a799f0","No118_p1":"ce480138","No118_p2":"448c11d2","No119_p1":"da4c91d8","No119_p2":"2adfef3c","No120_p1":"2101d1c7","No120_p2":"ff8513fd","No121_p1":"d67beced","No121_p2":"4dbadfd5","No122_p1":"f2659e0e","No122_p2":"f3fe05ed","No123_p1":"664faab4","No123_p2":"067e4c93","No123_p3":"26c37f9d","No123_p4":"12033feb","No124_p1":"c8fab123","No124_p2":"c1942c52","No125_p1":"7f849702","No125_p2":"89a2971d","No126_p1":"3220ed43","No126_p2":"970906bf","No127_p1":"b9965cf9","No127_p2":"9ace21a5","No128_p1":"9ccf96a3","No128_p2":"d32cb00d","No129_p1":"46a1f79a","No129_p2":"14ea39fc","No130_p1":"d20a7a48","No130_p2":"1f3c6ecf","No131_p1":"d73cfd10","No131_p2":"91508109","No132_p1":"632d420b","No132_p2":"2b45b8ac","No133_p1":"e8385282","No133_p2":"27a7b017","No134_p1":"0b51e890","No134_p2":"e0412734","No135_p1":"77e74a65","No135_p2":"990517a4","No135_p3":"e01c91cf","No136_p1":"b84efeab","No136_p2":"b7fb9fe4","No137_p1":"d33cb916","No137_p2":"f218dbc5","No138_p1":"aee80dd5","No138_p2":"2469b011","No139_p1":"1d39ea02","No139_p2":"1d99f864","No140_p1":"49c867c6","No140_p2":"0f1bc7f9","No141_p1":"de8a165b","No141_p2":"8acc3d5f","No141_p3":"501da32d","No141_p4":"ecaa014e","No142_p1":"fd5a64a9","No142_p2":"3de5df56","No143_p1":"a51fd5b3","No143_p2":"ddfbd6e6","No144_p1":"44a16157","No144_p2":"490ef84d","No145_p1":"972a1425","No145_p2":"36fcceb5","No146_p1":"931e0b96","No146_p2":"7bfdac19","No147_p1":"49ae281d","No147_p2":"a4bfdbd6","No148_p1":"16ea1e19","No148_p2":"4a29aa42","No149_p1":"4b8a7ddb","No149_p2":"c5f22ebd","No150_p1":"1ab2800c","No150_p2":"6964ff0d","No151_p1":"eebe960e","No151_p2":"d51f6e7a","No152_p1":"faecca21","No152_p2":"ed0944af","No153_p1":"5771cf4c","No153_p2":"5c176073","No153_p3":"8da43b57","No154_p1":"c7df191e","No154_p2":"8c4bc8f1","No154_p3":"cdf3475a","No155_p1":"e6dc5fa9","No155_p2":"45c3a9b6","No156_p1":"e17cae4b","No156_p2":"f20a201e","No156_p3":"a99bd872","No157_p1":"9dec0fff","No157_p2":"7e91eed4","No158_p1":"969ebd33","No158_p2":"2cccc8b0","No159_p1":"98398059","No159_p2":"5628a176","No160_p1":"8f6da2cd","No160_p2":"98e39982","No161_p1":"da781190","No161_p2":"e4d8ed44","No161_p3":"f2fafc78","No161_p4":"b14d7f81","No162_p1":"c2e9f103","No162_p2":"7e3baa7f","No163_p1":"05b4846b","No163_p2":"8e94a0f1","No164_p1":"dbd61060","No164_p2":"03ecf840","No165_p1":"15030ec6","No165_p2":"cf0eaada","No166_p1":"7af41577","No166_p2":"b43a8f17","No166_p3":"c1bb77c7","No167_p1":"74a5b7b4","No167_p2":"06f7d8ef","No167_p3":"b765b3c7","No168_p1":"a8a638e7","No168_p2":"a0f458ec","No169_p1":"5d624ec0","No169_p2":"0383eeca","No170_p1":"bb325d25","No170_p2":"8455d82f","No171_p1":"29d87568","No171_p2":"bc7b1bb6","No171_p3":"3e2de303","No171_p4":"6ef6feb2","No171_p5":"e5f9d3a8","No171_p6":"28bd90e3","No172_p1":"2f43e6f3","No172_p2":"31030b32","No172_p3":"f8b1c012","No173_p1":"1559c406","No173_p2":"54506161","No173_p3":"7030816b","No173_p4":"3c7509e1","No173_p5":"6b1d2099","No173_p6":"1fee707a","No173_p7":"c5f328d4","No174_p1":"a8b3aaa7","No174_p2":"b5cf0390","No174_p3":"f0c654df","No175_p1":"81783b35","No175_p2":"4e0b7195","No175_p3":"2b6c69fc","No175_p4":"c33931bf","No176_p1":"83ab65dd","No176_p2":"7d03c70e","No177_p1":"f366a443","No177_p2":"19237520","No177_p3":"0f956577","No178_p1":"c7a62bcf","No178_p2":"24b9d657","No178_p3":"9df2d963","No180_p1":"204c2609","No180_p2":"4f57dbc1","No180_p3":"d11ae8d3","No180_p4":"31b0e705","No179_p1":"732d40e6","No179_p2":"cc279dd0","No179_p3":"6ccda674","No179_p4":"b277d761","No179_p5":"4106d722","No179_p6":"a7228896","No179_p7":"aa037124","No179_p8":"45d286e5","No179_p9":"1277ad42","No179_p10":"e73ba496","No179_p11":"0ca099c8","No181_p1":"516a50db","No181_p2":"75505727","No181_p3":"ab93a73c","No181_p4":"75fb19f5","No181_p5":"3c727a2f","No181_p6":"e761f462","No181_p7":"135bbc11","No181_p8":"126a9725","No181_p9":"af558ab4","No181_p10":"4d34c05e","No181_p11":"f444988b","No181_p12":"ea1ff0f1","No181_p13":"f8961552","No181_p14":"845b8ace","No181_p15":"80207136","No181_p16":"a7ad7f5a","No181_p17":"83e17798","No181_p18":"a5b1ff81","No181_p19":"11881798","No181_p20":"cc27cd15","No182_p1":"cef2787d","No183_p1":"ab28e968"};
const CLASSIC_UNITS={"No001_p1":0,"No001_p2":0,"No002_p1":0,"No002_p2":0,"No003_p1":0,"No003_p2":0,"No004_p1":0,"No004_p2":0,"No005_p1":0,"No005_p2":0,"No006_p1":0,"No006_p2":0,"No007_p1":0,"No007_p2":0,"No008_p1":0,"No008_p2":0,"No009_p1":0,"No010_p1":1,"No010_p2":1,"No011_p1":1,"No011_p2":1,"No012_p1":1,"No012_p2":1,"No013_p1":1,"No013_p2":1,"No014_p1":1,"No014_p2":1,"No014_p3":1,"No015_p1":1,"No015_p2":1,"No016_p1":2,"No016_p2":2,"No017_p1":2,"No017_p2":2,"No018_p1":2,"No018_p2":2,"No019_p1":3,"No019_p2":3,"No020_p1":3,"No020_p2":3,"No021_p1":3,"No021_p2":3,"No022_p1":4,"No022_p2":4,"No023_p1":4,"No023_p2":4,"No024_p1":4,"No024_p2":4,"No025_p1":4,"No025_p2":4,"No026_p1":4,"No026_p2":4,"No027_p1":4,"No027_p2":4,"No027_p3":4,"No028_p1":4,"No028_p2":4,"No029_p1":4,"No029_p2":4,"No030_p1":4,"No031_p1":4,"No031_p2":4,"No032_p1":4,"No032_p2":4,"No033_p1":4,"No033_p2":4,"No034_p1":4,"No034_p2":4,"No034a_p1":4,"No034a_p2":4,"No035_p1":4,"No035_p2":4,"No036_p1":4,"No036_p2":4,"No037_p1":4,"No038_p1":4,"No038_p2":4,"No039_p1":4,"No039_p2":4,"No040_p1":4,"No040_p2":4,"No040_answer":4,"05_china_p041":4,"05_china_p042":4,"05_china_p043":4,"No041_p1":5,"No041_p2":5,"No042_p1":5,"No042_p2":5,"No043_p1":5,"No043_p2":5,"No044_p1":5,"No044_p2":5,"No045_p1":5,"No045_p2":5,"No046_p1":5,"No047_p1":6,"No047_p2":6,"No048_p1":6,"No048_p2":6,"No049_p1":6,"No049_p2":6,"No050_p1":6,"No050_p2":6,"No055_p1":6,"No055_p2":6,"No056_p1":6,"No056_p2":6,"No057_p1":6,"No058_p1":6,"No058_p2":6,"No059_p1":6,"No059_p2":6,"No060_p1":6,"No060_p2":6,"No061_p1":6,"No061_p2":6,"No062_p1":6,"No062_p2":6,"No063_p1":6,"No063_p2":6,"No064_p1":6,"No064_p2":6,"No065_p1":6,"No065_p2":6,"No066_p1":6,"No066_p2":6,"No067_p1":6,"No067_p2":6,"No068_p1":6,"No068_p2":6,"No069_p1":6,"No069_p2":6,"No070_p1":7,"No070_p2":7,"No071_p1":7,"No071_p2":7,"No071_p3":7,"No072_p1":7,"No072_p2":7,"No073_p1":7,"No073_p2":7,"No074_p1":7,"No074_p2":7,"No075_p1":7,"No075_p2":7,"No076_p1":7,"No076_p2":7,"No077_p1":7,"No077_p2":7,"No078_p1":7,"No078_p2":7,"No079_p1":7,"No079_p2":7,"No080_p1":7,"No080_p2":7,"No081_p1":7,"No082_p1":8,"No082_p2":8,"No083_p1":8,"No083_p2":8,"No084_p1":8,"No085_p1":9,"No085_p2":9,"No085_p3":9,"No086_p1":10,"No086_p2":10,"No087_p1":10,"No087_p2":10,"No088_p1":10,"No088_p2":10,"No089_p1":10,"No089_p2":10,"No090_p1":10,"No090_p2":10,"No091_p1":10,"No091_p2":10,"No092_p1":10,"No092_p2":10,"No093_p1":10,"No093_p2":10,"No094_p1":10,"No095_p1":10,"No095_p2":10,"No096_p1":10,"No096_p2":10,"No097_p1":10,"No097_p2":10,"No098_p1":10,"No098_p2":10,"No099_p1":10,"No099_p2":10,"No100_p1":10,"No100_p2":10,"No101_p1":10,"No101_p2":10,"No102_p1":10,"No102_p2":10,"No103_p1":10,"No103_p2":10,"No104_p1":10,"No105_p1":11,"No105_p2":11,"No106_p1":11,"No106_p2":11,"No107_p1":11,"No107_p2":11,"No108_p1":11,"No109_p1":12,"No109_p2":12,"No110_p1":12,"No110_p2":12,"No111_p1":12,"No111_p2":12,"No112_p1":12,"No112_p2":12,"No113_p1":12,"No113_p2":12,"No114_p1":12,"No114_p2":12,"No115_p1":13,"No115_p2":13,"No116_p1":13,"No116_p2":13,"No117_p1":13,"No117_p2":13,"No118_p1":13,"No118_p2":13,"No119_p1":13,"No119_p2":13,"No120_p1":13,"No120_p2":13,"No121_p1":13,"No121_p2":13,"No122_p1":13,"No122_p2":13,"No123_p1":13,"No123_p2":13,"No123_p3":13,"No123_p4":13,"No124_p1":14,"No124_p2":14,"No125_p1":14,"No125_p2":14,"No126_p1":14,"No126_p2":14,"No127_p1":15,"No127_p2":15,"No128_p1":15,"No128_p2":15,"No129_p1":15,"No129_p2":15,"No130_p1":16,"No130_p2":16,"No131_p1":16,"No131_p2":16,"No132_p1":16,"No132_p2":16,"No133_p1":16,"No133_p2":16,"No134_p1":16,"No134_p2":16,"No135_p1":16,"No135_p2":16,"No135_p3":16,"No136_p1":17,"No136_p2":17,"No137_p1":17,"No137_p2":17,"No138_p1":17,"No138_p2":17,"No139_p1":18,"No139_p2":18,"No140_p1":18,"No140_p2":18,"No141_p1":18,"No141_p2":18,"No141_p3":18,"No141_p4":18,"No142_p1":18,"No142_p2":18,"No143_p1":18,"No143_p2":18,"No144_p1":18,"No144_p2":18,"No145_p1":18,"No145_p2":18,"No146_p1":18,"No146_p2":18,"No147_p1":18,"No147_p2":18,"No148_p1":19,"No148_p2":19,"No149_p1":19,"No149_p2":19,"No150_p1":19,"No150_p2":19,"No151_p1":19,"No151_p2":19,"No152_p1":19,"No152_p2":19,"No153_p1":19,"No153_p2":19,"No153_p3":19,"No154_p1":20,"No154_p2":20,"No154_p3":20,"No155_p1":20,"No155_p2":20,"No156_p1":20,"No156_p2":20,"No156_p3":20,"No157_p1":21,"No157_p2":21,"No158_p1":21,"No158_p2":21,"No159_p1":21,"No159_p2":21,"No160_p1":21,"No160_p2":21,"No161_p1":21,"No161_p2":21,"No161_p3":21,"No161_p4":21,"No162_p1":21,"No162_p2":21,"No163_p1":21,"No163_p2":21,"No164_p1":22,"No164_p2":22,"No165_p1":22,"No165_p2":22,"No166_p1":22,"No166_p2":22,"No166_p3":22,"No167_p1":23,"No167_p2":23,"No167_p3":23,"No168_p1":23,"No168_p2":23,"No169_p1":24,"No169_p2":24,"No170_p1":24,"No170_p2":24,"No171_p1":24,"No171_p2":24,"No171_p3":24,"No171_p4":24,"No171_p5":24,"No171_p6":24,"No172_p1":25,"No172_p2":25,"No172_p3":25,"No173_p1":25,"No173_p2":25,"No173_p3":25,"No173_p4":25,"No173_p5":25,"No173_p6":25,"No173_p7":25,"No174_p1":26,"No174_p2":26,"No174_p3":26,"No175_p1":26,"No175_p2":26,"No175_p3":26,"No175_p4":26,"No176_p1":27,"No176_p2":27,"No177_p1":27,"No177_p2":27,"No177_p3":27,"No178_p1":27,"No178_p2":27,"No178_p3":27,"No180_p1":27,"No180_p2":27,"No180_p3":27,"No180_p4":27,"No179_p1":28,"No179_p2":28,"No179_p3":28,"No179_p4":28,"No179_p5":28,"No179_p6":28,"No179_p7":28,"No179_p8":28,"No179_p9":28,"No179_p10":28,"No179_p11":28,"No181_p1":29,"No181_p2":29,"No181_p3":29,"No181_p4":29,"No181_p5":29,"No181_p6":29,"No181_p7":29,"No181_p8":29,"No181_p9":29,"No181_p10":29,"No181_p11":29,"No181_p12":29,"No181_p13":29,"No181_p14":29,"No181_p15":29,"No181_p16":29,"No181_p17":29,"No181_p18":29,"No181_p19":29,"No181_p20":29,"No182_p1":30,"No183_p1":31};
const classicHash=s=>{let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0')};
const classicStable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const classicNorm=(r,p)=>[r[0]/p.width,r[1]/p.height,r[2]/p.width,r[3]/p.height].map(v=>Math.round(v*1e6)/1e6);
const classicPixels=(r,p)=>[r[0]*p.width,r[1]*p.height,r[2]*p.width,r[3]*p.height];
function classicNativeItems(p,pages){
 const greens=(p.greenHide||[]).map((r,i)=>({ref:'g_'+classicHash(classicStable([i,r])),kind:'green',rect:classicNorm([r.x,r.y,r.width,r.height],p),enabled:true}));
 const pairs=new Map();for(const q of pages.flatMap(x=>x.numberPairs||[]))if(q.bodyPageKey===p.key)pairs.set(q.id||classicStable(q),q);
 const orange=[...pairs.values()].map(q=>({ref:'o_'+classicHash(classicStable(q)),kind:'orange',rect:classicNorm(q.body,p),text:String(q.answerText||''),font_size:Number(q.fontSize)||32,enabled:true}));return [...greens,...orange].filter(n=>n.rect.every(v=>v>=0)&&n.rect[2]>0&&n.rect[3]>0&&n.rect[0]+n.rect[2]<=1.000001&&n.rect[1]+n.rect[3]<=1.000001);
}
const classicRevision=(p,pages)=>classicHash(classicStable([p.key,p.width,p.height,p.base,p.baseOff||'',p.hide,p.hideResolved||[],classicNativeItems(p,pages)]));


// Read only trusted, published source files. New pages need no per-page Worker registration.
const classicSourceCache=new Map();
async function classicSourceJSON(url,html=false){
 const old=classicSourceCache.get(url),now=Date.now();if(old&&old.until>now)return old.value;
 const response=await fetch(url,{redirect:'manual',cf:{cacheTtl:60,cacheEverything:true}});
 if(!response.ok)fail(503,'GitHub側のページ情報を取得できません。少し待って再試行してください');
 const text=await response.text();if(text.length>8000000)fail(503,'ページ情報が大きすぎます');
 let value;try{value=JSON.parse(html?text.match(/const PAGES\s*=\s*(\[.*?\]);/s)[1]:text)}catch{fail(503,'GitHub側のページ情報を読み取れません')}
 classicSourceCache.set(url,{value,until:now+60000});return value;
}
async function classicRegistry(env,keys){
 const pages={...CLASSIC_PAGES},units={...CLASSIC_UNITS},base=site(env);
 const manifest=await classicSourceJSON(new URL('manifest.json',base).href);
 if(!Array.isArray(manifest.ranges))fail(503,'ページ一覧を読み取れません');
 const selected=new Map();
 for(const key of keys){const match=/^No(\d+)[a-z]?_/.exec(key);if(!match)continue;const no=Number(match[1]);for(const range of manifest.ranges)if(no>=range.start&&no<=range.end){
  if(typeof range.file!=='string'||!/^pages\/[^?#]+\.html$/.test(range.file)||range.file.includes('..'))fail(503,'ページ一覧が不正です');
  selected.set(range.file,range);
 }}
 for(const [file]of selected){
  const source=await classicSourceJSON(new URL(encodeURI(file),base).href,true);
  if(!Array.isArray(source)||source.length>1000)fail(503,'ページ情報が不正です');
  for(const p of source){if(!p||!/^No[0-9]+[a-z]?_[A-Za-z0-9_-]+$/.test(p.key))continue;pages[p.key]=classicRevision(p,source);units[p.key]=file}
 }
 return {pages,units};
}

function classicData(d,page,registry){
 const CLASSIC_PAGES=registry.pages,CLASSIC_UNITS=registry.units;
 if(!d||d.fingerprint!==CLASSIC_PAGES[page]||!Array.isArray(d.native)||d.native.length>1500)fail(409,'古プリ本体が更新されています。原本に合わせて編集を確認してください');
 if(!Array.isArray(d.annotations))fail(400,'追加項目が不正です');const annotations=materialData({title:'古プリ',subject:'世界史',folder:'',annotations:d.annotations.map(a=>({...a,kind:a.kind==='white-cover'?'red-mask':a.kind}))},1).annotations.map((a,i)=>({...a,kind:d.annotations[i].kind==='white-cover'?'white-cover':a.kind,...(a.kind==='text'?{cover:d.annotations[i].cover===true}:{})}));
 const refs=new Set(),native=d.native.map(n=>{if(!n||!/^([go])_[a-f0-9]{8}$/.test(n.ref)||refs.has(n.ref)||!['green','orange'].includes(n.kind)||n.ref[0]!==({green:'g',orange:'o'}[n.kind])||typeof n.enabled!=='boolean')fail(400,'元の項目が不正です');refs.add(n.ref);
 const a=materialData({title:'古プリ',subject:'世界史',folder:'',annotations:[{id:n.ref,page:1,kind:'green-mask',rect:n.rect}]},1).annotations[0];const v={ref:n.ref,kind:n.kind,enabled:n.enabled,rect:a.rect};if(n.kind==='orange'){if(typeof n.text!=='string'||n.text.length>500||!Number.isFinite(n.font_size)||n.font_size<4||n.font_size>512)fail(400,'元のオレンジ文字が不正です');Object.assign(v,{text:n.text,font_size:n.font_size})}return v});

 const rect=r=>materialData({title:'古プリ',subject:'世界史',folder:'',annotations:[{id:'r',page:1,kind:'green-mask',rect:r}]},1).annotations[0].rect;
 const answer=(n,v)=>{if(n.answer_page!==undefined){if(!CLASSIC_PAGES[n.answer_page]||CLASSIC_UNITS[n.answer_page]!==CLASSIC_UNITS[page])fail(400,'解答は同じ単元のページを選んでください');v.answer_page=n.answer_page;v.answer_rect=rect(n.answer_rect)}};
 native.forEach((v,i)=>{const n=d.native[i];answer(n,v);if(v.kind==='green'&&n.color!==undefined){if(typeof n.color!=='string'||!/^#[a-fA-F0-9]{6}$/.test(n.color))fail(400,'遮蔽色が不正です');v.color=n.color}});
 annotations.forEach((v,i)=>{const a=d.annotations[i];if(v.kind==='green-mask'&&a.color!==undefined){if(typeof a.color!=='string'||!/^#[a-fA-F0-9]{6}$/.test(a.color))fail(400,'遮蔽色が不正です');v.color=a.color}});
 const extra={};if(d.regions!==undefined){if(!d.regions||!Array.isArray(d.regions.hide)||!Array.isArray(d.regions.keep)||d.regions.hide.length>1500||d.regions.keep.length>1500)fail(400,'赤文字の領域が不正です');extra.regions={hide:d.regions.hide.map(rect),keep:d.regions.keep.map(rect)}}
 if(d.pairs!==undefined){if(!Array.isArray(d.pairs)||d.pairs.length>500)fail(400,'番号対応が多すぎます');const ids=new Set();extra.pairs=d.pairs.map(n=>{if(!n||typeof n.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(n.id)||ids.has(n.id)||typeof n.text!=='string'||!n.text.trim()||n.text.length>500||typeof n.enabled!=='boolean'||!Number.isFinite(n.font_size)||n.font_size<4||n.font_size>512||n.answer_page===undefined)fail(400,'番号対応が不正です');ids.add(n.id);const v={id:n.id,text:n.text,font_size:n.font_size,enabled:n.enabled,body_rect:rect(n.body_rect)};answer(n,v);return v})}
 const v={fingerprint:d.fingerprint,annotations,native,...extra};if(encoder.encode(JSON.stringify(v)).length>240000)fail(413,'編集内容が多すぎます');return v;
}
async function classicRoute(req,env,url){
 if(req.headers.get('origin')!==site(env).origin)fail(403,'許可されていない接続元です');
 const requested=url.pathname==='/classic-edits/_unit'?(url.searchParams.get('pages')||'').split(','):[url.pathname.split('/')[2]];
 if(!requested.length||requested.length>100||requested.some(k=>typeof k!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(k)))fail(400,'ページ指定が不正です');
 const registry=await classicRegistry(env,requested),CLASSIC_PAGES=registry.pages;
 if(url.pathname==='/classic-edits/_unit'&&req.method==='GET'){const keys=[...new Set((url.searchParams.get('pages')||'').split(','))];if(!keys.length||keys.length>100||keys.some(k=>!CLASSIC_PAGES[k]))fail(400,'ページ指定が不正です');const rows=await env.DB.prepare('SELECT page_key,published FROM classic_edits WHERE published IS NOT NULL AND page_key IN ('+keys.map(()=>'?').join(',')+')').bind(...keys).all();return json({pages:rows.results.map(r=>({page_key:r.page_key,data:JSON.parse(r.published)}))})}
 const m=url.pathname.match(/^\/classic-edits\/([A-Za-z0-9_-]{1,100})(?:\/(operations|history))?$/);if(!m||!CLASSIC_PAGES[m[1]])fail(404,'古プリのページが見つかりません');const [,key,action]=m;
 if(req.method==='GET'&&!action&&url.searchParams.get('edit')!=='1'){const row=await env.DB.prepare('SELECT published,published_at FROM classic_edits WHERE page_key=?').bind(key).first();return json({page_key:key,data:row?.published?JSON.parse(row.published):null,published_at:row?.published_at||null})}
 const user=await authenticate(req,env);if(!sharedAdmin(env,user.user_id))fail(403,'古プリの編集・公開は管理者のみです');
 const view=row=>({page_key:key,version:row?.version||0,draft:row?.draft&&row.draft!=='null'?JSON.parse(row.draft):null,published:row?.published?JSON.parse(row.published):null,is_admin:true});
 if(req.method==='GET'&&!action)return json(view(await env.DB.prepare('SELECT * FROM classic_edits WHERE page_key=?').bind(key).first()));
 if(req.method==='GET'&&action==='history'){const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(before)||before<1)fail(400,'履歴の指定が不正です');const rows=await env.DB.prepare('SELECT version,action,at FROM classic_edit_history WHERE page_key=? AND version<? ORDER BY version DESC LIMIT 51').bind(key,before).all();return json({history:rows.results.slice(0,50),next_before:rows.results.length>50?rows.results[49].version:null})}
 if(req.method==='POST'&&action==='operations'){
  const b=await materialBody(req);if(!validToken(b.op_id)||!Number.isSafeInteger(b.expected)||b.expected<0||!['save','publish','unpublish'].includes(b.action))fail(400,'古プリの編集操作が不正です');
  const data=b.action==='save'?JSON.stringify(classicData(b.data,key,registry)):'';const old=await env.DB.prepare('SELECT * FROM classic_edit_operations WHERE actor_id=? AND op_id=?').bind(user.user_id,b.op_id).first();if(old&&(old.page_key!==key||old.action!==b.action||old.expected!==b.expected||old.data!==data))fail(400,'操作IDが重複しています');
  const now=new Date().toISOString();await env.DB.prepare("INSERT OR IGNORE INTO classic_edits(page_key,draft,updated_at) VALUES(?,'null',?)").bind(key,now).run();
  try{await env.DB.prepare('INSERT OR IGNORE INTO classic_edit_operations VALUES(?,?,?,?,?,?,?,?)').bind(user.user_id,b.op_id,key,b.action,data,b.expected,now,1).run()}catch(e){if(String(e).includes('version_conflict'))fail(409,'他の画面で更新されました。入力を書き出し、最新の下書きを読み直してください');if(String(e).includes('draft_required'))fail(409,'先に下書きを保存してください');throw e}
  return json(view(await env.DB.prepare('SELECT * FROM classic_edits WHERE page_key=?').bind(key).first()));
 }
 fail(404,'見つかりません');
}


export function validateCorrection(input){
 const t=validateTarget(input.target);
 if(t.kind!=='word'||t.material||!Object.hasOwn(CLASSIC_PAGES,t.page)||(/^No[0-9]{3}/.test(t.page)&&Number(t.page.slice(2,5))!==t.no))fail(400,'古プリの文字を選択してください');
 if(typeof input.text!=='string'||!input.text.trim()||input.text.length>1000||!Number.isSafeInteger(input.expected)||input.expected<0)fail(400,'修正文字と保存状態を確認してください');
 return {target:t,text:input.text.trim(),expected:input.expected};
}
const correctionView=r=>({id:r.id,page:r.page,no:r.no,rect:JSON.parse(r.rect),text:r.text,original:r.original,version:r.version,updated_at:r.updated_at});
async function correctionRoute(req,env,url,user){
 if(req.method==='GET'){
  const after=url.searchParams.get('after')||'';if(after&&!validToken(after))fail(400,'続きの指定が不正です');
  const {results}=await env.DB.prepare('SELECT * FROM ocr_corrections WHERE id>? ORDER BY id LIMIT 501').bind(after).all();
  return json({corrections:results.slice(0,500).map(correctionView),next:results.length>500?results[499].id:null});
 }
 if(req.method!=='POST')fail(405,'対応していない操作です');
 const {target:t,text,expected}=validateCorrection(await body(req));
 const id=await hash(JSON.stringify([t.page,t.rect])),now=new Date().toISOString();
 // One atomic compare-and-swap; a stale tab cannot overwrite a newer correction.
 const row=expected===0
  ? await env.DB.prepare('INSERT INTO ocr_corrections(id,page,no,rect,text,original,version,updated_at,updated_by) VALUES(?,?,?,?,?,?,1,?,?) ON CONFLICT(id) DO NOTHING RETURNING *').bind(id,t.page,t.no,JSON.stringify(t.rect),text,t.text,now,user.user_id).first()
  : await env.DB.prepare('UPDATE ocr_corrections SET text=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=? RETURNING *').bind(text,now,user.user_id,id,expected).first();
 if(!row){
  const existing=await env.DB.prepare('SELECT text,version FROM ocr_corrections WHERE id=?').bind(id).first();
  if(existing?.text===text&&existing.version===expected+1){const saved=await env.DB.prepare('SELECT * FROM ocr_corrections WHERE id=?').bind(id).first();return json({correction:correctionView(saved)})}
  fail(409,'別の画面で文字が修正されました。閉じて開き直してから修正してください');
 }
 return json({correction:correctionView(row)});
}

async function route(req,env){
 const url=new URL(req.url),path=url.pathname,origin=site(env).origin;
 if(path.startsWith('/classic-edits/'))return await classicRoute(req,env,url);
 if(path==='/ocr-corrections'&&req.method==='GET')return correctionRoute(req,env,url,null);
 if(path==='/health')return json({ok:true,version:22,materials_configured:!!env.MATERIALS_BUCKET,features:['ocr-corrections','review','notes','google-login','account-linking','shared-notes','shared-note-history','materials','classic-editing','review-sequence','classic-correction-mode'],shared_admin_configured:!!String(env.ADMIN_USER_IDS||'').trim(),google_configured:googleReady(env)});
 if(path==='/auth/google/start'&&req.method==='GET')return Response.redirect(await startGoogle(req,env,url.searchParams.get('challenge')),302);
 if(path==='/auth/google/callback'&&req.method==='GET')return googleCallback(req,env,url);
 if(path==='/auth/start'&&req.method==='GET'){
  if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET)fail(503,'GitHubログインは未設定です。Googleでログインしてください');
  const challenge=url.searchParams.get('challenge');if(!validToken(challenge))fail(400,'認証情報が不正です');
  const state=random(),verifier=random();
  await env.DB.prepare('INSERT INTO oauth_states VALUES(?,?,?,?)').bind(await hash(state),challenge,verifier,Date.now()+600000).run();
  const u=new URL('https://github.com/login/oauth/authorize');
  for(const [k,v]of Object.entries({client_id:env.GITHUB_CLIENT_ID,redirect_uri:new URL('/auth/callback',req.url).href,state,scope:'',code_challenge:await hash(verifier),code_challenge_method:'S256'}))u.searchParams.set(k,v);
  return Response.redirect(u.href,302);
 }
 if(path==='/auth/callback'&&req.method==='GET'){
  if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET)fail(503,'GitHubログインは未設定です。Googleでログインしてください');
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
 if(path==='/auth/providers'&&req.method==='GET')return json({github:!!(env.GITHUB_CLIENT_ID&&env.GITHUB_CLIENT_SECRET),google:googleReady(env)});
 if(path==='/auth/exchange'&&req.method==='POST'){
  const b=await body(req);if(!validToken(b.ticket)||!validToken(b.verifier))fail(400,'認証情報が不正です');
  const row=await env.DB.prepare('DELETE FROM tickets WHERE ticket_hash=? AND challenge=? AND expires>? RETURNING *').bind(await hash(b.ticket),await hash(b.verifier),Date.now()).first();
  const identity=row?{...row,provider:'github'}:await exchangeGoogle(env,b.ticket,b.verifier);
  const token=random(),expires=Date.now()+30*86400000;
  await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hash(token),identity.user_id,identity.login,expires).run();
  return json({token,user_id:identity.user_id,login:identity.login,expires,provider:identity.provider});
 }
 const user=await authenticate(req,env),uid=user.user_id;
 if(path==='/ocr-corrections')return correctionRoute(req,env,url,user);
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
  let res;try{if(!env.DB)fail(503,'保存データベースの設定が必要です');res=await route(req,env)}catch(error){res=json({error:error.status?error.message:'保存サービスでエラーが発生しました'},error.status||500)}
  const headers=new Headers(res.headers);headers.set('Access-Control-Allow-Origin',allowed);headers.set('Vary','Origin');headers.set('Cache-Control','no-store');headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');
  return new Response(res.body,{status:res.status,headers});
 },
 async scheduled(_event,env){const now=Date.now();await env.DB.batch(['sessions','oauth_states','tickets','google_states','google_tickets'].map(t=>env.DB.prepare(`DELETE FROM ${t} WHERE expires<?`).bind(now)))}
};

