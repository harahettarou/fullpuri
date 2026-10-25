import {test} from 'node:test';
import assert from 'node:assert/strict';
import {memoSummary} from '../memo_summary_v28.js';
const page={key:'No163_p1',no:163},next={key:'No163_p2',no:163};
const note=(key,kind='range',deleted=0)=>({target:{page:key,no:163,kind},deleted});
const state=allNotes=>({allNotes,notes:allNotes});
test('No163: the three memos on 2/2 never appear on 1/2',()=>{
 const s=state([note(next.key),note(next.key),note(next.key)]);
 assert.equal(memoSummary(s,page).total,0);assert.equal(memoSummary(s,next).total,3);assert.equal(memoSummary(s,page).total,0);
});
test('No. whole-print memos apply to each physical page; page/word/range memos stay on their page',()=>{
 const s=state(['page','word','range','print'].map(kind=>note(page.key,kind)));
 assert.equal(memoSummary(s,page).total,4);assert.equal(memoSummary(s,next).total,1);
});
test('scope display filter never hides the presence of saved memos',()=>{
 assert.deepEqual(memoSummary({allNotes:[note(page.key)],notes:[]},page),{total:1,shown:0,hidden:1});
});
test('deleted memos and other No. never count; pending new memos count immediately',()=>{
 const a=note(page.key),pending={...a,pending:true},deleted=note(page.key,'page',1),other={target:{page:'No164_p1',no:164,kind:'print'}};
 assert.deepEqual(memoSummary(state([pending,deleted,other]),page),{total:1,shown:1,hidden:0});
});
test('before a page is available the summary is empty',()=>{
 assert.deepEqual(memoSummary(state([note(page.key)]),null),{total:0,shown:0,hidden:0});
});
