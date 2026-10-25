// Size changes never rebuild account controls or the settings dialog.
// Percent anchors follow the image during a gesture; only margin placement
// needs a new collision pass once resizing has settled.
export function observeLayout(stage, needsLayout, layout) {
 let timer=0, width=-1, height=-1;
 const observer=new ResizeObserver(entries=>{
  const rect=entries[0].contentRect;
  if(rect.width===width&&rect.height===height)return;
  width=rect.width;height=rect.height;
  clearTimeout(timer);
  if(needsLayout())timer=setTimeout(()=>{timer=0;layout()},120);
 });
 observer.observe(stage);
 return ()=>{clearTimeout(timer);timer=0};
}

// Small, per-viewer cache, including in-flight requests. Failed requests may
// be retried; century/region browsing cannot retain an unbounded catalog.
export function targetCache(rootURL,limit=3){
 const cache=new Map();
 return no=>{
  if(cache.has(no)){const value=cache.get(no);cache.delete(no);cache.set(no,value);return value}
  const value=fetch(new URL(`assets/review/targets/No${String(no).padStart(3,'0')}.json`,rootURL))
   .then(response=>{if(!response.ok)throw Error('チェック座標を取得できません');return response.json()})
   .catch(error=>{if(cache.get(no)===value)cache.delete(no);throw error});
  cache.set(no,value);
  if(cache.size>limit)cache.delete(cache.keys().next().value);
  return value;
 };
}
