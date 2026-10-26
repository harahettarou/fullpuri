import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchMemos,memoLink} from '../../search/memo-search-model_v1.js';
const root='https://example.com/fullpuri/';
const target={no:85,page:'No085_p1',kind:'range'};
const note=(id,scope,body,extra={})=>({id,scope,body,target,updated_at:'2026-10-26',...extra});
test('body search normalizes width, case, kana and multiple terms',()=>{
 const rows=[note('a','shared','ＡＢＣ カタカナ\n世界史'),note('b','private','ABC 世界史')];
 assert.deepEqual(searchMemos(rows,'abc　かたかな').map(n=>n.id),['a']);
 assert.deepEqual(searchMemos(rows,'世界史').map(n=>n.id),['a','b']);
 assert.deepEqual(searchMemos(rows,'  '),[]);
});
test('scope, deleted and pending notes are respected; target-only matches are excluded',()=>{
 const rows=[note('a','shared','革命'),note('b','private','革命',{pending:true}),note('c','shared','革命',{deleted:1}),note('d','other','革命'),note('e','private','別内容',{target:{...target,text:'革命'}})];
 assert.deepEqual(searchMemos(rows,'革命','private').map(n=>n.id),['b']);
 assert.deepEqual(searchMemos(rows,'革命').map(n=>n.id),['a','b']);
});
test('links keep scope and note ID without putting private memo bodies in URLs',()=>{
 const n=note('a','private','secret'),catalog={No085_p1:{href:'pages/print.html'}};
 const u=new URL(memoLink(n,catalog,root));
 assert.equal(u.searchParams.get('noteScope'),'private');assert.equal(u.searchParams.get('note'),'a');assert.equal(u.searchParams.get('page'),target.page);assert.ok(!u.href.includes('secret'));
 assert.equal(memoLink(n,{},root),null);
 assert.equal(memoLink(n,{No085_p1:{href:'https://other.test/'}},root),null);
 assert.equal(memoLink(n,{No085_p1:{href:'../outside.html'}},root),null);
});
test('material memo links include material target and memo scope',()=>{
 const n=note('mat','shared','test',{target:{...target,material:{id:'m1',page:2}}});
 const u=new URL(memoLink(n,{},root,(t,extra)=>`${root}pages/material.html?id=${t.material.id}&page=${t.material.page}&note=${extra.note}&noteScope=${extra.noteScope}`));
 assert.equal(u.searchParams.get('id'),'m1');assert.equal(u.searchParams.get('page'),'2');assert.equal(u.searchParams.get('noteScope'),'shared');
});
