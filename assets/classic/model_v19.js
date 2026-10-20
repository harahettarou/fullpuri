import * as V18 from './model_v18.js';
export const {revision,norm,pixels}=V18;
export const valid=r=>Array.isArray(r)&&r.length===4&&r.every(Number.isFinite)&&r.every(v=>v>=0)&&r[2]>0&&r[3]>0&&r[0]+r[2]<=1.000001&&r[1]+r[3]<=1.000001;
export function originalPairs(p,pages){const map=new Map();for(const q of pages.flatMap(x=>x.numberPairs||[]))if(q.bodyPageKey===p.key)map.set(q.id||JSON.stringify(q),q);return [...map.values()]}
export function nativeItems(p,pages){const old=V18.nativeItems(p,pages),oranges=old.filter(n=>n.kind==='orange'),pairs=originalPairs(p,pages);return old.map(n=>{if(n.kind==='green'){const greens=(p.greenHide||[]).filter(r=>valid(V18.norm([r.x,r.y,r.width,r.height],p))),i=old.filter(x=>x.kind==='green').findIndex(x=>x.ref===n.ref),r=greens[i];return {...n,color:r?.color||'#58cf68'}}const q=pairs[oranges.findIndex(o=>o.ref===n.ref)],answer=pages.find(x=>x.key===q?.answerPageKey);return q&&answer?{...n,answer_page:answer.key,answer_rect:V18.norm(q.answer,answer)}:n})}
export const emptyData=(p,pages)=>({fingerprint:revision(p,pages),annotations:[],native:nativeItems(p,pages)});
export const redRegions=p=>({hide:(p.hideResolved||p.hide||[]).map(r=>norm(r,p)).filter(valid),keep:(p.keep||[]).map(r=>norm(r,p)).filter(valid)});
export function applyNative(p,pages,source,data,documents=new Map()){
 const originals=[...source.values()];const docs=new Map(documents);docs.set(p.key,data);
 for(const live of pages){const orig=source.get(live.key),d=docs.get(live.key);V18.applyNative(live,pages,source,d);
  live.hide=structuredClone(orig.hide||[]);if(orig.hideResolved)live.hideResolved=structuredClone(orig.hideResolved);else delete live.hideResolved;live.keep=structuredClone(orig.keep||[]);if(orig.baseOff)live.baseOff=orig.baseOff;else delete live.baseOff;live.__customRegions=false;
  if(d?.regions){live.hide=d.regions.hide.map(r=>pixels(r,live));live.hideResolved=live.hide;live.keep=d.regions.keep.map(r=>pixels(r,live));delete live.baseOff;live.__customRegions=true}
  let nativeIndex=0,liveIndex=0;const greens=V18.nativeItems(orig,originals).filter(n=>n.kind==='green');for(const r of orig.greenHide||[]){const base=valid(V18.norm([r.x,r.y,r.width,r.height],orig))?greens[nativeIndex++]:null,change=base&&d?.native?.find(n=>n.ref===base.ref);if(change?.enabled===false)continue;if(change?.color&&live.greenHide[liveIndex])live.greenHide[liveIndex].color=change.color;liveIndex++}
  const native=V18.nativeItems(orig,originals).filter(n=>n.kind==='orange'),pairs=originalPairs(orig,originals);
  native.forEach((n,i)=>{const change=d?.native?.find(v=>v.ref===n.ref),q=pairs[i];if(!q||!change)return;for(const pair of pages.flatMap(x=>x.numberPairs||[]))if((pair.id||JSON.stringify(pair))===(q.id||JSON.stringify(q))){if(!change.enabled){pair.body=[0,0,0,0];pair.answer=[0,0,0,0]}else if(change.answer_page&&source.has(change.answer_page)){pair.answerPageKey=change.answer_page;pair.answer=pixels(change.answer_rect,source.get(change.answer_page))}}});
 }
}
export function pairsFor(owner,doc,source){const p=source.get(owner);if(!p)return [];const native=nativeItems(p,[...source.values()]);return [...(doc?.native||native).filter(n=>n.kind==='orange').map(n=>({...native.find(x=>x.ref===n.ref),...n,id:n.ref,body_page:owner,body_rect:n.rect,native:true})),...(doc?.pairs||[]).map(n=>({...n,body_page:owner,native:false}))]}
