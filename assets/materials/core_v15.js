import * as R from '../review/core_v12.js';
import {API_URL} from '../review/config_v1.js';
export const id=()=>crypto.randomUUID().replaceAll('-','');
export const list=()=>R.api('/materials');
export const config=()=>R.api('/materials/config');
export const get=(id,edit=false)=>R.api('/materials/'+id+(edit?'?edit=1':''));
export const create=data=>R.api('/materials',{method:'POST',body:JSON.stringify(data)});
export const operation=(id,op)=>R.api(`/materials/${id}/operations`,{method:'POST',body:JSON.stringify(op)});
const key=(uid,id)=>`materials:draft:${uid}:${id}`;
export const readDraft=(uid,id)=>R.read(key(uid,id));
export const writeDraft=(uid,id,value)=>R.change(key(uid,id),()=>value);
export async function pdfBytes(id){
 const auth=R.state().auth;if(!auth)throw Error('ログインしてください');
 const response=await fetch(API_URL.replace(/\/$/,'')+`/materials/${id}/pdf`,{headers:{Authorization:'Bearer '+auth.token},signal:AbortSignal.timeout(180000),cache:'no-store'});
 if(!response.ok){let data;try{data=await response.json()}catch{}throw Error(data?.error||'PDFを取得できません')}
 const bytes=new Uint8Array(await response.arrayBuffer());if(R.state().auth?.user_id!==auth.user_id)throw Error('ログイン状態が変わりました');return bytes;
}
export function upload(id,file,sha,progress){return new Promise((resolve,reject)=>{
 const auth=R.state().auth;if(!auth)return reject(Error('ログインしてください'));
 const xhr=new XMLHttpRequest();xhr.open('PUT',API_URL.replace(/\/$/,'')+`/materials/${id}/pdf`);xhr.timeout=300000;xhr.setRequestHeader('Authorization','Bearer '+auth.token);xhr.setRequestHeader('Content-Type','application/pdf');xhr.setRequestHeader('X-File-SHA256',sha);
 xhr.upload.onprogress=e=>{if(e.lengthComputable)progress(Math.round(e.loaded/e.total*100))};
 xhr.onerror=xhr.ontimeout=()=>reject(Error('PDFの送信に失敗しました。同じファイルで再送できます'));
 xhr.onload=()=>{try{const d=JSON.parse(xhr.responseText);if(xhr.status<200||xhr.status>=300)throw Error(d.error||'PDFの保存に失敗しました');if(R.state().auth?.user_id!==auth.user_id)throw Error('ログイン状態が変わりました');resolve(d)}catch(e){reject(e)}};xhr.send(file);
})}
export const sha256=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
export function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}
