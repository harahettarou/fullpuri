import {fillAccount} from './account_controls_v12.js';
import * as R from './core_v12.js';
import * as N from './notes_core_v12.js';
import {openEditor} from './note_editor_v12.js';
const $=s=>document.getElementById(s),kinds={print:'No.全体',page:'ページ',word:'語句',range:'指定範囲'},colors={red:'赤',green:'緑',orange:'オレンジ',black:'黒'};
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n};
const safe=fn=>async()=>{try{$('notice').textContent='';await fn()}catch(e){$('notice').textContent=e.message}};
function button(label,fn){const b=el('button','',label);b.type='button';b.onclick=safe(fn);return b}
const date=s=>s?R.formatDate(s):'サーバー保存待ち';let catalog={},limit=60,conflictId=null;
const scopeName=s=>s==='shared'?'共通':'個人';
const view=el('select');view.setAttribute('aria-label','メモの表示範囲');view.innerHTML='<option value="shared">共通メモ</option><option value="private">個人メモ</option><option value="both">両方</option>';view.value=N.state().view;view.onchange=()=>{limit=60;N.setView(view.value)};
const viewLabel=el('label','','表示 ');viewLabel.append(view);$('filters').prepend(viewLabel);
const deletedLabel=el('label'),deletedCheck=el('input');deletedCheck.type='checkbox';deletedCheck.onchange=()=>{limit=60;render()};deletedLabel.append(deletedCheck,document.createTextNode(' 削除済みの共通メモを表示（管理者）'));$('filters').append(deletedLabel);
try{const r=await fetch(new URL('assets/review/catalog_v5.json',R.rootURL));if(!r.ok)throw Error();catalog=await r.json()}catch{$('notice').textContent='元プリントのリンクを読み込めません。再読み込みしてください'}
const pendingOp=()=>{const s=N.state();return s.queue.find(o=>o.scope===s.conflictScope)||s.queue[0]};
function render(){
 const s=N.state(),a=R.state().auth;view.value=s.view;deletedLabel.hidden=!s.is_admin||s.view==='private';
 const notes=s.notes.filter(n=>!n.deleted||n.scope==='shared'&&s.is_admin&&deletedCheck.checked);
 $('status').textContent=s.status;fillAccount($('account'),async()=>{await R.refresh();await N.sync()});
 $('stats').replaceChildren(el('span','',`共通 ${s.allNotes.filter(n=>n.scope==='shared'&&!n.deleted).length}件`),el('span','',`個人 ${s.allNotes.filter(n=>n.scope==='private'&&!n.deleted).length}件`),el('span','',`未送信 ${s.queue.length}件`));
 const op=pendingOp();$('conflict').hidden=!op;if(op&&conflictId!==op.op_id){conflictId=op.op_id;$('localBody').value=op.body;$('serverBody').textContent='「サーバーのメモを確認」を押してください';$('conflictTitle').textContent=`${scopeName(op.scope)}メモ・No.${op.target.no}`;$('localBody').hidden=op.action!=='put';$('deleteConflict').hidden=op.action==='put';$('deleteConflict').textContent=op.action==='restore'?'この端末では復元を待っています。':'この端末では削除を待っています。';$('apply').textContent=op.action==='delete'?'削除を適用':op.action==='restore'?'復元を適用':'入力内容を保存'}if(!op)conflictId=null;
 const q=$('query').value.trim().normalize('NFKC').toLocaleLowerCase('ja');let rows=notes.filter(n=>($('kind').value==='all'||n.target.kind===$('kind').value)&&(!$('no').value||n.target.no===Number($('no').value))&&(!q||[n.body,n.target.text,`No.${n.target.no}`].join('\n').normalize('NFKC').toLocaleLowerCase('ja').includes(q)));
 rows.sort((a,b)=>$('sort').value==='no'?a.target.no-b.target.no||a.target.page.localeCompare(b.target.page,'ja',{numeric:true}):$('sort').value==='created'?(b.created_at||'').localeCompare(a.created_at||''):(b.updated_at||'').localeCompare(a.updated_at||''));
 $('count').textContent=`${rows.length}件${rows.length>limit?'（先頭'+limit+'件）':''}`;$('more').hidden=rows.length<=limit;$('list').replaceChildren();
 if(!rows.length)$('list').append(el('p','kr-card',a?'この条件に該当するメモはありません。':'ログインするとメモを表示します。'));
 for(const n of rows.slice(0,limit)){
  const t=n.target,card=el('article','kr-card');card.dataset.scope=n.scope;
  card.append(el('span','kr-pill',`${scopeName(n.scope)}・${kinds[t.kind]}${colors[t.color]?'・'+colors[t.color]:''}${n.deleted?'・削除済み':''}${n.pending?'・未送信':''}`),el('h2','',`No.${t.no} ｜ ${t.text||'指定箇所'}`),el('p','kn-body',n.body),el('p','kr-meta',`作成：${date(n.created_at)} ／ 更新：${date(n.updated_at)}`));
  if(n.scope==='shared')card.append(el('p','kr-meta',`作成者：${n.created_label||'保存待ち'} ／ 更新者：${n.updated_label||'保存待ち'}`));
  const actions=el('div','kr-row'),p=catalog[t.page];if(p&&!n.deleted){const u=new URL(p.href,R.rootURL);u.searchParams.set('page',t.page);u.searchParams.set('note',n.id);u.searchParams.set('noteScope',n.scope);const link=el('a','','元プリントの位置を開く');link.href=u.href;actions.append(link)}
  if(!n.deleted){const edit=button('編集',()=>openEditor(t,n.scope,false));edit.disabled=!!n.pending;actions.append(edit)}
  if(n.scope==='shared')actions.append(button('変更履歴',()=>openHistory(n)));
  if(N.canDelete(n.scope)){const del=button(n.deleted?'復元':'削除',async()=>{if(confirm(n.deleted?'この共通メモを復元しますか？':'このメモを削除しますか？復習チェックは残ります。')){if(n.deleted)await N.restore(t,n.version);else await N.remove(t,n.version,n.scope)}});del.disabled=!!n.pending;actions.append(del)}
  card.append(actions);$('list').append(card);
 }
}
async function openHistory(note){
 const owner=R.state().auth?.user_id,dialog=el('dialog','kr-dialog');dialog.setAttribute('aria-label','共通メモの変更履歴');const content=el('div'),close=button('閉じる',()=>dialog.close()),more=button('さらに履歴を表示',()=>load());dialog.append(el('h2','','共通メモの変更履歴'),close,content,more);document.body.append(dialog);
 let before=null;async function load(){more.disabled=true;try{const data=await N.history(note.id,before);if(R.state().auth?.user_id!==owner){dialog.close();return}for(const h of data.history){const item=el('details');item.append(el('summary','',`第${h.version}版・${{put:'保存',delete:'削除',restore:'復元'}[h.action]}・${date(h.at)}・${h.actor_label}`),el('p','kn-body',h.body));content.append(item)}before=data.next_before;more.hidden=!data.has_more}finally{more.disabled=false}}
 const stop=R.subscribe(()=>{if(R.state().auth?.user_id!==owner)dialog.close()});dialog.addEventListener('close',()=>{stop();dialog.remove()},{once:true});dialog.showModal();try{await load()}catch(e){content.append(el('p','kr-error',e.message));more.hidden=true}
}
for(const id of ['kind','no','sort'])$(id).onchange=()=>{limit=60;render()};$('query').oninput=()=>{limit=60;render()};$('more').onclick=()=>{limit+=60;render()};
$('serverRead').onclick=safe(async()=>{const op=pendingOp();if(!op)return;const d=await R.api(op.scope==='shared'?'/shared-notes':'/notes'),n=d.notes.find(n=>n.id===op.id);$('serverBody').textContent=n&&!n.deleted?n.body:'（サーバー側では削除済み、または未登録）'});
$('apply').onclick=safe(()=>{const op=pendingOp();return N.resolveConflict(true,op?.action==='put'?$('localBody').value:undefined)});
$('discard').onclick=safe(async()=>{if(confirm('この端末の未送信内容を取り下げ、サーバー側のメモを使いますか？必要な内容は先にコピーしてください。'))await N.resolveConflict(false)});
R.subscribe(render);N.subscribe(render);await R.init();await N.init();render();
