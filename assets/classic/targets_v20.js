import {nativeItems,redRegions,valid} from './model_v19.js';

// Review identity continues to use source-image coordinates, never zoom pixels.
export function classicTargets(page,data,source){
 const original=nativeItems(source.get(page.key),[...source.values()]);
 const same=(a,b)=>a.every((v,i)=>Math.abs(v-b[i])<.000001);
 const suppressed=data?original.filter(n=>n.kind==='orange'||n.kind==='green'&&data.native?.some(c=>c.ref===n.ref&&(!c.enabled||!same(c.rect,n.rect)))).map(n=>({color:n.kind,rect:n.rect})):[];
 const candidates=[];
 const add=(color,rect,text='')=>{if(!valid(rect)||candidates.some(n=>n.color===color&&same(n.rect,rect)))return;candidates.push({kind:'word',no:page.no,page:page.key,color,text,rect:[...rect],source:'manual'})};
 for(const a of data?.annotations||[]){
  if(a.kind==='text'&&a.color!=='black')add(a.color,a.rect,a.text);
  if(a.kind==='green-mask')add('green',a.rect);
  if(a.kind==='red-mask')add('red',a.rect);
 }
 const oldRed=redRegions(source.get(page.key)).hide;
 for(const rect of data?.regions?.hide||[])if(!oldRed.some(r=>same(r,rect)))add('red',rect);
 for(const n of data?.native||[]){
  if(!n.enabled)continue;
  if(n.kind==='orange'&&n.text)add('orange',n.rect,n.text);
  if(n.kind==='green'&&!original.some(o=>o.ref===n.ref&&same(o.rect,n.rect)))add('green',n.rect);
 }
 for(const p of data?.pairs||[])if(p.enabled)add('orange',p.body_rect,p.text);
 return {targets:candidates,suppressed};
}
