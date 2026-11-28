(function(){
 'use strict';
 const input=document.getElementById('q'),status=document.getElementById('status'),results=document.getElementById('ocr-results');
 let pages=[],loaded=false,overlayReady=false,orangeReady=false,timer=0;
 const initialQuery=new URLSearchParams(location.search).get('q');if(initialQuery!==null)input.value=initialQuery;
 const orangeByPage=new Map();
 const pageSize=80;
 let correctionsByPage=new Map(),limit=pageSize;
 let review,owner=false,exclusionsReady=false,changing=false;
 const exclusions=new Map(),excludedByPage=new Map(),notice=document.getElementById('ocr-owner-status');
 const exclusionsLoad=import('../review/core_v12.js').then(async R=>{
  review=R;
  const updateOwner=()=>{
   const state=R.state(),allowed=Boolean(state.auth&&!state.sessionExpired&&state.account.ocr_owner);
   if(owner===allowed)return;
   owner=allowed;
   if(!owner)notice.replaceChildren();
   render();
  };
  R.subscribe(updateOwner);updateOwner();
  const data=await R.api('/ocr-exclusions',{},null);
  for(const entry of data.exclusions)exclusions.set(entry.id,entry);
  indexExclusions();exclusionsReady=true;
 }).catch(()=>{console.warn('OCR除外一覧を取得できませんでした。')});
 function indexExclusions(){
  excludedByPage.clear();
  for(const {page,rect} of exclusions.values()){
   const list=excludedByPage.get(page)||[];
   list.push(rect);excludedByPage.set(page,list);
  }
 }
 const sameRect=(a,b)=>a.every((v,i)=>Math.abs(v-b[i])<.000003);
 const normalizedRect=(page,line)=>[line.x/page.width,line.y/page.height,Math.min(line.w,page.width-line.x)/page.width,Math.min(line.h,page.height-line.y)/page.height];
 const isExcluded=(page,rect)=>excludedByPage.get(page)?.some(box=>sameRect(rect,box));
 async function setExcluded(target,excluded,control){
  if(!owner||!exclusionsReady||changing)return;
  changing=true;control.disabled=true;
  try{
   const data=await review.api('/ocr-exclusions',{method:'POST',body:JSON.stringify({...target,excluded})});
   if(data.excluded)exclusions.set(data.entry.id,data.entry);
   else exclusions.delete(data.entry.id);
   indexExclusions();
   if(owner){
    const message=element('span','',excluded?'検索結果から除外しました。':'検索結果に戻しました。');
    notice.replaceChildren(message);
    if(excluded){
     const undo=element('button','ocr-owner-button','元に戻す');undo.type='button';
     undo.addEventListener('click',()=>setExcluded(target,false,undo));notice.append(undo);
    }
   }
   render();
  }catch(error){
   if(owner){
    let message=notice.querySelector('span');
    if(!message){message=element('span');notice.prepend(message);}
    message.textContent=error.message;
   }
  }finally{changing=false;control.disabled=false;}
 }
 import('../review/ocr_corrections_v1.js').then(C=>{
  const update=()=>{
   const byPage=new Map();
   for(const correction of C.state()){
    const list=byPage.get(correction.page)||[];
    list.push({...correction,normalized:norm(correction.text)});
    byPage.set(correction.page,list);
   }
   correctionsByPage=byPage;render();
  };
  C.subscribe(update);update();return C.refresh();
 }).catch(()=>{console.warn('最新の手動修正を取得できませんでした。読み込み済みのデータで検索します。')});
 const correctionFor=(page,line)=>(correctionsByPage.get(page.key)||[]).find(c=>sameRect(normalizedRect(page,line),c.rect));
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
 function preferred(hit,previous){
  return !previous||hit.rank>previous.rank||
   (hit.rank===previous.rank&&(hit.score>previous.score||
    (hit.score===previous.score&&hit.source==='orange')));
 }
 function render(){
  if(!loaded)return;
  const rawQuery=input.value.trim(),q=norm(rawQuery);results.replaceChildren();
  if(!q){status.textContent=`OCR：${pages.length}ページを検索できます。${overlayReady?'補正検索ON':'補正データなし：原文検索のみ'}／${orangeReady?'オレンジ文字検索ON':'オレンジ文字データなし'}`;results.append(element('div','hint','文字を入力してください。'));return;}
  const found=[];
  for(const page of pages){
   const matches=new Map();
   let candidate=null;
   function collect(hit,confirmed){
    if(!hit.score)return;
    if(!confirmed){
     if(preferred(hit,candidate))candidate=hit;
     return;
    }
    const key=normalizedRect(page,hit.line).map(value=>Math.round(value*1e6)).join(',');
    if(preferred(hit,matches.get(key)))matches.set(key,hit);
   }
   for(const [index,line] of page.lines.entries()){
    if(correctionFor(page,line))continue;
    const m=window.OcrCorrectionSearch?OcrCorrectionSearch.match(rawQuery,page,line,index,fuzzy):{score:fuzzy(q,line.n),rank:line.n.includes(q)?3:1,label:line.n.includes(q)?'原文一致':'近い候補',display:line.t};
    collect({line,...m},m.rank>=2);
   }
   for(const line of orangeByPage.get(page.key)||[]){
    if(correctionFor(page,line))continue;
    const m=window.OcrCorrectionSearch?OcrCorrectionSearch.match(rawQuery,page,line,'orange-'+line.id,fuzzy):{score:fuzzy(q,line.n),rank:line.n.includes(q)?3:1,display:line.t};
    m.label=m.rank===3?'オレンジ文字一致':m.rank===2?'オレンジ文字・表記揺れ一致':'オレンジ文字・近い候補';
    collect({line,...m,source:'orange'},m.rank>=2);
   }
   for(const c of correctionsByPage.get(page.key)||[]){
    const exact=c.normalized===q,partial=c.normalized.includes(q);
    const score=partial?1:fuzzy(q,c.normalized);
    if(!score)continue;
    const [x,y,w,h]=c.rect;
    collect({line:{t:c.original,x:x*page.width,y:y*page.height,w:w*page.width,h:h*page.height},
     score,rank:exact?6:partial?5:4,display:c.text,
     label:exact?'登録・修正した文字一致':partial?'登録・修正した文字の部分一致':'登録・修正した文字の候補'},partial);
   }
   // Filter after selecting matches so exclusions never promote a fuzzy candidate.
   const selected=matches.size?matches.values():candidate?[candidate]:[];
   for(const hit of selected){
    if(hit.source!=='orange'&&excludedByPage.has(page.key)&&isExcluded(page.key,normalizedRect(page,hit.line)))continue;
    found.push({page,...hit});
   }
  }
  found.sort((a,b)=>b.rank-a.rank||b.score-a.score||a.page.no-b.page.no);
  const pageCount=new Set(found.map(hit=>hit.page.key)).size;
  status.textContent=`OCR：${found.length}件（${pageCount}ページ）${found.length>limit?' ／ 先頭'+limit+'件を表示':''}`+(overlayReady?'':'［OCR補正なし］')+(orangeReady?'':'［オレンジ文字データなし］');
  for(const hit of found.slice(0,limit)){
   const {page,line}=hit;const rect=[line.x,line.y,line.w,line.h];
   if(!rect.every(Number.isFinite))continue;
   const url=new URL(page.href,location.href);
   if(url.origin!==location.origin||!['http:','https:','file:'].includes(url.protocol))continue;
   url.searchParams.set('page',page.key);url.searchParams.set('hit',rect.join(','));url.searchParams.set('q',rawQuery);
   url.searchParams.set('hit_text',hit.display.slice(0,1000));
   if(hit.source==='orange')url.searchParams.set('orange','1');
   const a=element('a','result');a.href=url.href;
   const top=element('div','topline');top.append(element('span','label',page.label),element('span','unit',page.unit),element('span','score',hit.label));
   const context=element('div','context',hit.display);context.style&&(context.style.whiteSpace='pre-line');a.append(top,context);
   if(hit.display!==line.t){const original=element('details','ocr-original'),summary=element('summary','','OCR原文を確認');original.append(summary,element('div','status',line.t));original.addEventListener('click',event=>{event.preventDefault();if(event.target===summary)original.open=!original.open;});a.append(original);}
   if(owner&&exclusionsReady&&hit.source!=='orange'){
    const row=element('div','ocr-owner-result'),button=element('button','ocr-owner-button','検索から除外');
    button.type='button';button.setAttribute('aria-label',hit.display.slice(0,60)+'を検索から除外');
    const target={page:page.key,no:page.no,rect:normalizedRect(page,line)};
    button.addEventListener('click',()=>setExcluded(target,true,button));
    row.append(a,button);results.append(row);
   }else results.append(a);
  }
  if(found.length>limit){
   const more=element('button','','文字検索の続きを表示');
   more.type='button';
   more.addEventListener('click',()=>{const start=limit;limit+=pageSize;render();(results.children[start]?.querySelector('.result')||results.children[start])?.focus();});
   results.append(more);
  }
 }
 input.addEventListener('input',()=>{clearTimeout(timer);limit=pageSize;timer=setTimeout(render,160);});
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
  await Promise.all([orangeLoad,exclusionsLoad]);
  const initial=new URLSearchParams(location.search).get('q');
  loaded=true;render();if(initial)input.focus();
 }).catch(()=>{status.textContent='OCRデータを読み込めませんでした。メモ検索は継続します。';});
 window.KopuriSearchTest={fuzzy,render};
})();

