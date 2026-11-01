import {drawNumberText} from '../classic/number_layout_v25.js';
import {pairsOnPage} from './correction_model_v19.js';
export function paintCorrections(host,data,page,viewport,shown,editing,onTarget){
 const doc=data.corrections?.[page],pairs=pairsOnPage(data,page);if(!doc&&!pairs.length)return;
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.width=Math.ceil(viewport.width*2);canvas.height=Math.ceil(viewport.height*2);ctx.scale(2,2);canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
 const box=r=>[r[0]*viewport.width,r[1]*viewport.height,r[2]*viewport.width,r[3]*viewport.height];
 if(doc&&!shown.red){ctx.fillStyle='#fff';for(const r of doc.regions?.hide||[])ctx.fillRect(...box(r));for(const r of doc.regions?.keep||[])ctx.clearRect(...box(r))}
 ctx.fillStyle='#fff';for(const p of pairs)if(p.answer_page==='pdf_'+page)ctx.fillRect(...box(p.answer_rect));
 const visible=pairs.filter(p=>p.body_page===page&&(shown.orange||editing));
 for(const p of visible)drawNumberText(ctx,box(p.body_rect),p.text,p.font_size);
 host.append(canvas);
 if(!editing)for(const p of visible){const b=document.createElement('button');b.type='button';b.setAttribute('aria-label','復習・メモ：'+p.text);b.style.cssText='position:absolute;background:transparent;border:0;padding:0;pointer-events:auto';Object.assign(b.style,{left:p.body_rect[0]*100+'%',top:p.body_rect[1]*100+'%',width:p.body_rect[2]*100+'%',height:p.body_rect[3]*100+'%'});b.onclick=e=>{e.stopPropagation();onTarget(p)};host.append(b)}
}
