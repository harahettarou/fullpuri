export const clampZoom=z=>Math.max(25,Math.min(400,Math.round((Number.isFinite(Number(z))?Number(z):100)*2)/2));
export const pageBaseWidth=(host,compact=false)=>Math.min(980,Math.max(280,host-(compact?16:36)));
export const validRect=r=>Array.isArray(r)&&r.length===4&&r.every(Number.isFinite)&&r.every(v=>v>=0)&&r[2]>0&&r[3]>0&&r[0]+r[2]<=1.000001&&r[1]+r[3]<=1.000001;
export function subtractRect(a,b){const [x,y,w,h]=a,x1=Math.max(x,b[0]),y1=Math.max(y,b[1]),x2=Math.min(x+w,b[0]+b[2]),y2=Math.min(y+h,b[1]+b[3]);if(x2<=x1||y2<=y1)return [a];return [[x,y,w,y1-y],[x,y2,w,y+h-y2],[x,y1,x1-x,y2-y1],[x2,y1,x+w-x2,y2-y1]].filter(r=>r[2]>1e-8&&r[3]>1e-8)}
// Disjoint complements keep overlapping selected rectangles a union, not an XOR.
export function outsideRects(ranges){let parts=[[0,0,1,1]];for(const r of ranges)parts=parts.flatMap(a=>subtractRect(a,r));return parts}
export function cleanRanges(value){const result={};if(!value||typeof value!=='object')return result;for(const [page,rows]of Object.entries(value)){if(!/^\d{1,4}$/.test(page)||!Array.isArray(rows))continue;result[page]=rows.filter(r=>r&&validRect(r.rect)).slice(0,50).map((r,i)=>({id:typeof r.id==='string'?r.id:'range'+i,name:String(r.name||'範囲 '+(i+1)).slice(0,80),enabled:r.enabled!==false,rect:r.rect.map(v=>Math.round(v*1e6)/1e6)}))}return result}
