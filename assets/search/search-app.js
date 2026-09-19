(function(){
 'use strict';
 const input=document.getElementById('q'),status=document.getElementById('status'),results=document.getElementById('results');
 let pages=[],loaded=false,overlayReady=false,timer=0;
 const norm=value=>value.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-96)).replace(/[^0-9a-zぁ-ん一-龯々〆ヵヶ]+/g,'');
 function grams(value){const size=value.length<5?2:3,out=[];if(value.length<=size)return[value];for(let i=0;i<=value.length-size;i++)out.push(value.slice(i,i+size));return out;}
 let fuzzyQuery='',cachedGrams=[],cachedSet=new Set();
 function fuzzy(query,text){
  if(!query)return 0;
  if(text.includes(query))return 1;
  if(query.length<3)return 0;
  if(query!==fuzzyQuery){fuzzyQuery=query;cachedGrams=grams(query);cachedSet=new Set(cachedGrams);}
  const qg=cachedGrams,set=cachedSet,size=query.length,bestFloor=query.length<=4?.62:.48;
  // A zero-overlap line cannot meet the legacy Dice threshold. Exact prefilter.
  if(!qg.some(g=>text.includes(g)))return 0;
  let best=0;
  for(let start=0;start<text.length;start++)for(let delta=-2;delta<=2;delta++){
   const part=text.slice(start,start+size+delta);if(part.length<Math.max(2,size-2))continue;
   const pg=grams(part);let common=0;for(const g of pg)if(set.has(g))common++;
   const score=2*common/(qg.length+pg.length);if(score>best)best=score;if(best>=.96)return best;
  }
  return best>=bestFloor?best:0;
 }
 const element=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
 function render(){
  if(!loaded)return;
  const rawQuery=input.value.trim(),q=norm(rawQuery);results.replaceChildren();
  if(!q){status.textContent=`${pages.length}ページを検索できます。${overlayReady?'補正検索ON':'補正データなし：原文検索のみ'}`;results.append(element('div','hint','文字を入力してください。'));return;}
  const found=[];
  for(const page of pages){
   let best=null;
   for(const [index,line] of page.lines.entries()){
    const m=window.OcrCorrectionSearch?OcrCorrectionSearch.match(rawQuery,page,line,index,fuzzy):{score:fuzzy(q,line.n),rank:line.n.includes(q)?3:1,label:line.n.includes(q)?'原文一致':'近い候補',display:line.t};
    if(m.score&&(!best||m.rank>best.rank||(m.rank===best.rank&&m.score>best.score)))best={line,...m};
   }
   if(best)found.push({page,...best});
  }
  found.sort((a,b)=>b.rank-a.rank||b.score-a.score||a.page.no-b.page.no);
  status.textContent=(found.length?`${found.length}ページで候補が見つかりました${found.length>80?'（上位80件）':''}`:'候補が見つかりませんでした。文字を短くして試してください。')+(overlayReady?'':'［原文検索のみ］');
  for(const hit of found.slice(0,80)){
   const {page,line}=hit;const rect=[line.x,line.y,line.w,line.h];
   if(!rect.every(Number.isFinite))continue;
   const url=new URL(page.href,location.href);
   if(url.origin!==location.origin||!['http:','https:','file:'].includes(url.protocol))continue;
   url.searchParams.set('page',page.key);url.searchParams.set('hit',rect.join(','));url.searchParams.set('q',rawQuery);
   const a=element('a','result');a.href=url.href;
   const top=element('div','topline');top.append(element('span','label',page.label),element('span','unit',page.unit),element('span','score',hit.label));
   a.append(top,element('div','context',hit.display));
   if(hit.display!==line.t)a.append(element('div','status','OCR原文：'+line.t));
   results.append(a);
  }
  if(!found.length)results.append(element('div','hint','別の言葉でも試してみてください。'));
 }
 input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(render,160);});
 fetch('../assets/search/ocr-index.json',{cache:'no-cache'}).then(async r=>{
  if(!r.ok)throw Error(r.status);const bytes=await r.arrayBuffer();const data=JSON.parse(new TextDecoder().decode(bytes));pages=data.pages;
  if(window.OcrCorrectionSearch){OcrCorrectionSearch.prepare(pages);overlayReady=await OcrCorrectionSearch.load(bytes);}
  const initial=new URLSearchParams(location.search).get('q');if(initial!==null)input.value=initial;
  loaded=true;render();if(initial)input.focus();
 }).catch(()=>{status.textContent='検索データを読み込めませんでした。';});
 window.KopuriSearchTest={fuzzy,render};
})();
