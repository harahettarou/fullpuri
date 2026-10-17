import {fillAccount} from './account_controls_v12.js';
import * as N from './notes_core_v13.js';
import * as R from './core_v12.js';
const $=s=>document.getElementById(s),kind={print:'No.全体',page:'ページ',word:'語句',range:'指定範囲'},colors={red:'赤',green:'緑',orange:'オレンジ',black:'黒'};
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n};
const safe=fn=>async()=>{try{$('notice').textContent='';await fn()}catch(e){$('notice').textContent=e.message}};
function button(text,fn){const b=el('button','',text);b.type='button';b.onclick=safe(fn);return b}
let catalog={},limit=60;
try{const response=await fetch(new URL('assets/review/catalog_v5.json',R.rootURL));if(!response.ok)throw Error();catalog=await response.json()}catch{$('notice').textContent='元プリントのリンク情報を読み込めません。再読み込みしてください。'}
function itemLabel(target){const unit=catalog[target.page]?.unit;return `No.${target.no}${unit?' ｜ '+unit:''}`}
function render(){
 const s=R.state(),all=s.entries.filter(e=>!e.deleted);
 $('status').textContent=s.status;$('setup').hidden=s.configured;
 fillAccount($('account'),async()=>{await R.flush();await R.refresh();await N.sync()});
 const back=sessionStorage.getItem('kopuri-review-return');if(back){try{const u=new URL(back);if(u.origin===R.rootURL.origin&&u.pathname.startsWith(R.rootURL.pathname)&&u.pathname!==location.pathname){const a=el('a','','開いていたプリントへ戻る');a.href=u.href;$('account').append(a)}}catch{}}
 $('stats').replaceChildren(el('span','',`要復習 ${all.filter(e=>e.state==='todo').length}件`),el('span','',`復習完了 ${all.filter(e=>e.state==='done').length}件`),el('span','',`登録合計 ${all.length}件`),el('span','',`未送信 ${s.queue.length}件`));
 $('conflict').hidden=!s.conflict;
 const op=s.queue[0];$('conflictDetail').textContent=op?`${itemLabel(op.target)} ／ 未送信操作：${{register:'登録',complete:'復習完了',reopen:'再登録',delete:'削除'}[op.action]}`:'';
 let rows=all.filter(e=>($('state').value==='all'||e.state===$('state').value)&&($('kind').value==='all'||e.target.kind===$('kind').value)&&($('no').value===''||e.target.no===Number($('no').value)));
 rows.sort((a,b)=>$('sort').value==='no'?a.target.no-b.target.no||a.target.page.localeCompare(b.target.page,'ja',{numeric:true}):$('sort').value==='old'?(a.created_at||'').localeCompare(b.created_at||''):(b.created_at||'').localeCompare(a.created_at||''));
 $('count').textContent=`${rows.length}件${rows.length>limit?'（先頭'+limit+'件を表示）':''}`;$('more').hidden=rows.length<=limit;$('list').replaceChildren();
 if(!rows.length)$('list').append(el('p','kr-card',s.auth?'この条件に該当する登録はありません。':'ログインすると個人の復習リストを表示します。'));
 for(const e of rows.slice(0,limit)){
  const t=e.target,card=el('article','kr-card');
  card.append(el('span','kr-pill',`${kind[t.kind]}${colors[t.color]?'・'+colors[t.color]:''} ／ ${e.state==='todo'?'要復習':'復習完了'}${e.pending?'・未送信':''}`),el('h2','',itemLabel(t)));
  card.append(el('p','kr-meta',`登録：${e.created_at?R.formatDate(e.created_at):'サーバー保存待ち'} ／ 復習 ${e.review_count}回${e.pending?'（未確定操作を含む）':''} ／ 最終：${R.formatDate(e.last_reviewed_at)}`));
  if(e.completed_at)card.append(el('p','kr-meta','復習完了：'+R.formatDate(e.completed_at)));
  const actions=el('div','kr-row'),p=catalog[t.page];
  if(p){const link=el('a','','元プリントの位置を開く');const u=new URL(p.href,R.rootURL);u.searchParams.set('page',t.page);u.searchParams.set('review',e.id);link.href=u.href;actions.append(link)}
  const complete=button(e.state==='todo'?'復習完了':'要復習へ戻す',()=>R.act(e.state==='todo'?'complete':'reopen',t));complete.disabled=!!e.pending;
  const del=button('削除',async()=>{if(confirm('この登録を削除しますか？要復習・完了一覧から除外します。'))await R.act('delete',t)});del.disabled=!!e.pending;
  actions.append(complete,button('履歴',async()=>{
   const d=await R.history(e.id),dialog=$('history');dialog.replaceChildren(button('閉じる',()=>dialog.close()),el('h2','','復習履歴'));
   const labels={register:'登録',complete:'復習完了',reopen:'要復習へ再登録',delete:'削除'};
   for(const h of d.history)dialog.append(el('p','',R.formatDate(h.at)+'：'+labels[h.action]));dialog.showModal();
  }),del);card.append(actions);$('list').append(card);
 }
}
for(const id of ['state','kind','sort','no'])$(id).onchange=()=>{limit=60;render()};
$('more').onclick=()=>{limit+=60;render()};
$('apply').onclick=safe(()=>R.resolveConflict(true));$('discard').onclick=safe(()=>R.resolveConflict(false));
R.subscribe(render);await R.init();await N.init();render();
