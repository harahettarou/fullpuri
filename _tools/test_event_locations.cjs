// Run from any directory: node _tools/test_event_locations.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const data=JSON.parse(read('pages/timeline.html').match(/const DATA=(\[.*?\]);/s)[1]);
const catalog=JSON.parse(read('assets/historical-map/event-locations.json'));
const companion=JSON.parse(read('assets/historical-map/timeline-events.json'));
assert.equal(catalog.events.length,data.length);assert.equal(companion.length,data.length);
assert.equal(new Set(catalog.events.map(e=>e.id)).size,data.length);
function coordinates(c){if(typeof c[0]==='number'){assert.equal(c.length,2);assert(c.every(Number.isFinite));assert(c[0]>=-180&&c[0]<=180&&c[1]>=-90&&c[1]<=90);}else c.forEach(coordinates);}
for(let i=0;i<data.length;i++){
  const e=catalog.events[i];assert.equal(e.id,data[i].id);assert.equal(e.id,companion[i].id);assert.equal(e.event,data[i].event);assert.equal(e.year,data[i].mapYear);
  assert(e.locations.length);assert(e.sources.length);assert(e.note);assert(e.checkedAt);assert(e.accuracyLabel);
  for(const s of e.sources)assert.match(catalog.sources[s].url,/^https:\/\//);
  for(const l of e.locations){assert(l.name);assert(['Point','Polygon'].includes(l.geometry.type));coordinates(l.geometry.coordinates);if(l.geometry.type==='Polygon'){assert.match(e.accuracyLabel,/推定/);for(const ring of l.geometry.coordinates){assert(ring.length>=4);assert.deepEqual(ring[0],ring.at(-1));}}}
}
const main=read('assets/historical-map/historical-map.js');assert(main.includes("layer.id.startsWith('timeline-event-')"));assert(main.includes('onMapReady(map)'));
assert.equal(catalog.events.filter(e=>e.year===null).length,29);
assert.equal(catalog.events[536].year,1789);assert.equal(catalog.events[91].year,-550);
assert.equal(catalog.events[1041].locations.length,17);assert.equal(catalog.events[1136].locations.length,10);assert.equal(catalog.events[1130].locations.length,3);
console.log(`PASS: ${data.length} events, ${Object.keys(catalog.sources).length} reference sources, all IDs/years/geometries/notes valid.`);
