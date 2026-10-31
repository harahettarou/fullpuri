import * as R from './core_v12.js';
import * as C from './ocr_corrections_v1.js';
import {preserveNoteViewport} from './note_viewport_v1.js';
const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n};
export function selectedText(text,start,end){return end>start?{text:text.slice(start,end),start,end}:{text,start:0,end:text.length}}
export function replaceSelection(text,selection,value){return text.slice(0,selection.start)+value+text.slice(selection.end)}
export async function openWordActions(target){
 // Refresh revisions before editing; review-only registration remains available offline.
 try{await C.refresh()}catch{}
 const dialog=el('dialog');dialog.className='kr-dialog';dialog.setAttribute('aria-label','文字の修正と復習登録');
 const heading=el('h2','文字を選択して登録'),help=el('p','必要な文字だけを選択できます。選択しない場合は全文が対象です。読み取れていない文字は入力してください。');help.className='kr-note';
 const text=el('textarea');text.setAttribute('aria-label','選択する文字');text.maxLength=1000;text.rows=4;text.style.cssText='font-size:16px;width:100%;box-sizing:border-box';
 let current=C.find(target.page,target.rect),selection=null,busy=false;
 text.value=current?.text??target.text;
 const notice=el('p');notice.setAttribute('role','status');notice.style.whiteSpace='pre-wrap';
 const controls=el('div');controls.className='kr-row';const buttons=[];
 const owner=R.state().auth?.user_id;
 const checkOwner=()=>{if(!owner||R.state().auth?.user_id!==owner)throw Error('先にログインしてください')};
 const button=(label,fn)=>{const b=el('button',label);b.type='button';b.onclick=async()=>{if(busy)return;busy=true;buttons.forEach(n=>n.disabled=true);notice.textContent='';try{await fn()}catch(e){notice.textContent=e.message}finally{busy=false;buttons.forEach(n=>n.disabled=false)}};buttons.push(b);return b};
 const remember=()=>{selection=selectedText(text.value,text.selectionStart,text.selectionEnd)};
 text.addEventListener('select',remember);text.addEventListener('input',remember);text.addEventListener('keyup',remember);text.addEventListener('pointerup',remember);
 const chosen=()=>{const s=selection||selectedText(text.value,0,0);if(!s.text.trim())throw Error('文字を入力または選択してください');return s};
 const register=async value=>{checkOwner();await R.act('register',{...target,text:value.trim(),kind:'word',color:target.color||'black'});notice.textContent='復習に登録しました。'+R.state().status};
 const startCorrection=alsoReview=>{
  checkOwner();const s=chosen(),line=text.value;current=C.find(target.page,target.rect);const expected=current?.version||0;
  heading.textContent='検索用の文字を修正';help.textContent='正しい文字を入力してください。検索用の修正は共通で保存され、ほかの端末からも使えます。';
  text.value=s.text;selection=null;controls.replaceChildren();
  controls.append(button('検索用に保存',async()=>{
   checkOwner();const value=text.value.trim();if(!value)throw Error('正しい文字を入力してください');
   const full=replaceSelection(line,s,value);if(full.length>1000)throw Error('修正後の文字は1000文字以内にしてください');
   notice.textContent='保存中…';current=await C.put(target,full,expected);
   text.value=value;text.readOnly=true;heading.textContent='検索用の文字を保存しました';help.textContent='この文字で検索できます。必要なら続けて復習に登録できます。';
   controls.replaceChildren(button('この文字を復習に登録',()=>register(value)),button('閉じる',()=>dialog.close()));
   notice.textContent='検索用に保存しました。';
   if(alsoReview)await register(value);
  }),button('戻る',()=>{text.value=line;selection=null;showChoices()}),button('閉じる',()=>dialog.close()));
  text.focus({preventScroll:true});text.select();
 };
 function showChoices(){heading.textContent='文字を選択して登録';help.textContent='必要な文字だけを選択できます。選択しない場合は全文が対象です。読み取れていない文字は入力してください。';controls.replaceChildren(button('検索用の文字を修正',()=>startCorrection(false)),button('復習に登録',()=>register(chosen().text)),button('修正して復習に登録',()=>startCorrection(true)),button('閉じる',()=>dialog.close()))}
 dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault()});
 const stop=R.subscribe(()=>{if(R.state().auth?.user_id!==owner)dialog.close()});dialog.addEventListener('close',()=>{stop();dialog.remove()},{once:true});
 showChoices();dialog.append(heading,help,text,notice,controls);preserveNoteViewport(dialog);document.body.append(dialog);dialog.showModal();
 // Do not summon the keyboard until the user chooses to edit/select text.
}
