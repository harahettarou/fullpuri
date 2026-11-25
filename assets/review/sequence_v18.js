import * as R from './core_v12.js';
import {materialLink} from '../materials/model_v15.js';
const prefix='review:sequence:',param='review_session';
export async function createSequence(entries){const uid=R.state().auth?.user_id;if(!uid)throw Error('ログインしてください');const id=R.random();await R.change(prefix+uid+':'+id,()=>({owner:uid,ids:[...new Set(entries.filter(e=>!e.deleted).map(e=>e.id))],at:Date.now()}));return id}
export function entryURL(e,catalog,session){const t=e.target;let u;if(t.material)u=new URL(materialLink(t,{review:e.id}));else {const p=catalog[t.page];if(!p)return null;u=new URL(p.href,R.rootURL);u.searchParams.set('page',t.page);u.searchParams.set('review',e.id)}if(session)u.searchParams.set(param,session);return u}
export async function startReview(current){const entries=R.state().entries.filter(e=>!e.deleted&&(e.state==='todo'||e.id===current)).sort((a,b)=>a.target.no-b.target.no||a.target.page.localeCompare(b.target.page,'ja',{numeric:true}));if(!entries.length)throw Error('要復習の登録がありません');const response=await fetch(new URL('assets/classic/catalog_v18.json',R.rootURL));if(!response.ok)throw Error('移動情報を取得できません');const catalog=await response.json(),session=await createSequence(entries),url=entryURL(entries.find(e=>e.id===current)||entries[0],catalog,session);if(!url)throw Error('元プリントが見つかりません');location.assign(url.href)}
export async function initSequence(){
 const params=new URLSearchParams(location.search),current=params.get('review');if(!current)return;let session=params.get(param),uid=null,ids=[],busy=false,initializing=false,closed=false;
 const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./sequence_v18.css?v=side-by-side',import.meta.url);document.head.append(css);
 const box=document.createElement('section');box.className='ks-bar';box.setAttribute('aria-label','復習を続ける');box.hidden=true;const label=document.createElement('span'),status=document.createElement('span');status.setAttribute('role','status');status.className='ks-status';
 const previous=document.createElement('a'),next=document.createElement('a'),finish=document.createElement('button'),repeat=document.createElement('button'),close=document.createElement('button');previous.textContent='← 前の復習';next.textContent='次の復習 →';finish.textContent='復習完了して次へ';repeat.textContent='もう一度復習';close.textContent='閉じる';close.onclick=()=>{closed=true;box.remove();document.body.classList.remove('ks-active');observer.disconnect();window.removeEventListener('resize',position);window.visualViewport?.removeEventListener('resize',position);window.visualViewport?.removeEventListener('scroll',position)};box.append(label,previous,next,finish,repeat,close,status);document.body.append(box);
 const bottom=document.querySelector('.nav')||document.getElementById('bottomNav');
 const launcher=document.querySelector('.kr-launch');
 function position(){
  const nav=bottom?.getBoundingClientRect();
  box.style.bottom=Math.max(0,nav?innerHeight-nav.top:0)+8+'px';
  const button=launcher?.getBoundingClientRect();
  if(button?.width)box.style.setProperty('--ks-right',Math.ceil(innerWidth-button.left+8)+'px');
  else box.style.removeProperty('--ks-right');
 }
 const observer=new ResizeObserver(position);
 if(bottom)observer.observe(bottom);
 if(launcher)observer.observe(launcher);
 window.addEventListener('resize',position);
 window.visualViewport?.addEventListener('resize',position);
 window.visualViewport?.addEventListener('scroll',position);
 position();
 let catalog={};try{const r=await fetch(new URL('assets/classic/catalog_v18.json',R.rootURL));if(!r.ok)throw Error();catalog=await r.json()}catch{status.textContent='プリントの移動情報を取得できません。再読み込みしてください'}
 const rows=()=>{const entries=R.state().entries,map=new Map(entries.filter(e=>!e.deleted).map(e=>[e.id,e]));return ids.map(id=>map.get(id)).filter(e=>e&&entryURL(e,catalog,session))};
 function render(){if(closed)return;const auth=R.state().auth;if(!auth||auth.user_id!==uid){box.hidden=true;document.body.classList.remove('ks-active');return}const all=rows(),i=all.findIndex(e=>e.id===current);box.hidden=false;document.body.classList.add('ks-active');position();if(i<0){label.textContent='この復習は削除済み、または一覧にありません';previous.hidden=true;next.hidden=true;finish.hidden=true;repeat.hidden=true;return}const e=all[i];label.textContent=`復習 ${i+1}/${all.length}件${e.state==='done'?'・完了':R.isUncertain(e)?'・△ 不安':R.isRepeat(e)?'・もう一度復習':''} ／ 間違い ${e.mistake_count??0}回`;previous.hidden=i===0;next.hidden=i===all.length-1;if(i>0)previous.href=entryURL(all[i-1],catalog,session).href;if(i<all.length-1)next.href=entryURL(all[i+1],catalog,session).href;const pendingRepeat=R.state().queue.some(op=>op.id===current&&op.action==='repeat');repeat.hidden=e.state==='done';repeat.disabled=busy||!!e.pending&&!pendingRepeat;repeat.textContent=pendingRepeat?'保存を再試行':'もう一度復習';finish.hidden=pendingRepeat;finish.disabled=busy;finish.textContent=e.pending?'保存を再試行':e.state==='done'?(i<all.length-1?'次の復習へ':'最後の項目です'):'復習完了'+(i<all.length-1?'して次へ':'にする');if(e.state==='done'&&i===all.length-1)finish.disabled=true;if(R.state().queue.length)status.textContent=R.state().status}
 async function record(action){
  if(busy)return;
  const e=rows().find(e=>e.id===current);
  if(!e)return;
  status.textContent='';busy=true;render();
  try{
   if(e.pending)await R.flush();
   else if(e.state==='todo')await R.act(action,e.target);
   const latest=R.state().entries.find(n=>n.id===current&&!n.deleted);
   if(!latest||latest.pending||(action==='complete'&&latest.state!=='done'))throw Error('保存を確認できません。変更は端末に保持しています。「保存を再試行」を押してください');
   const all=rows(),i=all.findIndex(n=>n.id===current);
   if(i>=0&&all[i+1])location.assign(entryURL(all[i+1],catalog,session).href);
   else status.textContent=action==='repeat'?'間違いを記録しました':'復習完了を保存しました';
  }catch(e){status.textContent=e.message}finally{busy=false;render()}
 }
 finish.onclick=()=>record('complete');
 repeat.onclick=()=>record('repeat');
 async function account(){const auth=R.state().auth;if(!auth){uid=null;ids=[];render();return}if(uid===auth.user_id){render();return}if(initializing)return;initializing=true;const owner=auth.user_id;try{let saved=session?await R.read(prefix+owner+':'+session):null;if(!saved||saved.owner!==owner||Date.now()-saved.at>7*86400000){const es=R.state().entries.filter(e=>!e.deleted&&(e.state==='todo'||e.id===current)).sort((a,b)=>a.target.no-b.target.no||a.target.page.localeCompare(b.target.page,'ja',{numeric:true}));if(!es.some(e=>e.id===current))return;session=await createSequence(es);saved=await R.read(prefix+owner+':'+session);const u=new URL(location.href);u.searchParams.set(param,session);history.replaceState(null,'',u)}if(R.state().auth?.user_id!==owner)return;uid=owner;ids=saved.ids;render()}finally{initializing=false}}
 R.subscribe(()=>account().catch(e=>{status.textContent=e.message}));await account();
}
