// Search only notes made available by the existing account-scoped notes service.
export const normalizeMemo=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ja').replace(/[ァ-ヶ]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-96)).replace(/\s+/g,' ').trim();
export function searchMemos(notes,query,scope='both'){
 const terms=normalizeMemo(query).split(' ').filter(Boolean);if(!terms.length)return [];
 return notes.filter(n=>!n.deleted&&['shared','private'].includes(n.scope)&&(scope==='both'||n.scope===scope)&&typeof n.body==='string'&&terms.every(term=>normalizeMemo(n.body).includes(term)))
  .sort((a,b)=>(b.updated_at||b.created_at||'').localeCompare(a.updated_at||a.created_at||'')||String(a.id).localeCompare(String(b.id)));
}
export function memoLink(note,catalog,rootURL,materialLink){
 const t=note.target;if(!t)return null;
 let u;
 if(t.material)u=new URL(materialLink(t,{note:note.id,noteScope:note.scope}));
 else {const p=catalog[t.page];if(!p)return null;u=new URL(p.href,rootURL);u.searchParams.set('page',t.page);u.searchParams.set('note',note.id);u.searchParams.set('noteScope',note.scope)}
 const root=new URL(rootURL);
 if(u.origin!==root.origin||!u.pathname.startsWith(root.pathname)||!['http:','https:','file:'].includes(u.protocol))return null;
 return u.href;
}
