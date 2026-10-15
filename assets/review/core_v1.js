import {API_URL} from './config_v1.js';
export const rootURL=new URL('../../',import.meta.url);
const enc=new TextEncoder();
export const base64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const random=()=>base64(crypto.getRandomValues(new Uint8Array(32)));
export const hash=async s=>base64(await crypto.subtle.digest('SHA-256',enc.encode(s)));
export const targetId=t=>hash(JSON.stringify([t.kind,t.kind==='print'?t.no:t.page,t.color,t.kind==='print'||t.kind==='page'?[]:t.rect,t.color==='black'?t.text:'']));
export const canonical=t=>({...t,rect:t.rect.map(v=>Math.round(v*1e6)/1e6)});
export const formatDate=s=>s?new Date(s).toLocaleString('ja-JP'):'未復習';
export function project(base,queue){
 const map=new Map(base.map(e=>[e.id,structuredClone(e)]));
 for(const op of queue){let e=map.get(op.id);if(op.action==='register'){
  e=e||{id:op.id,target:op.target,created_at:null,review_count:0,version:0};e.state='todo';e.deleted=0;e.completed_at=null;
 }else if(!e)continue;
 else if(op.action==='complete'&&e.state==='todo'){e.state='done';e.review_count++;e.last_reviewed_at=null;e.completed_at=null}
 else if(op.action==='reopen'){e.state='todo';e.completed_at=null}
 else if(op.action==='delete')e.deleted=1;
 e.version++;e.pending=true;map.set(op.id,e);
 }return [...map.values()];
}
let dbPromise;
function database(){return dbPromise||=(new Promise((resolve,reject)=>{const r=indexedDB.open('kopuri-review-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('端末内の未送信データを保存できません'))}));}
export async function read(key){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('kv','readonly'),r=tx.objectStore('kv').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});}
export async function change(key,fn){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('kv','readwrite'),s=tx.objectStore('kv'),r=s.get(key);let value;r.onsuccess=()=>{try{value=fn(r.result);if(value===undefined)s.delete(key);else s.put(value,key)}catch(e){tx.abort();reject(e)}};tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('端末内保存に失敗しました'))});}
const events=new EventTarget();
let auth=null,base=[],queue=[],status='ログインしてください',syncing=false,conflict=false;
let channel;try{channel=new BroadcastChannel('kopuri-review-v1');channel.onmessage=()=>reload().then(()=>flush()).catch(showError)}catch{}
function emit(){events.dispatchEvent(new Event('change'));}
export const subscribe=fn=>{events.addEventListener('change',fn);return()=>events.removeEventListener('change',fn)};
export const state=()=>({auth,entries:project(base,queue),queue,status,conflict,configured:!!API_URL});
function showError(e){status=e.message||String(e);emit();}
async function reload(){const next=await read('auth'),d=next?await read('user:'+next.user_id):null,latest=await read('auth');if(next?.token!==latest?.token)return reload();auth=next;base=d?.base||[];queue=d?.queue||[];emit();}
async function api(path,options={},session=auth){
 if(!API_URL)throw Error('同期サービスは未設定です');
 const response=await fetch(API_URL.replace(/\/$/,'')+path,{...options,headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.token}:{}),...options.headers},signal:AbortSignal.timeout(20000)});
 const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'通信に失敗しました'),{status:response.status});return data;
}
export async function login(){
 if(!API_URL)throw Error('同期サービスの外部設定が必要です。設定手順を確認してください');
 const verifier=random();sessionStorage.setItem('kopuri-review-verifier',verifier);
 const destination=new URL(location.href);if(destination.origin===rootURL.origin&&destination.pathname.startsWith(rootURL.pathname))sessionStorage.setItem('kopuri-review-return',destination.href);
 location.assign(API_URL.replace(/\/$/,'')+'/auth/start?challenge='+await hash(verifier));
}
export async function logout(){
 if(queue.length)throw Error('未送信の変更があります。保存・競合解決を終えてからログアウトしてください');
 const uid=auth.user_id;await api('/auth/logout',{method:'POST',body:'{}'});await change('user:'+uid,()=>undefined);await change('auth',()=>undefined);auth=null;base=[];queue=[];status='ログアウトしました。サーバーの記録は保持されています';channel?.postMessage('logout');emit();
}
export async function refresh(){
 if(!auth)return;
 const session=auth;status='同期中…';emit();
 try{const [me,data]=await Promise.all([api('/me',{},session),api('/entries',{},session)]);
  if(auth?.token!==session.token)return;
  if(me.user_id!==session.user_id)throw Error('アカウント情報が一致しません');
  await change('user:'+session.user_id,d=>{const merged=new Map(data.entries.map(e=>[e.id,e]));for(const e of d?.base||[]){if(!merged.has(e.id)||merged.get(e.id).version<e.version)merged.set(e.id,e)}return {...d,base:[...merged.values()]}});await reload();status=conflict?'別端末の更新と競合しています。復習管理で確認してください':queue.length?'未送信 '+queue.length+'件':'サーバー保存済み';emit();
 }catch(e){if(auth?.token!==session.token)return;status=e.status===401?'ログインの有効期限が切れました。再ログインしてください':'同期失敗：'+e.message+'（未送信の変更はこの端末に保持）';emit();}
}
export async function act(action,target){
 if(!auth)throw Error('先にログインしてください');
 target=canonical(target);const id=await targetId(target),uid=auth.user_id;
 await change('user:'+uid,d=>{
  d=d||{base:[],queue:[]};const projected=project(d.base||[],d.queue||[]),e=projected.find(e=>e.id===id);
  if((d.queue||[]).some(o=>o.id===id))throw Error('この項目は保存待ちです');
  if(action==='register'&&e&&!e.deleted) return d;
  if(action==='complete'&&e?.state==='done')return d;
  if(action==='reopen'&&e?.state==='todo')return d;
  const op={op_id:random(),id,action,target:e?.target||target,expected:e?.version||0};
  return {...d,queue:[...(d.queue||[]),op]};
 });await reload();status='保存中…';emit();channel?.postMessage('change');await flush();
}
export async function flush(){
 if(syncing||!auth||!API_URL)return;syncing=true;
 const run=async()=>{
  await reload();if(!auth)return;const session=auth,uid=auth.user_id;
  while(true){
   const d=await read('user:'+uid),op=d?.queue?.[0];if(!op)break;
   if(auth?.token!==session.token)break;
   status='保存中…（残り '+d.queue.length+'件）';emit();
   try{const result=await api('/operations',{method:'POST',body:JSON.stringify(op)},session);
    await change('user:'+uid,current=>({...current,base:[...(current.base||[]).filter(e=>e.id!==op.id),result.entry],queue:(current.queue||[]).filter(o=>o.op_id!==op.op_id)}));
    conflict=false;channel?.postMessage('saved');await reload();
   }catch(e){conflict=e.status===409;status=conflict?'別端末の更新と競合しています。復習管理で確認してください':'保存失敗：'+e.message+'（変更はこの端末に保持・再送待ち）';emit();return;}
  }
  status='サーバー保存済み';emit();
 };
 try{if(navigator.locks)await navigator.locks.request('kopuri-review-sync',run);else await run()}catch(e){showError(e)}finally{syncing=false;}
}
export async function resolveConflict(apply){
 if(!auth||!queue.length)return;const uid=auth.user_id,op=queue[0];
 const data=await api('/entries'),current=data.entries.find(e=>e.id===op.id);
 await change('user:'+uid,d=>{
  const rest=d.queue.filter(o=>o.op_id!==op.op_id);
  // Explicit reapply uses the latest server revision. Completing an already done entry is a no-op.
  const fulfilled=op.action==='complete'&&current?.state==='done'&&!current.deleted||op.action==='reopen'&&current?.state==='todo'&&!current.deleted||op.action==='delete'&&current?.deleted||op.action==='register'&&current&&!current.deleted;
  if(apply&&!fulfilled){if(op.action!=='register'&&(!current||current.deleted))throw Error('対象は他の端末で削除済みです。サーバー側を採用してください');rest.unshift({...op,op_id:random(),expected:current?.version||0})}
  return {base:data.entries,queue:rest};
 });conflict=false;await reload();await flush();
}
export const history=id=>api('/history?id='+encodeURIComponent(id));
export async function init(){
 try{
  await reload();
  const params=new URLSearchParams(location.hash.slice(1)),ticket=params.get('ticket');
  if(ticket){
   const verifier=sessionStorage.getItem('kopuri-review-verifier');historyReplace();
   if(!verifier)throw Error('認証を始めたタブでログインをやり直してください');
   const session=await api('/auth/exchange',{method:'POST',body:JSON.stringify({ticket,verifier})},null);
   sessionStorage.removeItem('kopuri-review-verifier');await change('auth',()=>session);await reload();
  }
  if(!API_URL){status='同期サービス未設定：ログイン・登録は設定後に利用できます';emit();return}
  await flush();await refresh();
 }catch(e){showError(e)}
}
function historyReplace(){window.history.replaceState(null,'',location.pathname+location.search)}
window.addEventListener('online',()=>flush().then(refresh));
window.addEventListener('focus',()=>flush().then(refresh));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)flush().then(refresh)});
setInterval(()=>{if(auth&&!document.hidden)flush().then(refresh)},30000);
