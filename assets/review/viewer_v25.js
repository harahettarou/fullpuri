import {initClassicEditor} from '../classic/editor_v25.js';
import {initSequence,startReview} from './sequence_v18.js';
import {fillAccount} from './account_controls_v12.js';
import * as R from './core_v12.js';
import * as N from './notes_core_v14.js';
import {openEditor} from './note_editor_v14.js';
const adapter=window.KopuriReviewAdapter,stage=document.getElementById('stage');
const colors={red:'赤',green:'緑',orange:'オレンジ',black:'黒'};
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n};
const safe=fn=>async()=>{try{await fn()}catch(e){message(e.message)}};
function button(text,fn){const b=el('button','',text);b.type='button';b.onclick=safe(fn);return b}
function message(s){notice.textContent=s;notice.classList.add('kr-error');if(!settings.open&&!menu.open)settings.showModal();else if(menu.open){let alert=menu.querySelector('[role=alert]');if(!alert){alert=el('p','kr-error');alert.setAttribute('role','alert');menu.append(alert)}alert.textContent=s}}
const launcher=button('復習チェック',()=>settings.showModal());launcher.className='kr-launch';document.body.append(launcher);
// Float above the actual bottom navigation, leaving the original zoom layout intact.
const bottomNav=document.querySelector('.nav');
function positionLauncher(){const rect=bottomNav?.getBoundingClientRect();const height=rect&&rect.height>0?Math.max(0,window.innerHeight-rect.top):0;launcher.style.setProperty('--kr-nav-clearance',height+'px')}
if(bottomNav){new ResizeObserver(positionLauncher).observe(bottomNav);window.addEventListener('resize',positionLauncher);window.visualViewport?.addEventListener('resize',positionLauncher);window.visualViewport?.addEventListener('scroll',positionLauncher);positionLauncher()}

const settings=el('dialog','kr-dialog kr-organized');settings.setAttribute('aria-label','復習チェックの設定');
const heading=el('div','kr-panel-heading');heading.append(el('h2','','復習・メモ'),button('閉じる',()=>settings.close()));settings.append(heading);
const noteLink=el('a','','メモ一覧');noteLink.href=new URL('pages/notes.html',R.rootURL);
let memoVisible=true;try{memoVisible=localStorage.getItem('kopuri-note-icons-v3')!=='hidden'}catch{}
const iconLabel=el('label'),iconCheck=el('input');iconCheck.type='checkbox';iconCheck.checked=memoVisible;iconCheck.onchange=()=>{memoVisible=iconCheck.checked;try{localStorage.setItem('kopuri-note-icons-v3',memoVisible?'show':'hidden')}catch{}render()};iconLabel.append(iconCheck,document.createTextNode(' メモの位置・アイコンを表示'));
const status=el('p','kr-status'),notice=el('p','kr-status'),coverage=el('p','kr-note');status.setAttribute('role','status');notice.setAttribute('role','alert');
const account=el('div','kr-row');settings.append(status,notice);
const options=el('div','kr-row'),select=el('select');select.setAttribute('aria-label','チェックボタンの表示方式');select.innerHTML='<option value="direct">直接表示</option><option value="tap">タップ表示</option><option value="hidden">チェックUI非表示</option>';
let display;try{display=localStorage.getItem('kopuri-review-display-v1')||'tap'}catch{display='tap'}select.value=display;
select.onchange=()=>{display=select.value;try{localStorage.setItem('kopuri-review-display-v1',display)}catch{};render()};
const displayLabel=el('label','','チェックの表示 ');displayLabel.append(select);options.append(displayLabel);
const actions=el('div','kr-action-groups');settings.append(actions);
const a=el('a','','復習管理');a.href=new URL('pages/review.html',R.rootURL);
const links=el('nav','kr-panel-links');links.setAttribute('aria-label','復習とメモの一覧');links.append(a,noteLink);settings.insertBefore(links,status);
const memoViewLabel=el('label','','メモの表示 '),memoView=el('select');memoView.setAttribute('aria-label','メモの表示範囲');memoView.innerHTML='<option value="shared">共通メモ</option><option value="private">個人メモ</option><option value="both">両方</option>';memoView.value=N.state().view;memoView.onchange=()=>N.setView(memoView.value);memoViewLabel.append(memoView);
const displayDetails=el('details','kr-panel-details');displayDetails.append(el('summary','','表示設定'),memoViewLabel,options,iconLabel,coverage,el('p','kr-note','色の表示と登録状態は独立しています。範囲選択中は囲み操作を優先します。'));settings.insertBefore(displayDetails,links);
const accountDetails=el('details','kr-panel-details');accountDetails.append(el('summary','','アカウント・同期'),account);settings.append(accountDetails);
function actionGroup(title,items){const section=el('section','kr-action-group');section.setAttribute('aria-label',title);const grid=el('div','kr-action-grid');grid.append(...items);section.append(el('h3','',title),grid);return section}

document.body.append(settings);
const menu=el('dialog','kr-dialog');menu.setAttribute('aria-label','復習対象の登録');document.body.append(menu);
let data=null,page=null,layer=null,selection=null,focusTarget=null,focusIsNote=false,noteLinkApplied=false,sequence=0;
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
 const e=entryFor(t),note=noteFor(t);if(note){focusTarget=note.target;focusIsNote=true;render()}t=e?.target||note?.target||t;menu.replaceChildren(button('閉じる',()=>menu.close()),el('h2','',e?.state==='todo'?'要復習':e?.state==='done'?'復習完了':'未登録'));
 menu.append(el('p','',t.text||`${colors[t.color]||''}文字（範囲を登録）`));
 if(source==='ocr')menu.append(el('p','kr-note','文字列は原文OCRの参考表示です。読み取りが崩れていても選択位置で保存します。'));
 if(!R.state().auth){const controls=el('div','kr-row');fillAccount(controls);menu.append(controls)}
 else if(e?.pending)menu.append(el('p','','この項目は保存待ちです。'));
 else if(e){
  menu.append(el('p','kr-meta',`復習 ${e.review_count}回 ／ 最終：${R.formatDate(e.last_reviewed_at)}`));
  menu.append(button(e.state==='todo'?'復習完了にする':'再び要復習にする',async()=>{await R.act(e.state==='todo'?'complete':'reopen',t);menu.close()}));
 }else menu.append(button('要復習に登録',async()=>{await R.act('register',t);menu.close()}));
 if(R.state().auth){
  const notes=N.state().notes.filter(n=>live(n)&&n.id===note?.id);
  for(const n of notes){menu.append(el('p','kr-meta',n.scope==='shared'?'共通メモ':'個人メモ'),el('p','kn-body',n.body),button((n.scope==='shared'?'共通':'個人')+'メモを見る・編集',async()=>{menu.close();await openEditor(n.target,n.scope)}));}
  if(!notes.some(n=>n.scope===N.creationScope()))menu.append(button('メモを書く',async()=>{menu.close();await openEditor(t)}));
 }
 if(e&&!e.pending)menu.append(button('この項目から続けて復習',()=>startReview(e.id)));
 menu.showModal();
}
function allTargets(){
 const suppressed=window.KopuriClassicSuppressed?.[page?.key]||[];const sourceTargets=(data?.targets||[]).filter(t=>!suppressed.some(n=>n.color===t.color&&n.rect.every((v,i)=>Math.abs(v-t.rect[i])<.00001)));
 const ts=[...sourceTargets,...(window.KopuriClassicTargets?.[page?.key]||[])].map(t=>{const target={...t,kind:'word',no:page.no,page:page.key},entry=entryFor(target)||noteFor(target);return entry?{...target,...entry.target,saved:true}:target});
 for(const e of [...R.state().entries,...N.state().notes].filter(e=>live(e)&&e.target.page===page?.key&&['word','range'].includes(e.target.kind))){
  if(!ts.some(t=>t.color===e.target.color&&t.kind===e.target.kind&&(t.color!=='black'||t.text===e.target.text)&&t.rect.every((v,i)=>Math.abs(v-e.target.rect[i])<.000002)))ts.push({...e.target,saved:true});
 }
 return ts;
}
function render(){
 const s=R.state(),ns=N.state();memoView.value=ns.view;const reviewStatus=s.status.replace(/^復習[：:]?\s*/,''),memoStatus=ns.status.replace(/^メモ[：:]?\s*/,'');status.textContent=reviewStatus===memoStatus?'復習・メモ：'+reviewStatus:'復習：'+reviewStatus+' ／ メモ：'+memoStatus;const suffix=s.conflict?'・競合あり':/失敗|期限/.test(s.status)?'・同期エラー':/保存中|同期中/.test(s.status)?'・保存中':s.queue.length?'・保存待ち':'';const currentMemoCount=page?ns.notes.filter(n=>live(n)&&n.target.no===page.no).length:0;launcher.textContent=`復習 ${s.entries.filter(e=>live(e)&&e.state==='todo').length}件${currentMemoCount?'・メモ '+currentMemoCount+'件':''}${suffix}${ns.conflict?'・メモ競合':/失敗/.test(ns.status)?'・メモ保存失敗':ns.queue.length?'・メモ保存待ち':''}`;launcher.title=s.status;launcher.setAttribute('aria-label',launcher.textContent+' '+s.status);
 fillAccount(account,async()=>{await R.flush();await R.refresh();await N.sync()});
 if(focusIsNote&&focusTarget&&!noteFor(focusTarget)){focusTarget=null;focusIsNote=false}
 if(!stage||!page)return;
 actions.replaceChildren(
  actionGroup('復習',[
   button('要復習を続けて見る',()=>startReview()),
   button('No.全体を登録・確認',()=>openTarget(baseTarget('print'))),
   button('このページを登録・確認',()=>openTarget(baseTarget('page'))),
   button('範囲を囲んで登録',()=>startSelection('range')),
   button('黒文字を選んで登録',()=>startSelection('black')),
   button('このページの語句一覧',openTargetList)
  ]),
  actionGroup('メモ',[
   button('No.全体にメモ',()=>{settings.close();return openEditor(baseTarget('print'))}),
   button('このページにメモ',()=>{settings.close();return openEditor(baseTarget('page'))}),
   button('範囲を囲んでメモ',()=>startSelection('note-range')),
   button('黒文字を選んでメモ',()=>startSelection('note-black')),
   button('このページのメモ（'+pageNotes().length+'件）',openPageNotes)
  ])
 );
 layer?.remove();layer=el('div','kr-layer');stage.append(layer);
 // Draw from the saved note anchor, independently of OCR/button placement.
 // A transparent, non-interactive outline preserves text, scroll and pinch gestures.
 if(memoVisible&&display!=='hidden')for(const note of pageNotes()){
  const mark=el('div','kn-note-outline');mark.dataset.kind=note.target.kind;mark.dataset.noteId=note.id;mark.dataset.scope=note.scope;
  mark.setAttribute('aria-hidden','true');rectStyle(mark,note.target.rect);layer.append(mark);
 }
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
   const b=button(note&&memoVisible?'✎':e?.state==='done'?'✓':e?.state==='todo'?'!':'+',()=>openTarget(t,t.source));b.className='kr-mark';b.dataset.state=e?.state||'none';b.dataset.color=t.color;if(note&&memoVisible){b.dataset.note='true';b.title='青枠のメモを見る・編集'}
   b.setAttribute('aria-label',`${colors[t.color]||'範囲'}：${t.text||'語句'}・${e?.state==='todo'?'要復習':e?.state==='done'?'復習完了':'未登録'}${note?'・メモあり':''}`);
   b.style.left=pos[0]+'px';b.style.top=pos[1]+'px';b.addEventListener('pointerdown',ev=>ev.stopPropagation());layer.append(b);
  }
  coverage.textContent=display==='direct'?`直接表示 ${shown}/${targets.length}件。余白がない箇所は文字をタップするか、語句一覧から登録できます。`:'対象の文字またはメモアイコンをタップすると操作が表示されます。メモの箇所は青枠で表示します。アイコンの余白がない場合は「このページのメモ」から開けます。';
 }else coverage.textContent=display==='hidden'?'画像上のチェックUIを非表示にしています。':'対象の文字をタップすると操作が表示されます。';
 if(focusTarget&&(focusTarget.kind==='print'?focusTarget.no===page.no:focusTarget.page===page.key)&&(!focusIsNote||memoVisible&&display!=='hidden')){const mark=el('div',focusIsNote?'kr-focus kn-note-focus':'kr-focus');rectStyle(mark,focusTarget.rect);layer.append(mark);}
}
function openTargetList(){settings.close();menu.replaceChildren(button('閉じる',()=>menu.close()),el('h2','','このページの語句・範囲'));for(const t of allTargets()){const row=el('div','kr-row');row.append(button(`${colors[t.color]||'範囲'}：${t.text||'文字範囲'}`,()=>{menu.close();return openTarget(t,t.source)}));menu.append(row)}menu.showModal()}
async function changedPage(){
 if(!adapter)return;const p=adapter.page();if(!p)return;
 if(page?.key===p.key)return;const tick=++sequence;page=p;data=null;cancelSelection();focusTarget=null;focusIsNote=false;render();
 try{const response=await fetch(new URL(`assets/review/targets/No${String(p.no).padStart(3,'0')}.json`,R.rootURL));if(!response.ok)throw Error('チェック座標を取得できません');const rows=await response.json();if(tick!==sequence)return;data=rows.find(x=>x.key===p.key);render();await highlightFromURL()}
 catch(e){message(e.message)}
}
async function highlightFromURL(){
 if(!page)return;
 const params=new URLSearchParams(location.search),noteId=params.get('note'),id=noteId||params.get('review');if(!id)return;
 const scope=params.get('noteScope')||'private';const entry=(noteId?N.state().allNotes:R.state().entries).find(e=>e.id===id&&live(e)&&(!noteId||e.scope===scope));if(!entry||entry.target.kind==='print'&&entry.target.no!==page.no||entry.target.kind!=='print'&&entry.target.page!==page.key)return;
 if(noteId&&!noteLinkApplied){noteLinkApplied=true;if(N.state().view!=='both'&&N.state().view!==scope)N.setView(scope,false)}
 focusOn(entry.target,!!noteId);
}
function pageNotes(){return N.state().notes.filter(n=>live(n)&&(n.target.kind==='print'?n.target.no===page?.no:n.target.page===page?.key))}
function focusOn(target,isNote=true){
 focusTarget=target;focusIsNote=isNote;render();requestAnimationFrame(()=>{
  const r=stage.getBoundingClientRect(),q=target.rect,scroller=document.getElementById('scroller');if(!scroller)return;const b=scroller.getBoundingClientRect();
  scroller.scrollBy({left:r.left+(q[0]+q[2]/2)*r.width-(b.left+b.width/2),top:r.top+q[1]*r.height-(b.top+b.height/3),behavior:'smooth'});
 });
}
function openPageNotes(){
 settings.close();menu.replaceChildren(button('閉じる',()=>menu.close()),el('h2','','このページのメモ'));
 const notes=pageNotes();if(!notes.length)menu.append(el('p','','このページにメモはありません。'));
 notes.forEach((note,i)=>{
  const kind={print:'No.全体',page:'ページ全体',word:'語句',range:'指定範囲'}[note.target.kind];
  const row=el('div','kr-row');row.append(el('span','',`メモ${i+1}・${note.scope==='shared'?'共通':'個人'}・${kind}`),button('位置を表示',()=>{menu.close();focusOn(note.target)}),button('メモを見る・編集',async()=>{menu.close();focusOn(note.target);await openEditor(note.target,note.scope)}));menu.append(row);
 });menu.showModal();
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
 stage.addEventListener('pointerdown',e=>{if(stage.classList.contains('kc-editing')||e.target.closest('.kr-mark,.kr-selection,.kc-capture')||stage.classList.contains('drawing')||selection||display==='hidden')return;down={id:e.pointerId,x:e.clientX,y:e.clientY,at:Date.now(),pt:point(e)}},{capture:true,passive:true});
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

document.addEventListener('kopuri:classic-edits',render);
await initClassicEditor();
await initSequence();
