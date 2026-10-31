import * as R from './core_v12.js';
import * as C from './ocr_corrections_v1.js';
import {preserveNoteViewport} from './note_viewport_v1.js';
const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n};
export function selectedText(text,start,end){return end>start?{text:text.slice(start,end),start,end}:{text,start:0,end:text.length}}
export async function openWordActions(target){
 const owner=R.state().auth?.user_id;
 if(!owner)throw Error('先にログインしてください');
 try{await C.refresh()}catch{}
 if(R.state().auth?.user_id!==owner)throw Error('ログイン状態が変わりました');
 const dialog=el('dialog');dialog.className='kr-dialog';dialog.setAttribute('aria-label','文字を修正');
 const heading=el('h2','文字を修正'),help=el('p','正しい文字を入力してください。「保存」は検索用に保存、「復習に登録」は保存と復習登録をして終了します。');help.className='kr-note';
 const text=el('textarea');text.setAttribute('aria-label','修正する文字');text.maxLength=1000;text.rows=4;text.style.cssText='font-size:16px;width:100%;box-sizing:border-box';
 let current=C.find(target.page,target.rect),expected=current?.version||0,savedFull=null,busy=false;
 text.value=current?.text??target.text;
 const notice=el('p');notice.setAttribute('role','status');notice.style.whiteSpace='pre-wrap';
 const controls=el('div');controls.className='kr-row';const buttons=[];
 const button=(label,fn)=>{const b=el('button',label);b.type='button';b.onclick=async()=>{if(busy)return;busy=true;buttons.forEach(n=>n.disabled=true);notice.textContent='';try{await fn()}catch(e){notice.textContent=e.message}finally{busy=false;buttons.forEach(n=>n.disabled=false)}};buttons.push(b);return b};
 async function save(alsoReview){
  if(R.state().auth?.user_id!==owner)throw Error('ログイン状態が変わりました');
  const full=text.value.trim();if(!full)throw Error('正しい文字を入力してください');
  const value=selectedText(text.value,text.selectionStart,text.selectionEnd).text.trim();
  if(alsoReview&&!value)throw Error('復習する文字を選択してください');
  notice.textContent='保存中…';
  if(savedFull!==full){current=await C.put(target,full,expected);expected=current.version;savedFull=full}
  if(alsoReview){
   if(R.state().auth?.user_id!==owner)throw Error('ログイン状態が変わりました');
   await R.act('register',{...target,text:value,kind:'word',color:target.color||'black'});
  }
  dialog.close();
 }
 controls.append(button('保存',()=>save(false)),button('復習に登録',()=>save(true)),button('閉じる',()=>dialog.close()));
 dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault()});
 const stop=R.subscribe(()=>{if(R.state().auth?.user_id!==owner)dialog.close()});dialog.addEventListener('close',()=>{stop();dialog.remove()},{once:true});
 dialog.append(heading,help,text,notice,controls);preserveNoteViewport(dialog);document.body.append(dialog);dialog.showModal();text.focus({preventScroll:true});
}
