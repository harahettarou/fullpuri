import {openCorrection} from '../classic/correction_v25.js?v=material-classic-v19';
import {editorDocument,applyEditorDocument,pageKey} from './correction_model_v19.js';
export function materialCorrectionEditor(B){
 const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('../classic/editor_v21.css',import.meta.url);document.head.append(css);
 const dialog=document.createElement('dialog');dialog.className='kc-editor';dialog.setAttribute('aria-label','教材を編集');document.body.append(dialog);
 let current=null,watch=()=>{},generation=0;
 async function open(){
  if(!B.available())throw Error('未完了の保存・復元を確認してください');
  if(B.composerDirty())throw Error('入力中の文字を配置・更新するか、入力をクリアしてください');
  const tick=++generation,owner=B.owner(),page=B.page(),material=B.material();
  const source=new Map(Array.from({length:material.page_count},(_,i)=>{const n=i+1;return [pageKey(n),{key:pageKey(n),label:n+'ページ',width:600,height:800,hide:[],keep:[],greenHide:[],numberPairs:[]}]}));
  const first=await B.pdf().getPage(page),v=first.getViewport({scale:1});Object.assign(source.get(pageKey(page)),{width:v.width,height:v.height});
  if(tick!==generation||owner!==B.owner())return;
  current={page,doc:editorDocument(B.data(),page)};
  const images=new Map();
  async function loadImage(p){
   const n=Number(p.key.slice(4));if(images.has(n))return images.get(n);
   const pdfPage=await B.pdf().getPage(n),base=pdfPage.getViewport({scale:1});Object.assign(p,{width:base.width,height:base.height});
   const canvas=document.createElement('canvas'),v=pdfPage.getViewport({scale:Math.min(2,1800/Math.max(base.width,base.height))});canvas.width=Math.ceil(v.width);canvas.height=Math.ceil(v.height);
   await pdfPage.render({canvasContext:canvas.getContext('2d'),viewport:v}).promise;
   if(tick!==generation)throw Error('編集画面を閉じました');images.set(n,canvas);if(images.size>3)images.delete(images.keys().next().value);return canvas;
  }
  const finish=async()=>{await B.save();generation++;dialog.close();await B.finish();};
  const save=async()=>{await B.save();notify()};
  openCorrection({dialog,source,page:()=>source.get(pageKey(page)),doc:()=>current.doc,loadImage,
   update:fn=>{B.checkpoint();const previousAdded=current.doc.annotations.map(a=>a.id);fn();applyEditorDocument(B.data(),page,current.doc,previousAdded);B.changed();notify()},
   locked:()=>!B.available(),watch:fn=>{watch=fn;notify()},draft:()=>B.draft(page),setDraft:d=>B.setDraft(page,d),
   save,publish:async()=>{await B.publish();notify()},end:finish,
   legacy:()=>{generation++;dialog.close();B.legacy()},
   undo:()=>{B.undo();current.doc=editorDocument(B.data(),page);notify()},redo:()=>{B.redo();current.doc=editorDocument(B.data(),page);notify()},
   goto:async direction=>{await save();generation++;dialog.close();await B.go((page-1+direction+material.page_count)%material.page_count+1);await open()}
  });
 }
 function notify(){watch(B.status())}
 return {open,notify,close:()=>{generation++;dialog.close()}};
}
