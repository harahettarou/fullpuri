(() => {
  'use strict';
  const STYLE_URL = 'https://www.openhistoricalmap.org/map-styles/main/main.json';
  const START_VIEW = { center: [15, 23], zoom: 1.25 };
  const MIN_HUMAN_YEAR = -5000;
  const MAX_HUMAN_YEAR = 2026;
  const $ = id => document.getElementById(id);
  const era = $('era'), yearInput = $('yearInput'), slider = $('yearSlider');
  const currentYear = $('currentYear'), status = $('mapStatus');
  const featureInfo = $('featureInfo'), nearbyEvents = $('nearbyEvents'), relatedPrints = $('relatedPrints');
  let humanYear = 1848;
  let map = null;
  let mapReady = false;
  let timelineEvents = [];
  let manifestRanges = [];
  let selectedFeature = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const humanToAstronomical = year => year < 0 ? year + 1 : year;
  const astronomicalToHuman = year => year <= 0 ? year - 1 : year;
  const labelYear = year => year < 0 ? `紀元前${Math.abs(year)}年` : `西暦${year}年`;
  const ohmYear = year => String(humanToAstronomical(year));
  const stepYear = (year, amount) => {
    if (amount > 0 && year === -1) return 1;
    if (amount < 0 && year === 1) return -1;
    return year + amount;
  };

  function parseRequestedYear() {
    const params = new URLSearchParams(location.search);
    let raw = Number(params.get('year'));
    if (!Number.isInteger(raw) || raw === 0) return 1848;
    return clamp(raw, MIN_HUMAN_YEAR, MAX_HUMAN_YEAR);
  }

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function updateYear(next, pushUrl = true) {
    next = Number(next);
    if (!Number.isInteger(next) || next === 0) return;
    humanYear = clamp(next, MIN_HUMAN_YEAR, MAX_HUMAN_YEAR);
    era.value = humanYear < 0 ? 'bce' : 'ce';
    yearInput.value = Math.abs(humanYear);
    slider.value = humanToAstronomical(humanYear);
    currentYear.textContent = labelYear(humanYear);
    const timelineUrl = `timeline.html?year=${humanYear}`;
    $('timelineLinkTop').href = timelineUrl;
    if (pushUrl) {
      const url = new URL(location.href);
      url.searchParams.set('year', humanYear);
      history.replaceState(null, '', url);
    }
    applyDateFilter();
    renderRelated();
  }

  function applyDateFilter() {
    if (!mapReady || !map) return;
    try {
      map.filterByDate(ohmYear(humanYear));
      setStatus(`${labelYear(humanYear)}のOHM収録データを表示中。未収録の地域・年代は空白になる場合があります。`);
    } catch (error) {
      console.error(error);
      setStatus('年の切り替えに失敗しました。ページを再読み込みしてください。', true);
    }
  }

  function getName(properties = {}) {
    return properties['name:ja'] || properties.name_ja || properties.name || properties.official_name || properties.subject || '名称未登録の領域';
  }

  function pickFeature(features) {
    const named = features.filter(feature => getName(feature.properties || {}) !== '名称未登録の領域');
    const areas = named.filter(feature => feature.geometry && /Polygon/.test(feature.geometry.type));
    return areas[0] || named[0] || null;
  }

  function showFeature(feature) {
    selectedFeature = feature;
    if (!feature) {
      featureInfo.innerHTML = '<div class="emptyInfo">この位置では、クリックできる名称付き領域を確認できませんでした。OHMに未収録の場合があります。</div>';
      renderRelated();
      return;
    }
    const p = feature.properties || {};
    const name = getName(p);
    const start = p.start_date || p.start_decdate || '登録なし';
    const end = p.end_date || p.end_decdate || '登録なし';
    const source = p.source || p['source:name'] || '個別記載なし（OpenHistoricalMap）';
    const license = p.license || 'OHM全体の条件を参照';
    const sourceLayer = feature.sourceLayer || feature.layer?.['source-layer'] || '不明';
    featureInfo.innerHTML = `<div class="featureName">${esc(name)}</div><dl class="factGrid"><dt>表示年</dt><dd>${esc(labelYear(humanYear))}</dd><dt>収録期間</dt><dd>${esc(start)} ～ ${esc(end)}</dd><dt>OHMレイヤー</dt><dd>${esc(sourceLayer)}</dd><dt>個別出典</dt><dd>${esc(source)}</dd><dt>ライセンス</dt><dd>${esc(license)}</dd></dl>`;
    renderRelated();
  }

  function eventScore(event, tokens) {
    const distance = Math.abs(Number(event.sort) - humanYear);
    const haystack = `${event.event} ${event.detail || ''} ${(event.regions || []).join(' ')}`.toLowerCase();
    const nameMatch = tokens.some(token => token.length >= 2 && haystack.includes(token)) ? 1000 : 0;
    return nameMatch - distance;
  }

  function getNearbyEvents() {
    const name = selectedFeature ? getName(selectedFeature.properties || {}) : '';
    const tokens = name.toLowerCase().split(/[\s・＝=()（）,、/]+/).filter(Boolean);
    const usable = timelineEvents.filter(event => Number.isFinite(event.sort));
    const close = usable.filter(event => Math.abs(event.sort - humanYear) <= (Math.abs(humanYear) < 1000 ? 15 : 5));
    const candidates = close.length ? close : usable.slice().sort((a,b) => Math.abs(a.sort-humanYear)-Math.abs(b.sort-humanYear)).slice(0,12);
    return candidates.slice().sort((a,b) => eventScore(b,tokens)-eventScore(a,tokens) || a.sort-b.sort).slice(0,10);
  }

  function findRange(no) {
    return manifestRanges.find(range => range.start <= no && range.end >= no) || null;
  }

  function renderRelated() {
    if (!timelineEvents.length) return;
    const events = getNearbyEvents();
    nearbyEvents.innerHTML = events.length ? events.map(event => `<div class="eventItem"><div class="eventDate">${esc(event.date)}</div><div class="eventTitle">${esc(event.event)}</div>${event.detail ? `<div class="eventDetail">${esc(event.detail)}</div>` : ''}</div>`).join('') : '<div class="emptyInfo">この年の近くに、総合年表の項目はありません。</div>';
    const printMap = new Map();
    for (const event of events) {
      const range = findRange(event.noStart);
      if (range && !printMap.has(range.file)) printMap.set(range.file, {range, source:event.source});
    }
    const prints = [...printMap.values()].slice(0,8);
    relatedPrints.innerHTML = prints.length ? prints.map(({range,source}) => `<a class="printLink" href="../${esc(range.file)}"><strong>No.${String(range.start).padStart(3,'0')}${range.end !== range.start ? `–${String(range.end).padStart(3,'0')}` : ''} ${esc(range.title)}</strong><span>${esc(source)}</span></a>`).join('') : '<div class="emptyInfo">この年の近くに、古プリ出典付きの年表項目はありません。</div>';
  }

  async function loadRelatedData() {
    try {
      const [eventsResponse, manifestResponse] = await Promise.all([fetch('../assets/historical-map/timeline-events.json'), fetch('../manifest.json')]);
      if (!eventsResponse.ok || !manifestResponse.ok) throw new Error('related data unavailable');
      timelineEvents = await eventsResponse.json();
      manifestRanges = (await manifestResponse.json()).ranges || [];
      renderRelated();
    } catch (error) {
      nearbyEvents.innerHTML = '<div class="emptyInfo">年表データを読み込めませんでした。</div>';
      relatedPrints.innerHTML = '<div class="emptyInfo">古プリとの関連を読み込めませんでした。</div>';
    }
  }

  function initMap() {
    if (!window.maplibregl) {
      setStatus('地図表示プログラムを読み込めませんでした。', true);
      return;
    }
    try {
      map = new maplibregl.Map({container:'map',style:STYLE_URL,center:START_VIEW.center,zoom:START_VIEW.zoom,minZoom:0.5,maxZoom:12,attributionControl:false,renderWorldCopies:false});
      map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'<a href="https://www.openhistoricalmap.org/copyright" target="_blank">OpenHistoricalMap</a>'}), 'bottom-right');
      map.once('styledata', () => { mapReady = true; applyDateFilter(); });
      map.on('click', event => showFeature(pickFeature(map.queryRenderedFeatures(event.point))));
      map.on('mousemove', event => {
        const clickable = pickFeature(map.queryRenderedFeatures(event.point));
        map.getCanvas().style.cursor = clickable ? 'pointer' : '';
      });
      let loaded = false;
      map.on('load', () => { loaded = true; mapReady = true; applyDateFilter(); });
      setTimeout(() => { if (!loaded) setStatus('地図データの読み込みに時間がかかっています。通信状態を確認してください。', true); }, 15000);
      map.on('error', event => {
        if (!loaded) setStatus('OpenHistoricalMapを読み込めません。通信状態を確認して再読み込みしてください。', true);
        console.warn('Map error', event.error || event);
      });
    } catch (error) {
      console.error(error);
      setStatus('地図を初期化できませんでした。', true);
    }
  }

  era.addEventListener('change', () => updateYear((era.value === 'bce' ? -1 : 1) * Math.max(1, Number(yearInput.value) || 1)));
  yearInput.addEventListener('input', () => {
    const entered = Number(yearInput.value);
    if (Number.isInteger(entered) && entered >= 1) updateYear((era.value === 'bce' ? -1 : 1) * entered);
  });
  slider.addEventListener('input', () => updateYear(astronomicalToHuman(Number(slider.value))));
  $('previousYear').addEventListener('click', () => updateYear(stepYear(humanYear, -1)));
  $('nextYear').addEventListener('click', () => updateYear(stepYear(humanYear, 1)));
  document.querySelector('.presetYears').addEventListener('click', event => { const button = event.target.closest('[data-year]'); if (button) updateYear(Number(button.dataset.year)); });
  $('zoomIn').addEventListener('click', () => map && map.zoomIn());
  $('zoomOut').addEventListener('click', () => map && map.zoomOut());
  $('resetMap').addEventListener('click', () => map && map.easeTo({...START_VIEW,duration:500}));
  addEventListener('popstate', () => updateYear(parseRequestedYear(), false));

  updateYear(parseRequestedYear(), false);
  loadRelatedData();
  initMap();
})();
