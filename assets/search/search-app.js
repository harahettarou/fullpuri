(function(){
 'use strict';
 const input=document.getElementById('q'),status=document.getElementById('status'),results=document.getElementById('results');
 let pages=[],loaded=false,overlayReady=false,orangeReady=false,timer=0;
 const orangeByPage=new Map();
 const norm=value=>value.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-96)).replace(/[^0-9a-zぁ-ん一-龯々〆ヵヶ]+/g,'');
 function grams(value){const size=value.length<5?2:3,out=[];if(value.length<=size)return[value];for(let i=0;i<=value.length-size;i++)out.push(value.slice(i,i+size));return out;}
 let fuzzyQuery='',cachedGrams=[],cachedCounts=new Map();
 function fuzzy(query,text){
  if(!query)return 0;
  if(text.includes(query))return 1;
  if(query.length<3)return 0;
  if(query!==fuzzyQuery){fuzzyQuery=query;cachedGrams=grams(query);cachedCounts=new Map();for(const g of cachedGrams)cachedCounts.set(g,(cachedCounts.get(g)||0)+1);}
  const qg=cachedGrams,size=query.length,bestFloor=query.length<=4?.8:.48;
  // A zero-overlap line cannot meet the legacy Dice threshold. Exact prefilter.
  if(!qg.some(g=>text.includes(g)))return 0;
  let best=0;
  for(let start=0;start<text.length;start++)for(let delta=-2;delta<=2;delta++){
   const part=text.slice(start,start+size+delta);if(part.length<Math.max(2,size-2))continue;
   const pg=grams(part),used=new Map();let common=0;for(const g of pg){const count=used.get(g)||0;if(count<(cachedCounts.get(g)||0)){common++;used.set(g,count+1);}}
   const score=2*common/(qg.length+pg.length);if(score>best)best=score;if(best>=.96)return best;
  }
  return best>=bestFloor?best:0;
 }
 const element=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
 function render(){
  if(!loaded)return;
  const rawQuery=input.value.trim(),q=norm(rawQuery);results.replaceChildren();
  if(!q){status.textContent=`${pages.length}ページを検索できます。${overlayReady?'補正検索ON':'補正データなし：原文検索のみ'}／${orangeReady?'オレンジ文字検索ON':'オレンジ文字データなし'}`;results.append(element('div','hint','文字を入力してください。'));return;}
  const found=[];
  for(const page of pages){
   let best=null;
   for(const [index,line] of page.lines.entries()){
    const m=window.OcrCorrectionSearch?OcrCorrectionSearch.match(rawQuery,page,line,index,fuzzy):{score:fuzzy(q,line.n),rank:line.n.includes(q)?3:1,label:line.n.includes(q)?'原文一致':'近い候補',display:line.t};
    if(m.score&&(!best||m.rank>best.rank||(m.rank===best.rank&&m.score>best.score)))best={line,...m};
   }
   for(const line of orangeByPage.get(page.key)||[]){
    const m=window.OcrCorrectionSearch?OcrCorrectionSearch.match(rawQuery,page,line,'orange-'+line.id,fuzzy):{score:fuzzy(q,line.n),rank:line.n.includes(q)?3:1,display:line.t};
    m.label=m.rank===3?'オレンジ文字一致':m.rank===2?'オレンジ文字・表記揺れ一致':'オレンジ文字・近い候補';
    // Prefer the supplied text/box on equal matches, so the answer is visible.
    if(m.score&&(!best||m.rank>best.rank||(m.rank===best.rank&&m.score>=best.score)))best={line,...m,source:'orange'};
   }
   if(best)found.push({page,...best});
  }
  found.sort((a,b)=>b.rank-a.rank||b.score-a.score||a.page.no-b.page.no);
  status.textContent=(found.length?`${found.length}ページで候補が見つかりました${found.length>80?'（上位80件）':''}`:'候補が見つかりませんでした。文字を短くして試してください。')+(overlayReady?'':'［OCR補正なし］')+(orangeReady?'':'［オレンジ文字データなし］');
  for(const hit of found.slice(0,80)){
   const {page,line}=hit;const rect=[line.x,line.y,line.w,line.h];
   if(!rect.every(Number.isFinite))continue;
   const url=new URL(page.href,location.href);
   if(url.origin!==location.origin||!['http:','https:','file:'].includes(url.protocol))continue;
   url.searchParams.set('page',page.key);url.searchParams.set('hit',rect.join(','));url.searchParams.set('q',rawQuery);
   if(hit.source==='orange')url.searchParams.set('orange','1');
   const a=element('a','result');a.href=url.href;
   const top=element('div','topline');top.append(element('span','label',page.label),element('span','unit',page.unit),element('span','score',hit.label));
   const context=element('div','context',hit.display);context.style&&(context.style.whiteSpace='pre-line');a.append(top,context);
   if(hit.display!==line.t){const original=element('details','ocr-original'),summary=element('summary','','OCR原文を確認');original.append(summary,element('div','status',line.t));original.addEventListener('click',event=>{event.preventDefault();if(event.target===summary)original.open=!original.open;});a.append(original);}
   results.append(a);
  }
  if(!found.length)results.append(element('div','hint','別の言葉でも試してみてください。'));
 }
 input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(render,160);});
 async function loadOrange(bytes){
  orangeByPage.clear();orangeReady=false;
  try{
   const r=await fetch('../assets/search/orange-search-index.json',{cache:'no-cache'});
   if(!r.ok)throw Error('missing orange index');
   const data=await r.json();
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(data.version!==1||data.source_sha256!==hash||!Array.isArray(data.rows))throw Error('stale orange index');
   const known=new Map(pages.map(p=>[p.key,p])),prepared=new Map();
   for(const row of data.rows){
    const p=known.get(row.page_key),b=row.box;
    if(!p||row.href!==p.href||typeof row.id!=='string'||typeof row.text!=='string'||!row.text.trim()||!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)||b[0]<0||b[1]<0||b[2]<=0||b[3]<=0||b[0]+b[2]>p.width+1||b[1]+b[3]>p.height+1)throw Error('invalid orange row');
    const list=prepared.get(p.key)||[];
    list.push({id:row.id,t:row.text,n:norm(row.text),x:b[0],y:b[1],w:b[2],h:b[3]});prepared.set(p.key,list);
   }
   for(const [key,rows] of prepared)orangeByPage.set(key,rows);
   orangeReady=true;
  }catch(error){console.warn('オレンジ文字検索データを利用できません。OCR検索を継続します。',error.message);}
 }
 fetch('../assets/search/ocr-index.json',{cache:'no-cache'}).then(async r=>{
  if(!r.ok)throw Error(r.status);const bytes=await r.arrayBuffer();const data=JSON.parse(new TextDecoder().decode(bytes));pages=data.pages;
  const orangeLoad=loadOrange(bytes);
  if(window.OcrCorrectionSearch){OcrCorrectionSearch.prepare(pages);overlayReady=await OcrCorrectionSearch.load(bytes);}
  await orangeLoad;
  const initial=new URLSearchParams(location.search).get('q');if(initial!==null)input.value=initial;
  loaded=true;render();if(initial)input.focus();
 }).catch(()=>{status.textContent='検索データを読み込めませんでした。';});
 window.KopuriSearchTest={fuzzy,render};
})();
