(() => {
  'use strict';

  const STYLE_URL = 'https://www.openhistoricalmap.org/map-styles/main/main.json';
  const START_VIEW = { center: [15, 23], zoom: 1.25 };
  const MIN_HUMAN_YEAR = -5000;
  const MAX_HUMAN_YEAR = 2026;
  const CSHAPES_START = 1886;
  const CSHAPES_END = 2017;
  const CSHAPES_BASE = '../assets/historical-map/cshapes/';
  const CSHAPES_BUCKETS = [
    { start: 1886, end: 1913, file: 'cshapes-1886-1913.json' },
    { start: 1914, end: 1945, file: 'cshapes-1914-1945.json' },
    { start: 1946, end: 1990, file: 'cshapes-1946-1990.json' },
    { start: 1991, end: 2017, file: 'cshapes-1991-2017.json' }
  ];
  const PALETTE = [
    '#e9a3a3', '#9fc5e8', '#b6d7a8', '#ffe599', '#d5a6bd', '#a2c4c9',
    '#f6b26b', '#b4a7d6', '#76a5af', '#c9daf8', '#93c47d', '#ffd966'
  ];
  const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };
  const $ = id => document.getElementById(id);
  const era = $('era');
  const yearInput = $('yearInput');
  const slider = $('yearSlider');
  const currentYear = $('currentYear');
  const dataSource = $('dataSource');
  const mapLegend = $('mapLegend');
  const status = $('mapStatus');
  const featureInfo = $('featureInfo');
  const nearbyEvents = $('nearbyEvents');
  const relatedPrints = $('relatedPrints');

  let humanYear = 1848;
  let map = null;
  let mapReady = false;
  let timelineEvents = [];
  let manifestRanges = [];
  let selectedFeature = null;
  let activeCShapesFile = '';
  let cshapesAbort = null;
  let updateTimer = 0;
  let loadSequence = 0;
  const originalVisibility = new Map();

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const humanToAstronomical = year => year < 0 ? year + 1 : year;
  const astronomicalToHuman = year => year <= 0 ? year - 1 : year;
  const labelYear = year => year < 0 ? `紀元前${Math.abs(year)}年` : `西暦${year}年`;
  const ohmYear = year => String(humanToAstronomical(year));
  const isCShapesYear = year => year >= CSHAPES_START && year <= CSHAPES_END;
  const stepYear = (year, amount) => {
    if (amount > 0 && year === -1) return 1;
    if (amount < 0 && year === 1) return -1;
    return year + amount;
  };

  function parseRequestedYear() {
    const params = new URLSearchParams(location.search);
    const raw = Number(params.get('year'));
    if (!Number.isInteger(raw) || raw === 0) return 1848;
    return clamp(raw, MIN_HUMAN_YEAR, MAX_HUMAN_YEAR);
  }

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function updateSourceUI(mode, fallback = false) {
    if (mode === 'cshapes') {
      dataSource.textContent = 'CShapes 2.0';
      mapLegend.hidden = false;
      return;
    }
    dataSource.textContent = fallback ? 'OHM（代替表示）' : 'OpenHistoricalMap';
    mapLegend.hidden = true;
  }

  function updateYear(next, pushUrl = true, immediateMap = false) {
    next = Number(next);
    if (!Number.isInteger(next) || next === 0) return;
    humanYear = clamp(next, MIN_HUMAN_YEAR, MAX_HUMAN_YEAR);
    era.value = humanYear < 0 ? 'bce' : 'ce';
    yearInput.value = Math.abs(humanYear);
    slider.value = humanToAstronomical(humanYear);
    currentYear.textContent = labelYear(humanYear);
    $('timelineLinkTop').href = `timeline.html?year=${humanYear}`;
    if (pushUrl) {
      const url = new URL(location.href);
      url.searchParams.set('year', humanYear);
      history.replaceState(null, '', url);
    }
    selectedFeature = null;
    scheduleMapUpdate(immediateMap);
    renderRelated();
  }

  function scheduleMapUpdate(immediate = false) {
    clearTimeout(updateTimer);
    if (immediate) {
      applyYearToMap();
    } else {
      updateTimer = setTimeout(applyYearToMap, 180);
    }
  }

  function cshapesBucket(year) {
    return CSHAPES_BUCKETS.find(bucket => year >= bucket.start && year <= bucket.end);
  }

  function dateIntForYear(year) {
    return year * 10000 + 101;
  }

  function colorExpression() {
    const expression = ['match', ['get', 'c']];
    PALETTE.forEach((color, index) => expression.push(index, color));
    expression.push('#c9c4ba');
    return expression;
  }

  function addCShapesLayers() {
    if (map.getSource('cshapes')) return;
    map.addSource('cshapes', { type: 'geojson', data: EMPTY_GEOJSON });
    map.addSource('cshapes-labels', { type: 'geojson', data: EMPTY_GEOJSON });
    const firstSymbol = map.getStyle().layers.find(layer => layer.type === 'symbol');
    const beforeId = firstSymbol ? firstSymbol.id : undefined;
    map.addLayer({
      id: 'cshapes-fill',
      type: 'fill',
      source: 'cshapes',
      layout: { visibility: 'none' },
      paint: {
        'fill-color': colorExpression(),
        'fill-opacity': 0.76
      }
    }, beforeId);
    map.addLayer({
      id: 'cshapes-boundary',
      type: 'line',
      source: 'cshapes',
      layout: { visibility: 'none' },
      paint: {
        'line-color': '#3f3a32',
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.55, 4, 1.25, 8, 2],
        'line-opacity': 0.9
      }
    }, beforeId);
    map.addLayer({
      id: 'cshapes-label',
      type: 'symbol',
      source: 'cshapes-labels',
      layout: {
        visibility: 'none',
        'text-field': ['get', 'n'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 5, 13],
        'text-max-width': 8,
        'text-allow-overlap': false,
        'text-ignore-placement': false
      },
      paint: {
        'text-color': '#24201b',
        'text-halo-color': 'rgba(255,255,255,0.92)',
        'text-halo-width': 1.4
      }
    });
  }

  function localizeOHMLabels() {
    const japaneseOnly = ['coalesce', ['get', 'name:ja'], ['get', 'name_ja'], ''];
    for (const layer of map.getStyle().layers) {
      if (layer.type !== 'symbol' || !layer.layout || !('text-field' in layer.layout)) continue;
      try {
        map.setLayoutProperty(layer.id, 'text-field', japaneseOnly);
      } catch (error) {
        console.debug('日本語ラベルへ変更できないレイヤー', layer.id, error);
      }
    }
  }

  function isPhysicalBaseLayer(layer) {
    if (layer.type === 'background') return true;
    if (layer.type === 'symbol') return false;
    const sourceLayer = String(layer['source-layer'] || '').toLowerCase();
    return /^(land|water|natural|coastline)/.test(sourceLayer);
  }

  function setReducedOHMMode(enabled) {
    for (const layer of map.getStyle().layers) {
      if (layer.id.startsWith('cshapes-')) continue;
      if (!originalVisibility.has(layer.id)) {
        originalVisibility.set(layer.id, map.getLayoutProperty(layer.id, 'visibility') || 'visible');
      }
      const visibility = enabled
        ? (isPhysicalBaseLayer(layer) ? originalVisibility.get(layer.id) : 'none')
        : originalVisibility.get(layer.id);
      try {
        map.setLayoutProperty(layer.id, 'visibility', visibility);
      } catch (error) {
        console.debug('レイヤー表示切替を省略', layer.id, error);
      }
    }
  }

  function setCShapesVisibility(visible) {
    for (const id of ['cshapes-fill', 'cshapes-boundary', 'cshapes-label']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  }

  function filterCShapes(year) {
    const target = dateIntForYear(year);
    const filter = ['all', ['<=', ['get', 's'], target], ['>', ['get', 'e'], target]];
    for (const id of ['cshapes-fill', 'cshapes-boundary', 'cshapes-label']) {
      if (map.getLayer(id)) map.setFilter(id, filter);
    }
  }

  function makeCShapesLabelPoints(geojson) {
    return {
      type: 'FeatureCollection',
      features: geojson.features.map(feature => ({
        type: 'Feature',
        properties: feature.properties,
        geometry: {
          type: 'Point',
          coordinates: [feature.properties.x, feature.properties.y]
        }
      }))
    };
  }

  async function showCShapes(year) {
    const bucket = cshapesBucket(year);
    if (!bucket) return;
    const sequence = ++loadSequence;
    updateSourceUI('cshapes');
    setReducedOHMMode(true);
    setCShapesVisibility(true);
    filterCShapes(year);

    if (activeCShapesFile === bucket.file) {
      setStatus(`${labelYear(year)}1月1日時点のCShapes 2.0国境を表示中。`);
      return;
    }

    if (cshapesAbort) cshapesAbort.abort();
    cshapesAbort = new AbortController();
    setStatus(`CShapes 2.0の${labelYear(year)}データを読み込み中…`);
    try {
      const response = await fetch(CSHAPES_BASE + bucket.file, { signal: cshapesAbort.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const geojson = await response.json();
      if (sequence !== loadSequence || !isCShapesYear(humanYear)) return;
      map.getSource('cshapes').setData(geojson);
      map.getSource('cshapes-labels').setData(makeCShapesLabelPoints(geojson));
      activeCShapesFile = bucket.file;
      filterCShapes(humanYear);
      setStatus(`${labelYear(humanYear)}1月1日時点のCShapes 2.0国境を表示中。`);
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error(error);
      setCShapesVisibility(false);
      setReducedOHMMode(false);
      updateSourceUI('ohm', true);
      applyOHMDate(true);
      setStatus('CShapes 2.0を読み込めなかったため、OpenHistoricalMapで代替表示しています。', true);
    }
  }

  function applyOHMDate(isFallback = false) {
    ++loadSequence;
    if (cshapesAbort) cshapesAbort.abort();
    setCShapesVisibility(false);
    setReducedOHMMode(false);
    updateSourceUI('ohm', isFallback);
    try {
      if (typeof map.filterByDate !== 'function') throw new Error('OHM日付フィルターがありません');
      map.filterByDate(ohmYear(humanYear));
      if (!isFallback) {
        setStatus(`${labelYear(humanYear)}のOpenHistoricalMap収録データを表示中。未収録の地域・年代は空白になる場合があります。`);
      }
    } catch (error) {
      console.error(error);
      setStatus('年の切り替えに失敗しました。ページを再読み込みしてください。', true);
    }
  }

  function applyYearToMap() {
    if (!mapReady || !map) return;
    if (isCShapesYear(humanYear)) {
      showCShapes(humanYear);
    } else {
      applyOHMDate(false);
    }
  }

  function getName(properties = {}) {
    return properties.n || properties['name:ja'] || properties.name_ja || '日本語名未登録の領域';
  }

  function pickFeature(features) {
    const cshapes = features.find(feature => feature.source === 'cshapes');
    if (cshapes) return cshapes;
    const named = features.filter(feature => getName(feature.properties || {}) !== '日本語名未登録の領域');
    const areas = named.filter(feature => feature.geometry && /Polygon/.test(feature.geometry.type));
    return areas[0] || named[0] || null;
  }

  function formatDateInt(value) {
    const raw = String(value || '').padStart(8, '0');
    if (!/^\d{8}$/.test(raw)) return '登録なし';
    return `${Number(raw.slice(0, 4))}年${Number(raw.slice(4, 6))}月${Number(raw.slice(6, 8))}日`;
  }

  function formatOHMDate(value) {
    if (value === undefined || value === null || value === '') return '登録なし';
    const raw = String(value);
    const match = raw.match(/^(-?\d{1,6})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/);
    if (!match) return raw;
    const astronomical = Number(match[1]);
    const human = astronomicalToHuman(astronomical);
    const suffix = match[2] ? `${Number(match[2])}月${match[3] ? `${Number(match[3])}日` : ''}` : '';
    return `${labelYear(human)}${suffix}`;
  }

  function showFeature(feature) {
    selectedFeature = feature;
    if (!feature) {
      featureInfo.innerHTML = '<div class="emptyInfo">この位置では、日本語名付きの領域を確認できませんでした。</div>';
      renderRelated();
      return;
    }
    const p = feature.properties || {};
    const name = getName(p);
    if (feature.source === 'cshapes') {
      featureInfo.innerHTML = `<div class="featureName">${esc(name)}</div><dl class="factGrid"><dt>表示時点</dt><dd>${esc(labelYear(humanYear))}1月1日</dd><dt>収録期間</dt><dd>${esc(formatDateInt(p.s))} ～ ${esc(formatDateInt(p.e))}</dd><dt>データ</dt><dd>CShapes 2.0</dd><dt>出典</dt><dd>Schvitzほか（2022）</dd><dt>ライセンス</dt><dd>CC BY-NC-SA 4.0</dd></dl>`;
    } else {
      const start = formatOHMDate(p.start_date || p.start_decdate);
      const end = formatOHMDate(p.end_date || p.end_decdate);
      const sourceLayer = feature.sourceLayer || feature.layer?.['source-layer'] || '不明';
      featureInfo.innerHTML = `<div class="featureName">${esc(name)}</div><dl class="factGrid"><dt>表示年</dt><dd>${esc(labelYear(humanYear))}</dd><dt>収録期間</dt><dd>${esc(start)} ～ ${esc(end)}</dd><dt>OHMレイヤー</dt><dd>${esc(sourceLayer)}</dd><dt>データ</dt><dd>OpenHistoricalMap</dd><dt>ライセンス</dt><dd>OHMの著作権表示を参照</dd></dl>`;
    }
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
    const candidates = close.length ? close : usable.slice().sort((a, b) => Math.abs(a.sort - humanYear) - Math.abs(b.sort - humanYear)).slice(0, 12);
    return candidates.slice().sort((a, b) => eventScore(b, tokens) - eventScore(a, tokens) || a.sort - b.sort).slice(0, 10);
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
      if (range && !printMap.has(range.file)) printMap.set(range.file, { range, source: event.source });
    }
    const prints = [...printMap.values()].slice(0, 8);
    relatedPrints.innerHTML = prints.length ? prints.map(({ range, source }) => `<a class="printLink" href="../${esc(range.file)}"><strong>No.${String(range.start).padStart(3, '0')}${range.end !== range.start ? `–${String(range.end).padStart(3, '0')}` : ''} ${esc(range.title)}</strong><span>${esc(source)}</span></a>`).join('') : '<div class="emptyInfo">この年の近くに、古プリ出典付きの年表項目はありません。</div>';
  }

  async function loadRelatedData() {
    try {
      const [eventsResponse, manifestResponse] = await Promise.all([
        fetch('../assets/historical-map/timeline-events.json'),
        fetch('../manifest.json')
      ]);
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
      map = new maplibregl.Map({
        container: 'map',
        style: STYLE_URL,
        center: START_VIEW.center,
        zoom: START_VIEW.zoom,
        minZoom: 0.5,
        maxZoom: 12,
        attributionControl: false,
        renderWorldCopies: false,
        fadeDuration: 0,
        crossSourceCollisions: false,
        maxTileCacheSize: 32
      });
      map.addControl(new maplibregl.AttributionControl({
        compact: true,
        customAttribution: '<a href="https://www.openhistoricalmap.org/copyright" target="_blank">OpenHistoricalMap</a> | <a href="https://icr.ethz.ch/data/cshapes/" target="_blank">CShapes 2.0</a>・<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.ja" target="_blank">CC BY-NC-SA 4.0</a>'
      }), 'bottom-right');
      map.once('load', () => {
        mapReady = true;
        localizeOHMLabels();
        addCShapesLayers();
        applyYearToMap();
      });
      map.on('click', event => {
        const features = map.queryRenderedFeatures(event.point, {
          layers: map.getStyle().layers.filter(layer => map.getLayer(layer.id) && map.getLayoutProperty(layer.id, 'visibility') !== 'none').map(layer => layer.id)
        });
        showFeature(pickFeature(features));
      });
      let loaded = false;
      map.on('load', () => { loaded = true; });
      setTimeout(() => {
        if (!loaded) setStatus('地図データの読み込みに時間がかかっています。通信状態を確認してください。', true);
      }, 15000);
      map.on('error', event => {
        if (!loaded) setStatus('地図の背景データを読み込めません。通信状態を確認してください。', true);
        console.warn('Map error', event.error || event);
      });
    } catch (error) {
      console.error(error);
      setStatus('地図を初期化できませんでした。', true);
    }
  }

  era.addEventListener('change', () => updateYear((era.value === 'bce' ? -1 : 1) * Math.max(1, Number(yearInput.value) || 1), true, true));
  yearInput.addEventListener('input', () => {
    const entered = Number(yearInput.value);
    if (Number.isInteger(entered) && entered >= 1) updateYear((era.value === 'bce' ? -1 : 1) * entered);
  });
  slider.addEventListener('input', () => updateYear(astronomicalToHuman(Number(slider.value))));
  $('previousYear').addEventListener('click', () => updateYear(stepYear(humanYear, -1), true, true));
  $('nextYear').addEventListener('click', () => updateYear(stepYear(humanYear, 1), true, true));
  document.querySelector('.presetYears').addEventListener('click', event => {
    const button = event.target.closest('[data-year]');
    if (button) updateYear(Number(button.dataset.year), true, true);
  });
  $('zoomIn').addEventListener('click', () => map && map.zoomIn());
  $('zoomOut').addEventListener('click', () => map && map.zoomOut());
  $('resetMap').addEventListener('click', () => map && map.easeTo({ ...START_VIEW, duration: 300 }));
  addEventListener('popstate', () => updateYear(parseRequestedYear(), false, true));

  updateYear(parseRequestedYear(), false);
  loadRelatedData();
  initMap();
})();
