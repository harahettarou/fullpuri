import * as R from './core_v8.js';
import * as N from './notes_core_v8.js';
const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n};
export async function openEditor(target){
 if(!R.state().auth)throw Error('先にログインしてください');
 const id=await R.targetId(R.canonical(target)),note=N.state().notes.find(n=>n.id===id),expected=note?.version||0;
 if(note?.pending)throw Error('このメモは保存待ちです。メモ一覧で再同期・競合解決をしてください');
 const dialog=el('dialog');dialog.className='kr-dialog kn-editor';dialog.setAttribute('aria-label','メモの編集');
 const heading=el('h2',`No.${target.no} のメモ`),where=el('p',target.text||'指定箇所'),text=el('textarea');text.maxLength=6000;text.value=note&&!note.deleted?note.body:'';text.placeholder='覚え方・間違えた理由・補足など';text.setAttribute('aria-label','メモ本文');
 const notice=el('p');notice.className='kr-error';notice.setAttribute('role','alert');const count=el('p');count.className='kr-meta';
 const buttons=el('div');buttons.className='kr-row';let busy=false,saved=text.value;
 const close=()=>{if(busy)return;if(text.value!==saved&&!confirm('未保存のメモを閉じますか？'))return;dialog.close()};
 const button=(label,fn)=>{const b=el('button',label);b.type='button';b.onclick=async()=>{try{notice.textContent='';await fn()}catch(e){notice.textContent=e.message}};return b};
 const save=button('メモを保存',async()=>{busy=true;save.disabled=true;try{await N.put(target,text.value,expected);saved=text.value;dialog.close()}finally{busy=false;save.disabled=false}});
 buttons.append(save,button('閉じる',close));if(note&&!note.deleted)buttons.append(button('メモを削除',async()=>{if(confirm('このメモを削除しますか？復習チェックは残ります。')){await N.remove(target,expected);saved=text.value;dialog.close()}}));
 text.oninput=()=>count.textContent=text.value.length+' / 6000文字';text.oninput();
 const warn=e=>{if(text.value!==saved){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',warn);dialog.addEventListener('close',()=>window.removeEventListener('beforeunload',warn),{once:true});
 dialog.addEventListener('cancel',e=>{e.preventDefault();close()});dialog.addEventListener('close',()=>dialog.remove());
 const owner=R.state().auth?.user_id;const unsubscribe=R.subscribe(()=>{if(R.state().auth?.user_id!==owner){dialog.close()}});dialog.addEventListener('close',unsubscribe,{once:true});
 dialog.append(heading,where,text,count,notice,buttons);document.body.append(dialog);dialog.showModal();text.focus();
}
