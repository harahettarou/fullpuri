"""Regenerate review-only coordinates. Does not modify OCR, images, or existing data."""
import pathlib,re,json,hashlib,collections
ROOT=pathlib.Path(__file__).resolve().parents[2]
ocr={p['key']:p for p in json.loads((ROOT/'assets/search/ocr-index.json').read_text())['pages']}
manifest=json.loads((ROOT/'manifest.json').read_text())
preferred={x['file'] for x in manifest['ranges']}
pages={}
files=sorted((ROOT/'pages').glob('No*.html'),key=lambda f:(str(f.relative_to(ROOT)) in preferred,str(f)))
for f in files:
 m=re.search(r'const PAGES=(\[.*?\]);',f.read_text())
 if not m:continue
 for p in json.loads(m[1]):pages[p['key']]={**p,'href':str(f.relative_to(ROOT))}
def rect(r,w,h):
 if isinstance(r,dict):r=[r['x'],r['y'],r.get('width',r.get('w')),r.get('height',r.get('h'))]
 x,y,rw,rh=r;x=max(0,x);y=max(0,y);rw=min(rw,w-x);rh=min(rh,h-y)
 if rw<=0 or rh<=0:return None
 return [round(x/w,6),round(y/h,6),round(rw/w,6),round(rh/h,6)]
def text_for(p,r):
 x,y,w,h=r
 matches=[]
 for l in ocr.get(p['key'],{}).get('lines',[]):
  lx,ly,lw,lh=[l[k]/ocr[p['key']][axis] for k,axis in [('x','width'),('y','height'),('w','width'),('h','height')]]
  overlap=max(0,min(x+w,lx+lw)-max(x,lx))*max(0,min(y+h,ly+lh)-max(y,ly))
  if overlap/max(1e-9,lw*lh)>.35:matches.append(l['t'])
 return ' '.join(dict.fromkeys(matches))[:250]
manual=json.loads((ROOT/'assets/review/image-switch-targets_v1.json').read_text())['pages']
by_no=collections.defaultdict(list);counts=collections.Counter()
for p in pages.values():
 w,h=p['width'],p['height'];ts=[]
 for color,rs in [('red',p.get('hide',[])),('green',p.get('greenHide',[]))]:
  for r in rs:
   box=rect(r,w,h)
   if box:ts.append({'color':color,'rect':box,'text':text_for(p,box),'source':'ocr'})
 for pair in p.get('numberPairs',[]):
  if pair.get('bodyPageKey',p['key'])!=p['key']:continue
  box=rect(pair['body'],w,h)
  if box:ts.append({'color':'orange','rect':box,'text':pair.get('answerText','')[:1000],'source':'answer','pairId':pair.get('id','')})
 ts.extend(manual.get(p['key'],[]))
 unique={json.dumps([t['color'],t['rect']],ensure_ascii=False):t for t in ts};ts=list(unique.values())
 for t in ts:counts[t['color']]+=1
 lines=[]
 op=ocr.get(p['key'])
 if op:
  for l in op.get('lines',[]):
   b=rect(l,op['width'],op['height'])
   if b:lines.append({'rect':b,'text':l['t'][:1000]})
 by_no[p['no']].append({'key':p['key'],'no':p['no'],'label':p['label'],'href':p['href'],'width':w,'height':h,'targets':ts,'lines':lines})
out=ROOT/'assets/review/targets';out.mkdir(exist_ok=True)
for no,rows in by_no.items():(out/f'No{no:03d}.json').write_text(json.dumps(rows,ensure_ascii=False,separators=(',',':')))
(ROOT/'assets/review/catalog_v1.json').write_text(json.dumps({k:{'no':p['no'],'label':p['label'],'href':p['href']} for k,p in pages.items()},ensure_ascii=False,separators=(',',':')))
print(json.dumps({'pages':len(pages),'files':len(by_no),'targets':dict(counts)},ensure_ascii=False))
