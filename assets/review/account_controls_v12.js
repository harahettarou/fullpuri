import * as R from './core_v12.js';
export function fillAccount(container,sync=R.refresh){
 const s=R.state(),auth=s.auth;container.replaceChildren();
 const label=document.createElement('strong');label.textContent=s.sessionExpired?'ログイン期限切れ':auth?auth.login:'未ログイン';container.append(label);
 const notice=document.createElement('p');notice.className='kr-error';notice.setAttribute('role','alert');
 const button=(text,fn,disabled=false)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.disabled=disabled;b.onclick=async()=>{try{notice.textContent='';await fn()}catch(e){notice.textContent=e.message;container.append(notice)}};container.append(b);return b};
 if(s.sessionExpired){
  button('Googleで再ログイン',()=>R.login('google'),!s.providers.google);
  if(s.providers.github)button('GitHubで再ログイン',()=>R.login('github'));
  const help=document.createElement('p');help.className='kr-note';help.textContent='前回と同じアカウントを選ぶと、復習・メモを引き継げます。';container.append(help);
 }else if(!auth){
  button('Googleでログイン',()=>R.login('google'),!s.providers.google);
  button('GitHubでログイン',()=>R.login('github'));
  const help=document.createElement('p');help.className='kr-note';help.textContent='GitHubで使っていた方は、GitHubでログインしてからGoogleを連携すると、今の復習・メモを引き継げます。';container.append(help);
  if(!s.providers.google){const ready=document.createElement('span');ready.className='kr-note';ready.textContent='Googleログインは準備中です';container.append(ready)}
 }else{
  button('ログアウト',R.logout);button('再同期',sync);
  if(s.account.google_linked){const linked=document.createElement('span');linked.className='kr-note';linked.textContent='Google連携済み';container.append(linked)}
  else button('Googleアカウントを連携',async()=>{await sync();await R.linkGoogle()},!s.providers.google);
 }
}
