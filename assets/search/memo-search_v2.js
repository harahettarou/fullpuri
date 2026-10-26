import * as R from '../review/core_v12.js';
import * as N from '../review/notes_core_v14.js';
import {fillAccount} from '../review/account_controls_v12.js';
import {documentLabel,materialLink} from '../materials/model_v15.js';
import {searchMemos,memoLink} from './memo-search-model_v2.js';

const host=document.getElementById('memo-search'),input=document.getElementById('q'),account=document.getElementById('memo-account'),status=document.getElementById('memo-status');
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node};
const more=el('button','','メモの続きを表示');more.id='memo-more';more.type='button';
let catalog={},catalogFailed=false,limit=40,timer;
function render(){
 const auth=R.state().auth,s=N.state(),query=input.value.trim();
 fillAccount(account,async()=>{await R.refresh();await N.sync()});
 // Search both scopes, regardless of the scope selected elsewhere in the site.
 const rows=searchMemos(auth?s.allNotes:[],query),shared=rows.filter(n=>n.scope==='shared').length;
 host.replaceChildren();more.hidden=!auth||rows.length<=limit;
 if(!auth){status.textContent='共通・個人メモ：ログインすると両方を自動で検索します。';return}
 status.textContent=(query?`共通メモ：${shared}件 ／ 個人メモ：${rows.length-shared}件${rows.length>limit?'（メモは先頭'+limit+'件）':''}`:'共通メモ・個人メモも常に検索します。')+'\n'+s.status+(catalogFailed?'\n元プリントのリンクを取得できません。再読み込みしてください。':'');
 for(const note of rows.slice(0,limit)){
  const href=memoLink(note,catalog,R.rootURL,materialLink),card=el(href?'a':'article','result memo-result');if(href)card.href=href;
  const top=el('div','topline'),p=catalog[note.target?.page];
  top.append(el('span','label',note.target?documentLabel(note.target):'メモ'),el('span','unit',p?.label||note.target?.text||''),el('span','score',`${note.scope==='shared'?'共通メモ':'個人メモ'}${note.pending?'・未送信':''}`));
  card.append(top,el('div','context',note.body));host.append(card);
 }
 if(rows.length>limit)host.append(more);
}
input.addEventListener('input',()=>{clearTimeout(timer);limit=40;timer=setTimeout(render,160)});
more.addEventListener('click',()=>{limit+=40;render()});
R.subscribe(render);N.subscribe(render);render();
const catalogLoad=fetch(new URL('assets/review/catalog_v5.json',R.rootURL),{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(data=>{catalog=data}).catch(()=>{catalogFailed=true}).finally(render);
// OCR initializes the URL query before loading its index; never reset user input here.
await R.init();await N.init();await catalogLoad;render();
