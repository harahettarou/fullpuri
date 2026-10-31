import * as R from './core_v12.js';
let rows=[],inflight;
const events=new EventTarget();
export const subscribe=fn=>{events.addEventListener('change',fn);return()=>events.removeEventListener('change',fn)};
export const state=()=>rows;
export const sameRect=(a,b)=>a.length===4&&b.length===4&&a.every((v,i)=>Math.abs(v-b[i])<.000003);
export const find=(page,rect)=>rows.find(r=>r.page===page&&sameRect(r.rect,rect));
export function refresh(){
 return inflight||=((async()=>{const all=[];let after='';do{const data=await R.api('/ocr-corrections'+(after?'?after='+encodeURIComponent(after):''),{},null);all.push(...data.corrections);after=data.next||''}while(after);rows=all;events.dispatchEvent(new Event('change'));return rows})().finally(()=>{inflight=null}));
}
export async function put(target,text,expected){
 if(!R.state().auth)throw Error('先にログインしてください');
 const result=await R.api('/ocr-corrections',{method:'POST',body:JSON.stringify({target:R.canonical(target),text,expected})});
 rows=[...rows.filter(r=>r.id!==result.correction.id),result.correction];events.dispatchEvent(new Event('change'));
 return result.correction;
}
