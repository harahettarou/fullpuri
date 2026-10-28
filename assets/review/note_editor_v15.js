import * as R from './core_v12.js';
import * as N from './notes_core_v14.js';
const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n};
export async function openEditor(target,scope=N.creationScope()){
 if(!R.state().auth)throw Error('先にログインしてください');
 const id=await R.targetId(R.canonical(target)),note=N.state().allNotes.find(n=>n.id===id&&n.scope===scope),expected=note?.version||0;
 if(note?.pending)throw Error('このメモは保存待ちです。メモ一覧で再同期・競合解決をしてください');
 if(note?.deleted&&scope==='shared')throw Error('この共通メモは削除済みです。管理者がメモ一覧から復元できます');
 const dialog=el('dialog');dialog.className='kr-dialog kn-editor';dialog.setAttribute('aria-label','メモの編集');
 const heading=el('h2',`${target.material?target.material.title+" "+target.material.page+"ページ":"No."+target.no} のメモ`),where=el('p',target.text||'指定箇所'),text=el('textarea');text.style.fontSize='16px';text.maxLength=6000;text.value=note&&!note.deleted?note.body:'';text.placeholder='覚え方・間違えた理由・補足など';text.setAttribute('aria-label','メモ本文');
 const scopeLabel=el('label','保存先 '),select=el('select');select.style.fontSize='16px';select.setAttribute('aria-label','メモの保存先');select.innerHTML='<option value="shared">共通メモ（ログインした全員に公開）</option><option value="private">個人メモ（自分だけ）</option>';select.value=scope;select.disabled=false;scopeLabel.append(select);
 const help=el('p',scope==='shared'?'ログインした全員が閲覧・編集できます。削除・復元は管理者のみです。':'このメモは自分だけが閲覧・編集・削除できます。');help.className='kr-note';
 const notice=el('p');notice.className='kr-error';notice.setAttribute('role','alert');const count=el('p');count.className='kr-meta';
 const buttons=el('div');buttons.className='kr-row kn-editor-actions';let busy=false,saved=text.value;
 const close=()=>{if(busy)return;if(text.value!==saved&&!confirm('未保存のメモを閉じますか？'))return;dialog.close()};
 const button=(label,fn)=>{const b=el('button',label);b.type='button';b.onclick=async()=>{try{notice.textContent='';await fn()}catch(e){notice.textContent=e.message}};return b};
 const save=button('メモを保存',async()=>{busy=true;save.disabled=true;select.disabled=true;try{await N.put(target,text.value,expected,scope);saved=text.value;dialog.close()}finally{busy=false;save.disabled=false;select.disabled=false}});
 const del=button(scope==='shared'?'共通メモから削除':'個人メモを削除',async()=>{if(busy)return;if(confirm(scope==='shared'?'共通メモから削除しますか？個人メモ・復習記録・共通メモの変更履歴は残ります。':'この個人メモを削除しますか？共通メモと復習記録は残ります。')){busy=true;save.disabled=del.disabled=select.disabled=true;try{await N.remove(target,expected,scope);saved=text.value;dialog.close()}finally{busy=false;save.disabled=del.disabled=select.disabled=false}}});del.className='kn-delete';
 const showDelete=()=>{if(note&&!note.deleted&&N.canDelete(scope))buttons.append(del);else del.remove()};const stopRole=N.subscribe(showDelete);dialog.addEventListener('close',stopRole,{once:true});buttons.append(save,button('閉じる',close));showDelete();
 select.onchange=async()=>{
  const next=select.value;select.value=scope;if(busy||next===scope)return;
  if(note&&!note.deleted){
   const question=scope==='private'?'個人メモを残したまま、現在の入力内容を共通メモとして全員に公開しますか？':'共通メモは残したまま、現在の入力内容を個人メモにコピーしますか？';
   if(!confirm(question))return;busy=true;save.disabled=del.disabled=select.disabled=true;notice.textContent='追加先に保存中…';
   try{await N.copyScope(target,text.value,expected,scope);saved=text.value;N.setView(next);await openEditor(target,next,true);dialog.close()}catch(e){notice.textContent=e.message}finally{busy=false;save.disabled=del.disabled=select.disabled=false}
  }else{
   if(text.value!==saved&&!confirm('未保存の入力を破棄して保存先を切り替えますか？'))return;
   try{await openEditor(target,next,true);dialog.close()}catch(e){notice.textContent=e.message}
  }
 };
 text.oninput=()=>count.textContent=text.value.length+' / 6000文字';text.oninput();
 const warn=e=>{if(text.value!==saved){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',warn);dialog.addEventListener('close',()=>window.removeEventListener('beforeunload',warn),{once:true});
 dialog.addEventListener('cancel',e=>{e.preventDefault();close()});dialog.addEventListener('close',()=>dialog.remove());
 const owner=R.state().auth?.user_id;const unsubscribe=R.subscribe(()=>{if(R.state().auth?.user_id!==owner)dialog.close()});dialog.addEventListener('close',unsubscribe,{once:true});
 dialog.append(heading,scopeLabel,help,where,text,count,notice,buttons);document.body.append(dialog);dialog.showModal();text.focus();
}
