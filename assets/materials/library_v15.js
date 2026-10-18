import * as R from '../review/core_v12.js';
import {fillAccount} from '../review/account_controls_v12.js';
import * as M from './core_v15.js';
const $=id=>document.getElementById(id),el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n};
let materials=[],admin=false,owner=null,busy=false,limit=60,loadSeq=0;
const safe=fn=>async e=>{try{$('notice').textContent='';await fn(e)}catch(e){$('notice').textContent=e.message}};
function options(id,values,all=true){const s=$(id),saved=s.value;s.replaceChildren();if(all){const o=el('option','すべて');o.value='';s.append(o)}for(const v of [...new Set(values)].filter(Boolean).sort((a,b)=>a.localeCompare(b,'ja'))){const o=el('option',v);o.value=v;s.append(o)}if([...s.options].some(o=>o.value===saved))s.value=saved}
function render(){
 $('uploadPanel').hidden=!admin;$('stateLabel').hidden=!admin;
 const query=$('query').value.trim().normalize('NFKC').toLowerCase();const rows=materials.filter(m=>(!$('subject').value||m.subject===$('subject').value)&&(!$('folder').value||m.folder===$('folder').value)&&(!query||[m.title,m.subject,m.folder].join(' ').normalize('NFKC').toLowerCase().includes(query))&&(!admin||({all:true,active:!m.archived,draft:!m.archived&&!m.published,published:!m.archived&&m.published,archived:m.archived}[$('state').value])));
 $('count').textContent=`${rows.length}件`;$('more').hidden=rows.length<=limit;$('list').replaceChildren();
 if(!rows.length)$('list').append(el('p',R.state().auth?'表示できる教材はありません。':'ログインすると公開中の教材を表示します。'));
 for(const m of rows.slice(0,limit)){const card=el('article');card.className='ml-card';const badge=el('span',m.subject);badge.className='ml-badge';card.append(badge,el('h2',m.title),el('p',m.folder||'フォルダーなし'));const meta=el('p',`${m.page_count}ページ・${(m.file_size/1024/1024).toFixed(1)}MB${admin?' ｜ '+(m.archived?'アーカイブ':!m.uploaded?'PDF送信待ち':m.published?'公開中':'下書き'):''}`);meta.className='ml-meta';card.append(meta);
  const actions=el('div');actions.className='ml-row';const link=(text,edit)=>{const a=el('a',text);a.className='ml-button'+(!edit?' primary':'');a.href=`material.html?id=${m.id}${edit?'&edit=1':''}`;actions.append(a)};
  if(m.uploaded)link('開く',false);if(admin)link('編集・公開設定',true);card.append(actions);$('list').append(card);
 }
}
async function reload(){
 const uid=R.state().auth?.user_id,seq=++loadSeq;if(!uid){materials=[];admin=false;render();return}
 $('status').textContent='教材を読み込み中…';
 const cfg=await M.config();if(seq!==loadSeq||R.state().auth?.user_id!==uid)return;admin=cfg.is_admin;render();
 if(!cfg.enabled)throw Error('教材の保存先が未設定です。管理者がCloudflareでMATERIALS_BUCKETを設定してください。');
 const data=await M.list();if(seq!==loadSeq||R.state().auth?.user_id!==uid)return;materials=data.materials;admin=data.is_admin;
 options('subject',materials.map(m=>m.subject));options('folder',materials.map(m=>m.folder));options('subjects',materials.map(m=>m.subject),false);options('folders',materials.map(m=>m.folder),false);render();$('status').textContent='サーバーの教材を読み込みました';
}
function account(){fillAccount($('account'),async()=>{await R.refresh();await reload()});const uid=R.state().auth?.user_id||null;if(owner!==uid){owner=uid;materials=[];admin=false;render();safe(reload)()}}
$('reload').onclick=safe(reload);for(const id of ['subject','folder','query','state'])$(id).addEventListener(id==='query'?'input':'change',()=>{limit=60;render()});$('more').onclick=()=>{limit+=60;render()};
$('file').onchange=()=>{const f=$('file').files[0];if(f&&!$('title').value)$('title').value=f.name.replace(/\.pdf$/i,'')};
$('uploadForm').onsubmit=safe(async e=>{
 e.preventDefault();if(busy)return;const uid=R.state().auth?.user_id;if(!uid||!admin)throw Error('管理者でログインしてください');const file=$('file').files[0];if(!file)throw Error('PDFを選択してください');if(file.size>50*1024*1024||file.size<5)throw Error('PDFは50MB以内で選択してください');busy=true;$('upload').disabled=true;
 try{
  $('uploadStatus').textContent='PDFを確認中…';const bytes=new Uint8Array(await file.arrayBuffer());if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('PDFファイルを選択してください');
  const sha=await M.sha256(bytes),{openPDF}=await import('./pdf_support_v15.js'),pdf=await openPDF(bytes);const pages=pdf.numPages;await pdf.destroy();if(pages>1000)throw Error('1000ページ以内のPDFを選択してください');if(R.state().auth?.user_id!==uid)throw Error('ログイン状態が変わりました');
  const pendingKey=`materials:upload:${uid}:${sha}`,saved=await R.read(pendingKey),id=saved?.id||M.id();await R.change(pendingKey,()=>({id,sha}));
  await M.create({id,sha256:sha,file_size:file.size,page_count:pages,title:$('title').value,subject:$('subjectInput').value,folder:$('folderInput').value});
  if(R.state().auth?.user_id!==uid)throw Error('ログイン状態が変わりました');$('uploadStatus').textContent='PDF送信中…';await M.upload(id,file,sha,p=>$('uploadStatus').textContent=`PDF送信中 ${p}%（完了するまでこの画面でお待ちください）`);
  if(R.state().auth?.user_id!==uid)throw Error('ログイン状態が変わりました');await R.change(pendingKey,()=>undefined);$('uploadStatus').textContent='PDFをサーバーに保存しました';location.assign(`material.html?id=${id}&edit=1`);
 }catch(error){$('uploadStatus').textContent='保存未完了。同じPDFで再送できます。';throw error}finally{busy=false;$('upload').disabled=false}
});
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue=''}});
R.subscribe(account);await R.init();account();if(!R.state().auth)$('status').textContent='ログインしてください';
