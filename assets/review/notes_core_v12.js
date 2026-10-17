import * as R from './core_v12.js';
import * as P from './private_notes_v12.js';
import * as S from './shared_notes_v12.js';
const events=new EventTarget();const emit=()=>events.dispatchEvent(new Event('change'));
let view='shared';try{const saved=localStorage.getItem('kopuri-notes-view-v12');if(['shared','private','both'].includes(saved))view=saved}catch{}
const scoped=(s,scope)=>{if(s.owner!==(R.state().auth?.user_id||null))s={...s,notes:[],queue:[],is_admin:false,conflict:false};return ({...s,notes:s.notes.map(n=>({...n,scope})),queue:s.queue.map(n=>({...n,scope}))})};
export const subscribe=fn=>{events.addEventListener('change',fn);return()=>events.removeEventListener('change',fn)};
export const creationScope=()=>view==='private'?'private':'shared';
export function setView(value){if(!['shared','private','both'].includes(value))throw Error('表示範囲が不正です');view=value;try{localStorage.setItem('kopuri-notes-view-v12',view)}catch{}emit()}
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
