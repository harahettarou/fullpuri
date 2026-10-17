/* Event overlays are independent of political data and never receive map clicks. */
(() => {
  'use strict';
  const EMPTY = {type:'FeatureCollection',features:[]};
  const SOURCE = 'timeline-event-location';
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let map, catalog, selectedId = new URLSearchParams(location.search).get('event'), markers=[], loadFailed=false;
  let request = 0;
  const panel = () => document.getElementById('eventLocationPanel');
  const record = () => catalog?.events.find(e=>e.id===selectedId);
  function clearGeometry(){markers.forEach(m=>m.remove());markers=[];map?.getSource(SOURCE)?.setData(EMPTY);}
  function setUrl(id){const u=new URL(location.href);if(id)u.searchParams.set('event',id);else u.searchParams.delete('event');history.replaceState(null,'',u);}
  function clear(){++request;selectedId=null;clearGeometry();panel().hidden=true;setUrl(null);}
  function panelMessage(message){panel().hidden=false;panel().innerHTML=`<span>${esc(message)}</span><button type="button" data-event-clear>閉じる</button>`;}
  function renderInfo(e){
    panel().hidden=false;
    const sources=(e.sources||[]).map(s=>catalog.sources[s]).filter(Boolean);
    panel().innerHTML=`<div class="eventLocationHead"><strong><i class="eventRingSample" aria-hidden="true"></i>${esc(e.event)}</strong><div><button type="button" data-event-focus>場所へ</button><button type="button" data-event-clear aria-label="出来事の強調表示を消す">×</button></div></div><div class="eventLocationCaption">${esc(e.date)} · <b>${esc(e.accuracyLabel)}</b> · ${esc(e.locations.map(p=>p.name).join('／'))}${e.year===null?' · 年号なし（表示年を維持）':''}</div><details><summary>場所の精度・出典</summary><p>${esc(e.note)}</p>${e.year===null?'<p>年号なしの項目です。表示年は変更していません。</p>':''}${e.year < -3400?'<p>この年は政治領域データの収録範囲外です。背景地図と出来事の場所を表示します。</p>':''}<ul>${sources.map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>${s.note?` — ${esc(s.note)}`:''}</li>`).join('')}</ul><small>確認日：${esc(e.checkedAt)}。赤い点線は出来事の場所を示し、政治領域・国境を示しません。</small></details>`;
  }
  function coordinates(g){return g.type==='Point'?[g.coordinates]:g.type==='Polygon'?g.coordinates.flat():g.type==='MultiPolygon'?g.coordinates.flat(2):g.coordinates;}
  function focus(e){
    if(!map||!e.locations.length)return;
    const pts=e.locations.flatMap(p=>coordinates(p.geometry));
    if(!pts.length)return;
    // Choose the shortest span across the date line instead of fitting the long way around.
    const ordered=pts.map(p=>((p[0]%360)+360)%360).sort((a,b)=>a-b);
    let gap=-1,start=ordered[0];
    ordered.forEach((v,i)=>{const next=ordered[(i+1)%ordered.length]+(i===ordered.length-1?360:0);if(next-v>gap){gap=next-v;start=next%360;}});
    const unwrapped=pts.map(([x,y])=>{x=((x%360)+360)%360;return [x<start?x+360:x,y];});
    const xs=unwrapped.map(p=>p[0]);
    const shift=360*Math.round((Math.min(...xs)+Math.max(...xs))/720);
    unwrapped.forEach(p=>{p[0]-=shift;});
    const bounds=unwrapped.reduce((b,p)=>b.extend(p),new maplibregl.LngLatBounds());
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.fitBounds(bounds,{padding:map.getContainer().clientWidth<520?55:85,maxZoom:e.locations.every(p=>p.geometry.type==='Point')?5.5:4,duration:reduced?0:450});
  }
  function show(fit=true){
    clearGeometry();
    if(!selectedId){panel().hidden=true;return;}
    if(loadFailed){panelMessage('場所データを読み込めませんでした。再読み込みしてください。');return;}
    if(!catalog){panelMessage('出来事の場所を読み込み中…');return;}
    const e=record();if(!e){panelMessage('指定された出来事が見つかりません。総合年表から選び直してください。');return;}
    renderInfo(e);
    if(!map)return;
    if(!map.getSource(SOURCE)){
      map.addSource(SOURCE,{type:'geojson',data:EMPTY});
      map.addLayer({id:SOURCE+'-outline',type:'line',source:SOURCE,filter:['!=',['geometry-type'],'Point'],paint:{'line-color':'#bc2626','line-width':1.6,'line-dasharray':[2,2],'line-opacity':.95}},map.getStyle().layers.find(l=>l.type==='symbol')?.id);
    }
    const features=[];
    e.locations.forEach(p=>{
      if(p.geometry.type==='Point'){
        const el=document.createElement('div');el.className='eventLocationRing';el.setAttribute('aria-hidden','true');el.title=p.name;
        markers.push(new maplibregl.Marker({element:el,anchor:'center'}).setLngLat(p.geometry.coordinates).addTo(map));
      }else features.push({type:'Feature',properties:{name:p.name},geometry:p.geometry});
    });
    map.getSource(SOURCE).setData({type:'FeatureCollection',features});
    if(fit)focus(e);
  }
  async function select(id){
    const seq=++request;clearGeometry();selectedId=id;
    if(!catalog){show(false);await loading;if(seq!==request)return;}
    const e=record();
    if(e&&Number.isFinite(e.year))window.__fullpuriSetMapYear?.(e.year);
    setUrl(id);show();
  }
  window.FullpuriEventMap={
    onMapReady(m){map=m;show();},
    onYearChange(year){const e=record();if(e&&e.year!==null&&e.year!==year)clear();},
    select,clear,
    get selected(){return record();}
  };
  document.addEventListener('click',e=>{
    if(e.target.closest('[data-event-clear]'))clear();
    if(e.target.closest('[data-event-focus]')&&record())focus(record());
    const b=e.target.closest('[data-map-event]');if(b)select(b.dataset.mapEvent);
  });
  const loading=fetch('../assets/historical-map/event-locations.json?v=20261017').then(r=>{if(!r.ok)throw Error(r.status);return r.json();}).then(data=>{catalog=data;if(selectedId)select(selectedId);}).catch(error=>{console.warn('Event locations',error);loadFailed=true;if(selectedId)show(false);});
  addEventListener('popstate',()=>{++request;selectedId=new URLSearchParams(location.search).get('event');show();});
  if(selectedId)show(false);
})();
