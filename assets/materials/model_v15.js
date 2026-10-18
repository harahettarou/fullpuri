// All rectangles use the original PDF page as a unit square.
export const colors={orange:'#e56b00',red:'#d12424',green:'#168245',black:'#20252b'};
export function rectBetween(a,b){const x=Math.min(a[0],b[0]),y=Math.min(a[1],b[1]);return [x,y,Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1])].map(v=>Math.round(v*1e6)/1e6)}
export function target(material,page,kind='page',rect=[0,0,1,1],text='',color=''){
 return {no:0,page:`mat_${material.id}_${page}`,kind,rect,text:text||`${material.title} ${page}ページ`,color,material:{id:material.id,page,title:material.title,subject:material.subject}};
}
export const snapshot=m=>({title:m.title,subject:m.subject,folder:m.folder,annotations:structuredClone(m.annotations)});
export function visible(a,on,editing=false){return editing||a.kind!=='text'||on[a.color]!==false}
export const documentLabel=t=>t.material?`${t.material.title} ｜ ${t.material.page}ページ`:`No.${t.no}`;
export function materialLink(t,extra={}){const u=new URL('../../pages/material.html',import.meta.url);u.searchParams.set('id',t.material.id);u.searchParams.set('page',t.material.page);for(const [k,v]of Object.entries(extra))u.searchParams.set(k,v);return u.href}
