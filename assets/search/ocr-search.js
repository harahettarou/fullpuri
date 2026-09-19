/* v19: search overlay only; no correction inference or external API in browser. */
(function(global){
 'use strict';
 const empty=()=>({rows:{},aliases:[]});
 let overlay=empty(),aliasMap=new Map(),ready=false;
 const norm=s=>String(s).normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-96)).replace(/[^0-9a-zぁ-ゖ一-龯々〆ー]/g,'');
 const legacyNorm=s=>String(s).normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-96)).replace(/[^0-9a-zぁ-ん一-龯々〆ヵヶ]/g,'');
 function reset(){overlay=empty();aliasMap=new Map();ready=false;lastQuery='';queryCache=null;}
 function setData(data){
  overlay=data;
  for(const row of Object.values(overlay.rows)){
   row.cn=(row.candidate_texts||[]).map(norm);
   row.tn=(row.terms||[]).map(norm);
  }
  for(const [a,b] of data.aliases||[]){
   const x=norm(a),y=norm(b);
   if(!aliasMap.has(x))aliasMap.set(x,new Set());
   if(!aliasMap.has(y))aliasMap.set(y,new Set());
   aliasMap.get(x).add(y);aliasMap.get(y).add(x);
  }
  ready=true;
 }
 async function load(rawBytes){
  reset();
  try{
   const r=await fetch('../assets/search/ocr-search-overlay.json',{cache:'no-cache'});
   if(!r.ok)throw Error('missing overlay');
   const data=await r.json();
   if(data.version!==19)throw Error('unsupported overlay');
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',rawBytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(hash!==data.source_sha256)throw Error('stale overlay');
   setData(data);return true;
  }catch(error){reset();console.warn('OCR補正データを利用できないため、原文検索を継続します。',error.message);return false;}
 }
 function prepare(pages){for(const p of pages)for(const l of p.lines)l._searchV19=norm(l.t);}
 let lastQuery='',queryCache;
 function query(value){
  if(value===lastQuery&&queryCache)return queryCache;
  const n=norm(value),aliases=[...(aliasMap.get(n)||[])];
  queryCache={n,legacy:legacyNorm(value),aliases};lastQuery=value;return queryCache;
 }
 function match(value,page,line,index,fuzzy){
  const q=query(value),text=line._searchV19||norm(line.t);
  if(!q.n)return {rank:0,score:0,label:''};
  if(text.includes(q.n))return {rank:3,score:1,label:'原文一致',display:line.t};
  const r=overlay.rows[page.key+':'+index];
  const row=r&&r.raw_text===line.t?r:null;
  if(row&&['auto','manual'].includes(row.status)&&row.n.includes(q.n))return {rank:2,score:1,label:row.status==='manual'?'確認済み補正一致':'自動補正一致',display:row.normalized_text};
  if(q.aliases.some(a=>text.includes(a)||(row&&['auto','manual'].includes(row.status)&&row.n.includes(a))))return {rank:2,score:.99,label:'表記揺れ一致',display:row&&row.status!=='candidate'?row.normalized_text:line.t};
  if(row&&[q.n,...q.aliases].some(a=>row.cn.some(t=>t.includes(a))||row.tn.includes(a)))return {rank:1,score:.96,label:'補正候補（未確定）',display:line.t};
  const score=fuzzy(q.legacy,line.n);
  return {rank:score?1:0,score,label:'近い候補',display:line.t};
 }
 global.OcrCorrectionSearch={load,prepare,match,norm,isReady:()=>ready};
 if(typeof module!=='undefined'&&module.exports)module.exports=global.OcrCorrectionSearch;
})(typeof window!=='undefined'?window:globalThis);
