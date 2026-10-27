import {revision} from './model_v19.js';
// The published HTML is the source of truth; no separate per-page catalog is required.
export async function canonicalPageIndex(page,rootURL,fetcher=fetch){
 const response=await fetcher(new URL('manifest.json',rootURL),{cache:'no-cache'});if(!response.ok)throw Error('ページ一覧を取得できません');const manifest=await response.json();
 const range=manifest.ranges.find(r=>page.no>=r.start&&page.no<=r.end);
 if(!range){const fallback=await fetcher(new URL('assets/classic/catalog_v18.json',rootURL));if(!fallback.ok)throw Error('ページ一覧を取得できません');return fallback.json()}
 if(typeof range.file!=='string'||!/^pages\/[^?#]+\.html$/.test(range.file)||range.file.includes('..'))throw Error('ページ一覧が不正です');
 const html=await fetcher(new URL(encodeURI(range.file),rootURL),{cache:'no-cache'});if(!html.ok)throw Error('古プリのHTMLを取得できません');
 const match=(await html.text()).match(/const PAGES\s*=\s*(\[.*?\]);/s);if(!match)throw Error('古プリのページ情報を読み取れません');const pages=JSON.parse(match[1]);
 const index=Object.fromEntries(pages.map(p=>[p.key,{href:range.file,fingerprint:revision(p,pages)}]));if(!index[page.key])throw Error('公開済みHTMLに対象ページがありません');return index;
}
