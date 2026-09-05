"""Build ONLY explicitly reviewed raster replacements from a repair-mode ZIP.

Usage: python repair_base_from_zip.py --zip REPAIR.zip --site SITE --plan PLAN.json --out NEW_PACK
Requires Pillow and pypdf. This tool never reads existing assets as source pixels.
It does not render hide, greenHide, numberPairs, or canvas layers into raster files.
"""
import argparse,hashlib,io,json,re,zipfile
from pathlib import Path,PurePosixPath
from PIL import Image
from pypdf import PdfReader
from pypdf.generic import ContentStream

def sha(data): return hashlib.sha256(data).hexdigest()
def pixels(data):
    im=Image.open(io.BytesIO(data)).convert('RGB')
    return sha(str(im.size).encode()+im.tobytes())
def safe_path(root,relative):
    p=PurePosixPath(relative)
    if p.is_absolute() or '..' in p.parts or '\\' in relative or ':' in relative:
        raise ValueError('Unsafe relative path: '+relative)
    out=(root/relative).resolve()
    if not out.is_relative_to(root.resolve()):raise ValueError('Path escapes root')
    return out
def pdf_image(pdf_data,index):
    reader=PdfReader(io.BytesIO(pdf_data));pg=reader.pages[index-1]
    if pg.rotation or len(pg.images)!=1 or pg.get('/Annots') or list(pg.cropbox)!=list(pg.mediabox):
        raise ValueError('PDF needs an explicit full-page rendering review; direct extraction refused')
    # Accept a single full-page raster, optionally followed by invisible OCR text.
    stack=[];mode=0;matrix=[1,0,0,1,0,0];draws=0
    state_ops={b'BT',b'ET',b'Tf',b'Tc',b'Tw',b'Tz',b'TL',b'Ts',b'Td',b'TD',b'Tm',b'T*',b'rg',b'RG',b'g',b'G',b'k',b'K'}
    for args,op in ContentStream(pg.get_contents(),reader).operations:
        if op==b'q':stack.append((mode,matrix.copy()))
        elif op==b'Q':mode,matrix=stack.pop()
        elif op==b'cm':
            a,b,c,d,e,f=map(float,args);A,B,C,D,E,F=matrix
            matrix=[A*a+C*b,B*a+D*b,A*c+C*d,B*c+D*d,A*e+C*f+E,B*e+D*f+F]
        elif op==b'Tr':mode=int(args[0])
        elif op in (b'Tj',b'TJ',b"'",b'"'):
            if mode!=3:raise ValueError('Visible PDF text cannot be omitted')
        elif op==b'Do':
            obj=pg['/Resources']['/XObject'][args[0]]
            if obj.get('/Subtype')!='/Image' or obj.get('/SMask') or obj.get('/Mask') or obj.get('/Decode'):
                raise ValueError('Nontrivial PDF image effects')
            expected=[float(pg.mediabox.width),0,0,float(pg.mediabox.height),float(pg.mediabox.left),float(pg.mediabox.bottom)]
            if any(abs(a-b)>.1 for a,b in zip(matrix,expected)):raise ValueError('Raster is not an unrotated full page')
            draws+=1
        elif op not in state_ops:raise ValueError('Unsupported PDF drawing operator '+str(op))
    if draws!=1:raise ValueError('Expected one full-page image draw')
    return pg.images[0].data

def build(zip_path,site,plan,out):
    if out.exists():raise ValueError('Output must be a new directory; no existing pack may be reused')
    zip_data=zip_path.read_bytes();zip_hash=sha(zip_data);z=zipfile.ZipFile(io.BytesIO(zip_data))
    names=z.namelist();prepared=[]
    for row in plan['replacements']:
        dest=row['asset'];old=safe_path(site,dest).read_bytes()
        if sha(old)!=row['expected_current_sha256']:raise ValueError('Site changed since audit: '+dest)
        if not dest.startswith('assets/') or not re.search(r'_(base|tray)',dest):raise ValueError('Not a reviewed base image')
        member=row['source_member'];original=z.read(member)
        if row['source_kind']=='zip_pdf':
            if not original.startswith(b'%PDF'):raise ValueError('PDF signature missing')
            data=pdf_image(original,row['source_page'])
        elif row['source_kind']=='zip_jpeg':
            if not plan.get('jpeg_exception_authorized'):raise ValueError('ZIP JPEG exception requires user authorization')
            if '/pages/' not in member or not member.lower().endswith(('.jpg','.jpeg')):raise ValueError('Only authorized repair pages JPEGs allowed')
            if row.get('no') and any(n.endswith(f'/No{row["no"]}.pdf') for n in names):raise ValueError('PDF original exists; JPEG fallback forbidden')
            data=original
        else:raise ValueError('Existing base/baseOff/HTML/canvas cannot be a source')
        if sha(data)!=row['expected_source_sha256']:raise ValueError('Original changed since review: '+dest)
        source_pixels=pixels(data);im=Image.open(io.BytesIO(data));method='unchanged-original-bytes'
        if Path(dest).suffix.lower()=='.png' and im.format!='PNG':
            buf=io.BytesIO();im.save(buf,format='PNG');data=buf.getvalue();method='lossless-PNG-native-pixels'
        elif Path(dest).suffix.lower() in ('.jpg','.jpeg') and im.format!='JPEG':raise ValueError('Would require lossy JPEG encoding')
        if pixels(data)!=source_pixels:raise ValueError('Native pixels altered')
        prepared.append((dest,data,dict(asset=dest,key=row['key'],sha256=sha(data),source_kind=row['source_kind'],source_member=member,source_page=row.get('source_page'),source_archive=zip_path.name,source_archive_sha256=zip_hash,source_sha256=row['expected_source_sha256'],source_pixel_sha256=source_pixels,output_pixel_sha256=source_pixels,size=list(im.size),generation_method=method,review_reason=row['reason'])))
        if len(prepared)%50==0:print('Verified originals:',len(prepared),flush=True)
    out.mkdir(parents=True)
    for dest,data,record in prepared:
        target=safe_path(out,dest);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    meta={'version':1,'base_commit':plan['base_commit'],'jpeg_exception_authorized':plan.get('jpeg_exception_authorized',False),'images':[r for _,_,r in prepared]}
    path=out/'assets/original-image-provenance.json';path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf8')
    return meta
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--zip',type=Path,required=True);p.add_argument('--site',type=Path,required=True);p.add_argument('--plan',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    report=build(a.zip,a.site,json.loads(a.plan.read_text(encoding='utf8')),a.out)
    print('Original-only replacements:',len(report['images']))
