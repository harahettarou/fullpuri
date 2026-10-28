import * as R from './core_v12.js';
import * as P from './private_notes_v12.js';
import * as S from './shared_notes_v12.js';
const events=new EventTarget();const emit=()=>events.dispatchEvent(new Event('change'));
let view='both';try{const saved=localStorage.getItem('kopuri-notes-view-v14');if(['shared','private','both'].includes(saved))view=saved}catch{}
const scoped=(s,scope)=>{if(s.owner!==(R.state().auth?.user_id||null))s={...s,notes:[],queue:[],is_admin:false,conflict:false};return ({...s,notes:s.notes.map(n=>({...n,scope})),queue:s.queue.map(n=>({...n,scope}))})};
export const subscribe=fn=>{events.addEventListener('change',fn);return()=>events.removeEventListener('change',fn)};
export const creationScope=()=>'shared';
export function setView(value,persist=true){if(!['shared','private','both'].includes(value))throw Error('表示範囲が不正です');view=value;if(persist)try{localStorage.setItem('kopuri-notes-view-v14',view)}catch{}emit()}
export function state(){
 const p=scoped(P.state(),'private'),s=scoped(S.state(),'shared'),allNotes=[...s.notes,...p.notes],queue=[...s.queue,...p.queue],active=s.conflict?s:p.conflict?p:queue.length?(s.queue.length?s:p):null;
 const clean=p.status==='メモ：サーバー保存済み'&&s.status==='メモ：サーバー保存済み';
 return {notes:allNotes.filter(n=>view==='both'||n.scope===view),allNotes,queue,view,owner:s.owner,status:clean?'メモ：サーバー保存済み':`共通：${s.status} ／ 個人：${p.status}`,conflict:!!active?.conflict,conflictScope:active===s?'shared':active===p?'private':null,is_admin:s.is_admin};
}
const service=scope=>{if(!['shared','private'].includes(scope))throw Error('保存先が不正です');return scope==='shared'?S:P};
export const put=(t,body,expected,scope=creationScope())=>service(scope).put(t,body,expected);
export const remove=(t,expected,scope=creationScope())=>service(scope).remove(t,expected);
export const restore=(t,expected)=>S.restore(t,expected);
export const history=(id,before)=>S.history(id,before);
export const canDelete=scope=>scope==='private'||state().is_admin;
export function resolveConflict(apply,merged){const scope=state().conflictScope;return scope?service(scope).resolveConflict(apply,merged):undefined}
export const flush=()=>Promise.all([P.flush(),S.flush()]);
export const sync=()=>Promise.all([P.sync(),S.sync()]);
export const refresh=()=>Promise.all([P.refresh(),S.refresh()]);
export const init=()=>Promise.all([P.init(),S.init()]);
P.subscribe(emit);S.subscribe(emit);

// Copy across scopes only after an explicit UI confirmation; never delete the source.
export async function copyScope(target,body,expected,from){
 const uid=R.state().auth?.user_id;if(!uid)throw Error('先にログインしてください');
 if(!['private','shared'].includes(from))throw Error('保存先が不正です');
 if(typeof body!=='string'||!body.trim()||body.length>6000)throw Error('メモは1〜6000文字で入力してください');
 target=R.canonical(target);const id=await R.targetId(target);
 await Promise.all([P.refresh(),S.refresh()]);
 if(R.state().auth?.user_id!==uid)throw Error('ログイン状態が変わりました');
 if(P.state().status!=='メモ：サーバー保存済み'||S.state().status!=='メモ：サーバー保存済み')throw Error('再同期を完了してから保存先へ追加してください。元のメモは残っています');
 const source=service(from).state().notes.find(n=>n.id===id);
 if(!source||source.deleted||source.pending||source.version!==expected)throw Error('元のメモが更新されています。入力内容をコピーしてから開き直してください');
 const next=from==='private'?'shared':'private',dest=service(next),existing=dest.state().notes.find(n=>n.id===id);
 if(existing?.pending)throw Error('追加先のメモは保存待ちです');
 if(next==='shared'&&existing?.deleted&&!state().is_admin)throw Error('この箇所の共通メモは削除済みです。管理者による復元が必要です');
 if(existing&&!existing.deleted&&existing.body!==body)throw Error('追加先に別の内容のメモがあります。内容を確認・統合してください。元のメモは残っています');
 if(!existing||existing.deleted)await dest.put(target,body,existing?.version||0);
 if(R.state().auth?.user_id!==uid)throw Error('ログイン状態が変わりました。元のメモは残しています');
 const saved=dest.state().notes.find(n=>n.id===id);
 if(!saved||saved.deleted||saved.pending||saved.body!==body)throw Error('追加先は保存待ちです。元のメモは残しています。再同期後にもう一度変更してください');
 return {scope:next,id};
}
