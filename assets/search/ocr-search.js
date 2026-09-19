/* Offline-built overlay; raw index remains the authoritative coordinate source. */
window.OcrCorrectionSearch = (() => {
 let overlay={rows:{},aliases:{}};
 function normalize(s){return s.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-96)).replace(/[^0-9a-zぁ-ん一-龯々〆ヵヶ]+/g,'')}
 async function load(){
  try {
   const [raw,r]=await Promise.all([fetch('../assets/search/ocr-index.json',{cache:'no-cache'}),fetch('../assets/search/ocr-search-overlay.json',{cache:'no-cache'})]);
   if(!raw.ok||!r.ok)throw Error('unavailable');
   const [bytes,data]=await Promise.all([raw.arrayBuffer(),r.json()]);
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(digest!==data.source_sha256)throw Error('stale overlay');
   overlay=data;
   for(const row of Object.values(overlay.rows))row.termNorms=row.terms.map(normalize);
   overlay.aliasPairs=Object.entries(overlay.aliases).map(([a,b])=>[normalize(a),normalize(b)]);
   return true;
  }catch(e){console.warn('OCR補正データは利用できません。原文検索を継続します。');return false;}
 }
 function match(query,page,line,index,fuzzy){
  const row=overlay.rows[page.key+':'+index];
  if(line.n.includes(query))return {score:1,rank:3,matchLabel:'完全一致'};
  if(row&&row.raw_text===line.t&&['auto','manual'].includes(row.status)&&row.n.includes(query))return {score:1,rank:2,matchLabel:'補正後一致'};
  const aliases=[query];
  for(const [a,b] of overlay.aliasPairs||[])if(query===a)aliases.push(b);else if(query===b)aliases.push(a);
  if(aliases.slice(1).some(q=>line.n.includes(q)||(row&&row.raw_text===line.t&&row.n.includes(q))))return {score:1,rank:2,matchLabel:'表記揺れ一致'};
  if(row&&row.raw_text===line.t&&row.termNorms.some(t=>aliases.includes(t)))return {score:.95,rank:1,matchLabel:'補正候補（未確定）'};
  const score=fuzzy(query,line.n);return {score,rank:1,matchLabel:'近い候補'};
 }
 return {load,match};
})();
