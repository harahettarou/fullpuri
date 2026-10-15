import * as R from './core_v3.js';
import * as N from './notes_core_v3.js';
import {openEditor} from './note_editor_v3.js';
const adapter=window.KopuriReviewAdapter,stage=document.getElementById('stage');
const colors={red:'赤',green:'緑',orange:'オレンジ',black:'黒'};
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n};
const safe=fn=>async()=>{try{await fn()}catch(e){message(e.message)}};
function button(text,fn){const b=el('button','',text);b.type='button';b.onclick=safe(fn);return b}
function message(s){notice.textContent=s;notice.classList.add('kr-error');if(!settings.open&&!menu.open)settings.showModal();else if(menu.open){let alert=menu.querySelector('[role=alert]');if(!alert){alert=el('p','kr-error');alert.setAttribute('role','alert');menu.append(alert)}alert.textContent=s}}
const launcher=button('復習チェック',()=>settings.showModal());launcher.className='kr-launch';document.body.append(launcher);
const settings=el('dialog','kr-dialog');settings.setAttribute('aria-label','復習チェックの設定');
settings.append(button('閉じる',()=>settings.close()),el('h2','','復習・メモ'));
const noteStatus=el('p','kr-status');noteStatus.setAttribute('role','status');settings.append(noteStatus);
const noteLink=el('a','','メモ一覧を開く');noteLink.href=new URL('pages/notes.html',R.rootURL);settings.append(noteLink);
let memoVisible=true;try{memoVisible=localStorage.getItem('kopuri-note-icons-v3')!=='hidden'}catch{}
const iconLabel=el('label'),iconCheck=el('input');iconCheck.type='checkbox';iconCheck.checked=memoVisible;iconCheck.onchange=()=>{memoVisible=iconCheck.checked;try{localStorage.setItem('kopuri-note-icons-v3',memoVisible?'show':'hidden')}catch{}render()};iconLabel.append(iconCheck,document.createTextNode(' メモのアイコンを表示'));settings.append(iconLabel);
const status=el('p','kr-status'),notice=el('p','kr-status'),coverage=el('p','kr-note');status.setAttribute('role','status');notice.setAttribute('role','alert');
const account=el('div','kr-row');settings.append(status,notice,account);
const options=el('div','kr-row'),select=el('select');select.setAttribute('aria-label','チェックボタンの表示方式');select.innerHTML='<option value="direct">直接表示</option><option value="tap">タップ表示</option><option value="hidden">チェックUI非表示</option>';
let display;try{display=localStorage.getItem('kopuri-review-display-v1')||'tap'}catch{display='tap'}select.value=display;
select.onchange=()=>{display=select.value;try{localStorage.setItem('kopuri-review-display-v1',display)}catch{};render()};
options.append(select);settings.append(options,coverage);
const actions=el('div','kr-row');settings.append(actions);
const a=el('a','','復習管理を開く');a.href=new URL('pages/review.html',R.rootURL);settings.append(a,el('p','kr-note','色の表示ON/OFFとは独立して登録します。範囲選択中は囲み操作を優先します。'));
document.body.append(settings);
const menu=el('dialog','kr-dialog');menu.setAttribute('aria-label','復習対象の登録');document.body.append(menu);
let data=null,page=null,layer=null,selection=null,focusTarget=null,sequence=0;
function rectStyle(n,r){Object.assign(n.style,{left:r[0]*100+'%',top:r[1]*100+'%',width:r[2]*100+'%',height:r[3]*100+'%'});}
function baseTarget(kind){return {kind,no:page.no,page:page.key,color:'',text:kind==='print'?`No.${page.no} 全体`:page.label,rect:[0,0,1,1]}}
const live=e=>e&&!e.deleted;
function anchorMatch(t,s){if(s.kind!==t.kind||s.page!==t.page||s.color!==t.color||t.color==='black'&&s.text!==t.text)return false;if(s.rect.every((v,i)=>Math.abs(v-t.rect[i])<.000002))return true;if(!t.text||t.text!==s.text)return false;const a=t.rect,b=s.rect,intersection=Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1]));return intersection/(a[2]*a[3]+b[2]*b[3]-intersection)>.8}
function entryFor(t){
 const entries=R.state().entries.filter(live);
 if(t.kind==='print')return entries.find(e=>e.target.kind==='print'&&e.target.no===t.no);
 if(t.kind==='page')return entries.find(e=>e.target.kind==='page'&&e.target.page===t.page);
 // Retain original saved boxes. Nearby OCR changes never rewrite or move them.
 const exact=entries.find(e=>e.target.kind===t.kind&&e.target.page===t.page&&e.target.color===t.color&&(t.color!=='black'||e.target.text===t.text)&&e.target.rect.every((v,i)=>Math.abs(v-t.rect[i])<.000002));if(exact)return exact;const candidates=entries.filter(e=>anchorMatch(t,e.target));return candidates.length===1?candidates[0]:undefined;
}
function noteFor(t){const ns=N.state().notes.filter(live);if(t.kind==='print')return ns.find(n=>n.target.kind==='print'&&n.target.no===t.no);if(t.kind==='page')return ns.find(n=>n.target.kind==='page'&&n.target.page===t.page);const exact=ns.find(n=>n.target.kind===t.kind&&n.target.page===t.page&&n.target.color===t.color&&(t.color!=='black'||n.target.text===t.text)&&n.target.rect.every((v,i)=>Math.abs(v-t.rect[i])<.000002));if(exact)return exact;const candidates=ns.filter(n=>anchorMatch(t,n.target));return candidates.length===1?candidates[0]:undefined}
async function openTarget(t,source=''){
 const e=entryFor(t),note=noteFor(t);t=e?.target||note?.target||t;menu.replaceChildren(button('閉じる',()=>menu.close()),el('h2','',e?.state==='todo'?'要復習':e?.state==='done'?'復習完了':'未登録'));
 menu.append(el('p','',t.text||`${colors[t.color]||''}文字（範囲を登録）`));
 if(source==='ocr')menu.append(el('p','kr-note','文字列は原文OCRの参考表示です。読み取りが崩れていても選択位置で保存します。'));
 if(!R.state().auth)menu.append(button('GitHubでログイン',R.login));
 else if(e?.pending)menu.append(el('p','','この項目は保存待ちです。'));
 else if(e){
  menu.append(el('p','kr-meta',`復習 ${e.review_count}回 ／ 最終：${R.formatDate(e.last_reviewed_at)}`));
  menu.append(button(e.state==='todo'?'復習完了にする':'再び要復習にする',async()=>{await R.act(e.state==='todo'?'complete':'reopen',t);menu.close()}));
 }else menu.append(button('要復習に登録',async()=>{await R.act('register',t);menu.close()}));
 if(R.state().auth){if(note){const preview=el('p','kn-body',note.body);menu.append(preview)}menu.append(button(note?'メモを見る・編集':'メモを書く',async()=>{menu.close();await openEditor(t)}));}
 menu.showModal();
}
function allTargets(){
 const ts=(data?.targets||[]).map(t=>{const target={...t,kind:'word',no:page.no,page:page.key},entry=entryFor(target)||noteFor(target);return entry?{...target,...entry.target,saved:true}:target});
 for(const e of [...R.state().entries,...N.state().notes].filter(e=>live(e)&&e.target.page===page?.key&&['word','range'].includes(e.target.kind))){
  if(!ts.some(t=>t.color===e.target.color&&t.kind===e.target.kind&&(t.color!=='black'||t.text===e.target.text)&&t.rect.every((v,i)=>Math.abs(v-e.target.rect[i])<.000002)))ts.push({...e.target,saved:true});
 }
 return ts;
}
function render(){
 const s=R.state(),ns=N.state();noteStatus.textContent=ns.status;status.textContent=s.status;const suffix=s.conflict?'・競合あり':/失敗|期限/.test(s.status)?'・同期エラー':/保存中|同期中/.test(s.status)?'・保存中':s.queue.length?'・保存待ち':'';launcher.textContent=`復習 ${s.entries.filter(e=>live(e)&&e.state==='todo').length}件・メモ ${ns.notes.filter(live).length}件${suffix}${ns.conflict?'・メモ競合':/失敗/.test(ns.status)?'・メモ保存失敗':ns.queue.length?'・メモ保存待ち':''}`;launcher.title=s.status;launcher.setAttribute('aria-label',launcher.textContent+' '+s.status);
 account.replaceChildren(el('span','',s.auth?s.auth.login:'未ログイン'),button(s.auth?'ログアウト':'GitHubでログイン',s.auth?R.logout:R.login),button('再同期',async()=>{await R.flush();await R.refresh();await N.sync()}));
 if(s.auth)account.append(button('ログインし直す',R.login));
 if(!stage||!page)return;
 actions.replaceChildren(button('No.全体を登録・確認',()=>openTarget(baseTarget('print'))),button('このページを登録・確認',()=>openTarget(baseTarget('page'))),button('範囲を囲んで登録',()=>startSelection('range')),button('黒文字を選んで登録',()=>startSelection('black')),button('このページの語句一覧',openTargetList),button('No.全体にメモ',()=>{settings.close();return openEditor(baseTarget('print'))}),button('このページにメモ',()=>{settings.close();return openEditor(baseTarget('page'))}),button('範囲を囲んでメモ',()=>startSelection('note-range')),button('黒文字を選んでメモ',()=>startSelection('note-black')));
 layer?.remove();layer=el('div','kr-layer');stage.append(layer);
 if(display==='direct'||memoVisible&&display!=='hidden'){
  const boxes=[],bsize=matchMedia('(pointer:coarse)').matches?24:19,rect=stage.getBoundingClientRect();
  const targets=allTargets(),visibleTargets=display==='direct'?targets:targets.filter(t=>noteFor(t));let shown=0;
  for(const t of visibleTargets){
   const e=entryFor(t),note=noteFor(t),r=t.rect;
   // Prefer a blank margin. Skip dense locations; tapping always remains available.
   const candidates=[[r[0]*rect.width-bsize-3,r[1]*rect.height],[ (r[0]+r[2])*rect.width+3,r[1]*rect.height],[r[0]*rect.width,r[1]*rect.height-bsize-3]];
   for(const dy of [-1,1,-2,2,-3,3])for(const x of [r[0]*rect.width-bsize-3,(r[0]+r[2])*rect.width+3])candidates.push([x,r[1]*rect.height+dy*(bsize+3)]);
   const pos=candidates.find(([x,y])=>x>=0&&y>=0&&x+bsize<=rect.width&&y+bsize<=rect.height&&!boxes.some(b=>x<b[0]+bsize&&x+bsize>b[0]&&y<b[1]+bsize&&y+bsize>b[1])&&!targets.some(o=>{const q=o.rect;return x<(q[0]+q[2])*rect.width&&x+bsize>q[0]*rect.width&&y<(q[1]+q[3])*rect.height&&y+bsize>q[1]*rect.height})&&!(data?.lines||[]).some(o=>{const q=o.rect;return x<(q[0]+q[2])*rect.width&&x+bsize>q[0]*rect.width&&y<(q[1]+q[3])*rect.height&&y+bsize>q[1]*rect.height}));
   if(!pos)continue;boxes.push(pos);shown++;
   const b=button(note&&memoVisible?'✎':e?.state==='done'?'✓':e?.state==='todo'?'!':'+',()=>openTarget(t,t.source));b.className='kr-mark';b.dataset.state=e?.state||'none';b.dataset.color=t.color;
   b.setAttribute('aria-label',`${colors[t.color]||'範囲'}：${t.text||'語句'}・${e?.state==='todo'?'要復習':e?.state==='done'?'復習完了':'未登録'}${note?'・メモあり':''}`);
   b.style.left=pos[0]+'px';b.style.top=pos[1]+'px';b.addEventListener('pointerdown',ev=>ev.stopPropagation());layer.append(b);
  }
  coverage.textContent=display==='direct'?`直接表示 ${shown}/${targets.length}件。余白がない箇所は文字をタップするか、語句一覧から登録できます。`:'対象の文字またはメモアイコンをタップすると操作が表示されます。余白がないメモは語句一覧から開けます。';
 }else coverage.textContent=display==='hidden'?'画像上のチェックUIを非表示にしています。':'対象の文字をタップすると操作が表示されます。';
 if(focusTarget&&focusTarget.page===page.key){const mark=el('div','kr-focus');rectStyle(mark,focusTarget.rect);layer.append(mark);}
}
function openTargetList(){settings.close();menu.replaceChildren(button('閉じる',()=>menu.close()),el('h2','','このページの語句・範囲'));for(const t of allTargets()){const row=el('div','kr-row');row.append(button(`${colors[t.color]||'範囲'}：${t.text||'文字範囲'}`,()=>{menu.close();return openTarget(t,t.source)}));menu.append(row)}menu.showModal()}
async function changedPage(){
 if(!adapter)return;const p=adapter.page();if(!p)return;
 if(page?.key===p.key)return;const tick=++sequence;page=p;data=null;cancelSelection();focusTarget=null;render();
 try{const response=await fetch(new URL(`assets/review/targets/No${String(p.no).padStart(3,'0')}.json`,R.rootURL));if(!response.ok)throw Error('チェック座標を取得できません');const rows=await response.json();if(tick!==sequence)return;data=rows.find(x=>x.key===p.key);render();await highlightFromURL()}
 catch(e){message(e.message)}
}
async function highlightFromURL(){
 if(!page)return;
 const params=new URLSearchParams(location.search),noteId=params.get('note'),id=noteId||params.get('review');if(!id)return;
 const entry=(noteId?N.state().notes:R.state().entries).find(e=>e.id===id&&live(e));if(!entry||entry.target.kind==='print'&&entry.target.no!==page.no||entry.target.kind!=='print'&&entry.target.page!==page.key)return;
 focusTarget=entry.target;render();requestAnimationFrame(()=>{
  const r=stage.getBoundingClientRect(),q=focusTarget.rect,scroller=document.getElementById('scroller'),b=scroller.getBoundingClientRect();
  scroller.scrollBy({left:r.left+(q[0]+q[2]/2)*r.width-(b.left+b.width/2),top:r.top+q[1]*r.height-(b.top+b.height/3),behavior:'smooth'});
 });
}
function point(e){const r=stage.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))]}
function within(pt,r){return pt[0]>=r[0]&&pt[0]<=r[0]+r[2]&&pt[1]>=r[1]&&pt[1]<=r[1]+r[3]}
async function blackAt(pt,forNote=false){
 const hits=(data?.lines||[]).filter(l=>within(pt,l.rect)).sort((a,b)=>a.rect[2]*a.rect[3]-b.rect[2]*b.rect[3]);
 if(!hits.length){message('OCR文字が見つかりません。「範囲を囲んで登録」を使ってください');if(!settings.open)settings.showModal();return}
 const line=hits[0];menu.replaceChildren(button('閉じる',()=>menu.close()),el('h2','','黒文字を選択'));
 const text=el('textarea');text.value=line.text;text.setAttribute('aria-label','選択したOCR文字');
 menu.append(el('p','kr-note','必要な文字を選択して登録してください。選択しない場合は全文を登録します。位置はこのOCR行の範囲で保存します。'),text,button(forNote?'選択した文字にメモ':'選択した文字を要復習に登録',async()=>{
  const value=text.selectionEnd>text.selectionStart?text.value.slice(text.selectionStart,text.selectionEnd):text.value;
  if(!value.trim())throw Error('文字を選択してください');const t={...baseTarget('word'),color:'black',rect:line.rect,text:value.trim().slice(0,1000)};menu.close();if(forNote)await openEditor(t);else await R.act('register',t);
 }));menu.showModal();text.focus();text.select();
}
let down=null;
if(stage){
 stage.addEventListener('pointerdown',e=>{if(e.target.closest('.kr-mark,.kr-selection')||stage.classList.contains('drawing')||selection||display==='hidden')return;down={id:e.pointerId,x:e.clientX,y:e.clientY,at:Date.now(),pt:point(e)}},{capture:true,passive:true});
 stage.addEventListener('pointermove',e=>{if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>7)down=null},{capture:true,passive:true});
 stage.addEventListener('pointercancel',()=>down=null,{passive:true});
 stage.addEventListener('touchstart',e=>{if(e.touches.length>1)down=null},{passive:true});
 document.addEventListener('pointerup',e=>{
  const d=down;down=null;if(!d||d.id!==e.pointerId||Math.hypot(e.clientX-d.x,e.clientY-d.y)>7||stage.classList.contains('drawing'))return;
  const hit=allTargets().filter(t=>within(d.pt,t.rect)).sort((a,b)=>a.rect[2]*a.rect[3]-b.rect[2]*b.rect[3])[0];
  if(hit)setTimeout(()=>openTarget(hit,hit.source),0);else if(Date.now()-d.at>550)setTimeout(()=>blackAt(d.pt),0);
 },{capture:true,passive:true});
 new ResizeObserver(()=>render()).observe(stage);
 document.addEventListener('kopuri:page',changedPage);
}
function cancelSelection(){selection?.remove();selection=null;}
function startSelection(kind){
 if(!R.state().auth)throw Error('先にログインしてください');
 if(stage.classList.contains('drawing'))throw Error('既存の範囲追加操作を終えてください');
 settings.close();cancelSelection();selection=el('div','kr-selection');stage.append(selection);
 const cancel=button('選択を中止',cancelSelection);Object.assign(cancel.style,{position:'sticky',top:'8px',left:'8px',zIndex:2});cancel.addEventListener('pointerdown',e=>e.stopPropagation());selection.append(cancel);
 let start=null,rect=null,pointer=null;
 selection.addEventListener('pointerdown',e=>{
  if(e.target===cancel)return;if(pointer!==null){cancelSelection();return}e.stopPropagation();e.preventDefault();pointer=e.pointerId;start=point(e);selection.setPointerCapture(e.pointerId);rect=el('div','kr-drag');selection.append(rect);
 });
 selection.addEventListener('pointermove',e=>{if(!start||pointer!==e.pointerId)return;e.stopPropagation();e.preventDefault();const p=point(e);rectStyle(rect,[Math.min(p[0],start[0]),Math.min(p[1],start[1]),Math.abs(p[0]-start[0]),Math.abs(p[1]-start[1])])});
 selection.addEventListener('pointercancel',cancelSelection);
 selection.addEventListener('pointerup',e=>{
  if(!start||pointer!==e.pointerId)return;e.stopPropagation();const end=point(e),r=[Math.min(end[0],start[0]),Math.min(end[1],start[1]),Math.abs(end[0]-start[0]),Math.abs(end[1]-start[1])];cancelSelection();
  if(kind==='black'||kind==='note-black'){blackAt(end,kind==='note-black');return}if(r[2]<.005||r[3]<.005)return;
  const t={...baseTarget('range'),rect:r,text:'指定範囲'};if(kind==='note-range'){openEditor(t).catch(e=>message(e.message));return}menu.replaceChildren(button('閉じる',()=>menu.close()),el('h2','','範囲を要復習に登録'));
  const name=el('textarea');name.setAttribute('aria-label','範囲の名前');name.value='指定範囲';menu.append(name,button('登録',async()=>{t.text=name.value.trim().slice(0,1000)||'指定範囲';await R.act('register',t);menu.close()}));menu.showModal();
 });
}
R.subscribe(()=>{render();if(!focusTarget)highlightFromURL()});
N.subscribe(()=>{render();if(!focusTarget)highlightFromURL()});
await R.init();await N.init();await changedPage();render();
