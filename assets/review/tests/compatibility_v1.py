"""Read-only compatibility audit against the actual implementation base commit."""
import pathlib,re,json,subprocess,hashlib,collections
ROOT=pathlib.Path(__file__).resolve().parents[3]
BASE='e75ec42001d07060acb8810d6fcd799da47abcb9'
def old(name):return subprocess.check_output(['git','show',BASE+':'+name],cwd=ROOT).decode()
modified=subprocess.check_output(['git','diff','--name-only','-z',BASE],cwd=ROOT).decode().rstrip('\0').split('\0')
# Existing code and markup must be byte-identical after removing only the deliberate hooks.
for name in modified:
 assert name.endswith('.html'),('unexpected original-file mutation',name)
 text=(ROOT/name).read_text();restored=re.sub(r'\n<!-- kopuri-review-v1 -->\n[\s\S]*?(?=</body>)','',text)
 restored=restored.replace('\n  queueMicrotask(()=>document.dispatchEvent(new Event("kopuri:page")));','',1)
 assert restored==old(name),('original content changed',name)
for f in [ROOT/'index.html',*(ROOT/'pages').rglob('*.html')]:
 t=f.read_text()
 for rel in re.findall(r'(?:src|href)="([^"?#]+)',t):
  if 'assets/review/' in rel:assert (f.parent/rel).exists(),(f,rel)
catalog=json.loads((ROOT/'assets/review/catalog_v1.json').read_text());targets={};counts=collections.Counter()
for f in (ROOT/'assets/review/targets').glob('*.json'):
 for p in json.loads(f.read_text()):
  assert p['key']not in targets;targets[p['key']]=p
  assert p['key']in catalog
  assert (ROOT/p['href']).exists()
  original=old(p['href']);data=json.loads(re.search(r'const PAGES=(\[.*?\]);',original)[1]);source=next(x for x in data if x['key']==p['key']);assert source['width']==p['width'];assert source['height']==p['height']
  for t in p['targets']:
   x,y,w,h=t['rect'];assert 0<=x<=1 and 0<=y<=1 and w>0 and h>0 and x+w<=1.000001 and y+h<=1.000001
   counts[t['color']]+=1
assert set(catalog)==set(targets)
print(json.dumps({'baseline':BASE,'unchanged_existing_content':len(modified),'viewer_hooks':sum('id="stage"'in (ROOT/n).read_text()for n in modified),'pages':len(targets),'targets':dict(counts),'images_OCR_map_zoom_range_code':'unchanged'},ensure_ascii=False))
