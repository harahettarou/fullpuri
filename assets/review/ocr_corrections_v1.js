import * as R from './core_v12.js';
import archive from './ocr_archive_v1.js';
const archivedById=new Map(archive.map(row=>[row.id,row]));
let liveById=new Map(),rows=archive,inflight;
const indexByPage=entries=>{
 const index=new Map();
 for(const row of entries){
  const page=index.get(row.page)||[];
  page.push(row);index.set(row.page,page);
 }
 return index;
};
let byPage=indexByPage(rows);
const events=new EventTarget();
export const subscribe=fn=>{events.addEventListener('change',fn);return()=>events.removeEventListener('change',fn)};
export const state=()=>rows;
export const sameRect=(a,b)=>a.length===4&&b.length===4&&a.every((v,i)=>Math.abs(v-b[i])<.000003);
export function find(page,rect){
 const candidates=byPage.get(page)||[];
 return candidates.find(r=>r.rect.every((v,i)=>v===rect[i]))||candidates.find(r=>sameRect(r.rect,rect));
}
function publish(){
 const merged=new Map(archivedById);
 for(const [id,row] of liveById)merged.set(id,row);
 rows=[...merged.values()];
 byPage=indexByPage(rows);
 events.dispatchEvent(new Event('change'));
}
export function refresh(){
 return inflight||=((async()=>{
  const before=new Map(liveById),next=new Map();let after='';
  do{
   const data=await R.api('/ocr-corrections'+(after?'?after='+encodeURIComponent(after):''),{},null);
   for(const row of data.corrections)next.set(row.id,row);
   after=data.next||'';
  }while(after);
  // A save completed during this read takes precedence over its earlier snapshot.
  for(const [id,row] of liveById)if(before.get(id)!==row)next.set(id,row);
  liveById=next;publish();return rows;
 })().finally(()=>{inflight=null}));
}
export async function put(target,text,expected){
 if(!R.state().auth)throw Error('先にログインしてください');
 const result=await R.api('/ocr-corrections',{method:'POST',body:JSON.stringify({target:R.canonical(target),text,expected})});
 liveById.set(result.correction.id,result.correction);publish();
 return result.correction;
}
