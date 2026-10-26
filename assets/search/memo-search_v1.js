import * as R from '../review/core_v12.js';
import * as N from '../review/notes_core_v14.js';
import {fillAccount} from '../review/account_controls_v12.js';
import {documentLabel,materialLink} from '../materials/model_v15.js';
import {searchMemos,memoLink} from './memo-search-model_v1.js';

const host=document.getElementById('memo-search'),input=document.getElementById('q');
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node};
const heading=el('h2','','メモ本文の検索'),controls=el('div','memo-controls'),account=el('div','memo-account'),status=el('p','status'),list=el('div','results'),more=el('button','','さらに表示');
status.setAttribute('role','status');status.setAttribute('aria-live','polite');
const scope=el('select');scope.setAttribute('aria-label','検索するメモの範囲');
for(const [value,label] of [['both','共通・個人メモ'],['shared','共通メモ'],['private','個人メモ']]){const option=el('option','',label);option.value=value;scope.append(option)}
const label=el('label','','対象 ');label.append(scope);const manage=el('a','','メモ一覧を開く');manage.href=new URL('pages/notes.html',R.rootURL).href;controls.append(label,manage);
host.append(heading,controls,account,status,list,more);
let catalog={},catalogFailed=false,limit=40,timer;
function render(){
 const auth=R.state().auth,s=N.state(),query=input.value.trim();
 fillAccount(account,async()=>{await R.refresh();await N.sync()});
 const notes=auth?s.allNotes:[],rows=searchMemos(notes,query,scope.value);
 list.replaceChildren();more.hidden=!auth||rows.length<=limit;
 if(!auth){status.textContent='ログインすると、共通メモと自分の個人メモを検索できます。';return}
 status.textContent=(query?`メモ ${rows.length}件${rows.length>limit?'（先頭'+limit+'件）':''}`:'検索欄に文字を入力すると、メモ本文も検索します。')+'\n'+s.status+(catalogFailed?'\n元プリントのリンクを取得できません。メモ一覧から確認してください。':'');
 for(const note of rows.slice(0,limit)){
  const href=memoLink(note,catalog,R.rootURL,materialLink),card=el(href?'a':'article','result');if(href)card.href=href;
  const top=el('div','topline'),p=catalog[note.target?.page];
  top.append(el('span','label',note.target?documentLabel(note.target):'メモ'),el('span','unit',p?.label||note.target?.text||''),el('span','score',`${note.scope==='shared'?'共通メモ':'個人メモ'}${note.pending?'・未送信':''}`));
  card.append(top,el('div','context',note.body));list.append(card);
 }
}
input.addEventListener('input',()=>{clearTimeout(timer);limit=40;timer=setTimeout(render,160)});
scope.addEventListener('change',()=>{limit=40;render()});more.addEventListener('click',()=>{limit+=40;render()});
R.subscribe(render);N.subscribe(render);render();
const catalogLoad=fetch(new URL('assets/review/catalog_v5.json',R.rootURL),{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(data=>{catalog=data}).catch(()=>{catalogFailed=true}).finally(render);
// Keep memo search usable even when the OCR index fails to load.
const initial=new URLSearchParams(location.search).get('q');if(initial!==null)input.value=initial;
await R.init();await N.init();await catalogLoad;render();
