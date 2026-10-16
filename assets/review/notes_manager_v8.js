import {fillAccount} from './account_controls_v8.js';
import * as R from './core_v8.js';
import * as N from './notes_core_v8.js';
import {openEditor} from './note_editor_v8.js';
const $=s=>document.getElementById(s),kinds={print:'No.全体',page:'ページ',word:'語句',range:'指定範囲'},colors={red:'赤',green:'緑',orange:'オレンジ',black:'黒'};
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n};
const safe=fn=>async()=>{try{$('notice').textContent='';await fn()}catch(e){$('notice').textContent=e.message}};
function button(label,fn){const b=el('button','',label);b.type='button';b.onclick=safe(fn);return b}
const date=s=>s?R.formatDate(s):'サーバー保存待ち';let catalog={},limit=60,conflictId=null;
try{const r=await fetch(new URL('assets/review/catalog_v1.json',R.rootURL));if(!r.ok)throw Error();catalog=await r.json()}catch{$('notice').textContent='元プリントのリンクを読み込めません。再読み込みしてください'}
function render(){
 const s=N.state(),a=R.state().auth,notes=s.notes.filter(n=>!n.deleted);
 $('status').textContent=s.status;fillAccount($('account'),async()=>{await R.refresh();await N.sync()});
 $('stats').replaceChildren(el('span','',`メモ ${notes.length}件`),el('span','',`未送信 ${s.queue.length}件`));
 const op=s.queue[0];$('conflict').hidden=!s.conflict;if(s.conflict&&op&&conflictId!==op.op_id){conflictId=op.op_id;$('localBody').value=op.body;$('serverBody').textContent='「サーバーのメモを確認」を押してください';$('conflictTitle').textContent=`No.${op.target.no} ${op.target.text||kinds[op.target.kind]}`;$('localBody').hidden=op.action==='delete';$('deleteConflict').hidden=op.action!=='delete';$('apply').textContent=op.action==='delete'?'削除を適用':'入力内容を保存'}if(!s.conflict)conflictId=null;
 const q=$('query').value.trim().normalize('NFKC').toLocaleLowerCase('ja');let rows=notes.filter(n=>($('kind').value==='all'||n.target.kind===$('kind').value)&&(!$('no').value||n.target.no===Number($('no').value))&&(!q||[n.body,n.target.text,`No.${n.target.no}`].join('\n').normalize('NFKC').toLocaleLowerCase('ja').includes(q)));
 rows.sort((a,b)=>$('sort').value==='no'?a.target.no-b.target.no||a.target.page.localeCompare(b.target.page,'ja',{numeric:true}):$('sort').value==='created'?(b.created_at||'').localeCompare(a.created_at||''):(b.updated_at||'').localeCompare(a.updated_at||''));
 $('count').textContent=`${rows.length}件${rows.length>limit?'（先頭'+limit+'件）':''}`;$('more').hidden=rows.length<=limit;$('list').replaceChildren();
 if(!rows.length)$('list').append(el('p','kr-card',a?'この条件に該当するメモはありません。':'ログインすると自分のメモを表示します。'));
 for(const n of rows.slice(0,limit)){const t=n.target,card=el('article','kr-card');card.append(el('span','kr-pill',`${kinds[t.kind]}${colors[t.color]?'・'+colors[t.color]:''}${n.pending?'・未送信':''}`),el('h2','',`No.${t.no} ｜ ${t.text||'指定箇所'}`),el('p','kn-body',n.body),el('p','kr-meta',`作成：${date(n.created_at)} ／ 更新：${date(n.updated_at)}`));const actions=el('div','kr-row'),p=catalog[t.page];if(p){const u=new URL(p.href,R.rootURL);u.searchParams.set('page',t.page);u.searchParams.set('note',n.id);const link=el('a','','元プリントの位置を開く');link.href=u.href;actions.append(link)}const edit=button('編集',()=>openEditor(t)),del=button('削除',async()=>{if(confirm('このメモを削除しますか？復習チェックは残ります。'))await N.remove(t,n.version)});edit.disabled=del.disabled=!!n.pending;actions.append(edit,del);card.append(actions);$('list').append(card)}
}
for(const id of ['kind','no','sort'])$(id).onchange=()=>{limit=60;render()};$('query').oninput=()=>{limit=60;render()};$('more').onclick=()=>{limit+=60;render()};
$('serverRead').onclick=safe(async()=>{const op=N.state().queue[0];if(!op)return;const d=await R.api('/notes'),n=d.notes.find(n=>n.id===op.id);$('serverBody').textContent=n&&!n.deleted?n.body:'（サーバー側では削除済み、または未登録）'});
$('apply').onclick=safe(()=>{const op=N.state().queue[0];return N.resolveConflict(true,op?.action==='put'?$('localBody').value:undefined)});
$('discard').onclick=safe(async()=>{if(confirm('この端末の未送信内容を取り下げ、サーバー側のメモを使いますか？必要な内容は先にコピーしてください。'))await N.resolveConflict(false)});
R.subscribe(render);N.subscribe(render);await R.init();await N.init();render();
