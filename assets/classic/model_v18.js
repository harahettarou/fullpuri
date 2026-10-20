const hash=s=>{let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0')};
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export const norm=(r,p)=>[r[0]/p.width,r[1]/p.height,r[2]/p.width,r[3]/p.height].map(v=>Math.round(v*1e6)/1e6);
export const pixels=(r,p)=>[r[0]*p.width,r[1]*p.height,r[2]*p.width,r[3]*p.height];
export function nativeItems(p,pages){
 const greens=(p.greenHide||[]).map((r,i)=>({ref:'g_'+hash(stable([i,r])),kind:'green',rect:norm([r.x,r.y,r.width,r.height],p),enabled:true}));
 const pairs=new Map();for(const q of pages.flatMap(x=>x.numberPairs||[]))if(q.bodyPageKey===p.key)pairs.set(q.id||stable(q),q);
 const orange=[...pairs.values()].map(q=>({ref:'o_'+hash(stable(q)),kind:'orange',rect:norm(q.body,p),text:String(q.answerText||''),font_size:Number(q.fontSize)||32,enabled:true}));return [...greens,...orange].filter(n=>n.rect.every(v=>v>=0)&&n.rect[2]>0&&n.rect[3]>0&&n.rect[0]+n.rect[2]<=1.000001&&n.rect[1]+n.rect[3]<=1.000001);
}
export const revision=(p,pages)=>hash(stable([p.key,p.width,p.height,p.base,p.baseOff||'',p.hide,p.hideResolved||[],nativeItems(p,pages)]));
export const emptyData=(p,pages)=>({fingerprint:revision(p,pages),annotations:[],native:nativeItems(p,pages)});
export function applyNative(p,pages,source,data){
 const original=source.get(p.key),items=nativeItems(original,[...source.values()]);const changes=new Map((data?.native||[]).map(n=>[n.ref,n]));
 p.greenHide=(original.greenHide||[]).flatMap((r,i)=>{const change=changes.get('g_'+hash(stable([i,r])));if(change?.enabled===false)return [];if(!change)return [structuredClone(r)];const [x,y,width,height]=pixels(change.rect,p);return [{...r,x,y,width,height}]});
 // Mutate the same pair objects used by the classic viewer's prebuilt maps.
 const origPairs=new Map();for(const q of [...source.values()].flatMap(x=>x.numberPairs||[]))if(q.bodyPageKey===p.key)origPairs.set(q.id||stable(q),q);
 for(const q of origPairs.values()){const change=changes.get('o_'+hash(stable(q)));for(const live of pages.flatMap(x=>x.numberPairs||[]))if((live.id||stable(live))===(q.id||stable(q))){Object.assign(live,structuredClone(q));if(change){live.body=pixels(change.rect,p);live.answerText=change.enabled?change.text:'';live.fontSize=change.font_size}}}
}
