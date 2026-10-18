// Existing v15 annotation schema is retained for server compatibility.
export const layerOf=a=>a.kind==='green-mask'?'green-marker':a.kind==='red-mask'?'red-mask':a.color==='orange'?'orange':'other';
export const layerLabel={orange:'オレンジ文字','green-marker':'緑マーカー','red-mask':'赤文字を隠す範囲',other:'その他の文字'};
export const annotationLabel=a=>a.kind==='text'?`${{orange:'オレンジ',red:'赤',green:'緑',black:'黒'}[a.color]}文字：${a.text}`:layerLabel[layerOf(a)];
export function presentation(a,shown,editing=false){
 if(a.kind==='text')return {show:editing||shown[a.color]!==false,mode:'text'};
 if(a.kind==='green-mask')return {show:true,mode:editing?'green-edit':shown.green?'green-open':'green-closed'};
 return {show:editing||!shown.red,mode:editing?'red-edit':'red-closed'};
}
export function textAt(point,text,font,pageWidth,pageHeight){
 const lines=text.split('\n'),units=s=>[...s].reduce((n,c)=>n+(/[\u0000-\u00ff]/.test(c)?.65:1),0),w=Math.max(.015,...lines.map(s=>units(s)*font/pageWidth+.012)),h=Math.max(.015,lines.length*font*1.25/pageHeight+.008);
 const width=Math.min(1,w),height=Math.min(1,h);return [Math.max(0,Math.min(point[0],1-width)),Math.max(0,Math.min(point[1],1-height)),width,height].map(v=>Math.round(v*1e6)/1e6);
}
