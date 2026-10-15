"""v3パックのHTML変更は、v2に対する読込参照更新だけであることを検証。"""
from pathlib import Path
import subprocess
BASE='2418d0f5fd7627c556105d5be7617f57d9c6355a'
ROOT=Path(__file__).resolve().parents[3]
count=0
for p in [ROOT/'index.html',*(ROOT/'pages').rglob('*.html')]:
 rel=str(p.relative_to(ROOT))
 if rel in ('pages/review.html','pages/notes.html'):continue
 old=subprocess.check_output(['git','show',BASE+':'+rel],cwd=ROOT).decode()
 s=p.read_text()
 for name in ['review','viewer','navigation']:s=s.replace(name+'_v3.',name+'_v1.')
 assert s==old,rel
 count+=1
print('既存HTML・閲覧処理保持:',count,'ファイル')
