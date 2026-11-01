// Bridge the existing PDF annotations to the same editing model as 古プリ.
export const pageKey=n=>'pdf_'+n;
export function editorDocument(data,page){
 const saved=data.corrections?.[page]||{},items=data.annotations.filter(a=>a.page===page);
 return {regions:{hide:[...(saved.regions?.hide||[]),...items.filter(a=>a.kind==='red-mask').map(a=>a.rect)].map(r=>r.slice()),keep:structuredClone(saved.regions?.keep||[])},native:items.filter(a=>a.kind==='green-mask'||a.kind==='text'&&a.color==='orange').map(a=>({ref:a.id,kind:a.kind==='green-mask'?'green':'orange',rect:a.rect.slice(),enabled:true,...(a.kind==='text'?{text:a.text,font_size:a.font_size}:{color:a.color||'#58cf68'})})),annotations:[],pairs:structuredClone(saved.pairs||[])};
}
export function applyEditorDocument(data,page,doc,previousAdded=[]){
 const native=new Map(doc.native.map(n=>[n.ref,n])),added=new Set([...previousAdded,...doc.annotations.map(a=>a.id)]);
 data.annotations=data.annotations.filter(a=>a.page!==page||a.kind!=='red-mask'&&!added.has(a.id)&&native.get(a.id)?.enabled!==false&&!(native.get(a.id)?.kind==='orange'&&native.get(a.id)?.answer_rect)).map(a=>{
  const n=a.page===page&&native.get(a.id);if(!n)return a;
  return {...a,rect:n.rect.slice(),...(a.kind==='text'?{text:n.text,font_size:n.font_size}:{color:n.color})};
 });
 data.annotations.push(...doc.annotations.map(a=>({...a,page})));
 (data.corrections||={})[page]={regions:structuredClone(doc.regions),pairs:structuredClone([...(doc.pairs||[]),...doc.native.filter(n=>n.kind==='orange'&&n.answer_rect).map(n=>({id:n.ref,body_rect:n.rect,text:n.text,font_size:n.font_size,enabled:n.enabled,answer_page:n.answer_page,answer_rect:n.answer_rect}))])};
}
export function pairsOnPage(data,page){return Object.entries(data.corrections||{}).flatMap(([owner,d])=>(d.pairs||[]).filter(p=>p.enabled!==false).map(p=>({...p,body_page:Number(owner)}))).filter(p=>p.body_page===page||p.answer_page===pageKey(page));}
