import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classicTargets} from '../../classic/targets_v20.js';
import {validateTarget,targetId} from '../server/worker_v19.mjs';
const page={key:'No016_p1',no:16,width:1600,height:2278,hide:[[160,228,160,114]],greenHide:[],numberPairs:[]},source=new Map([[page.key,page]]);
test('already saved masks, correction regions and words become valid review targets without exposing black text',()=>{
 const rect=[.2,.4,.1,.03],data={annotations:[{kind:'green-mask',rect},{kind:'red-mask',rect:[.3,.4,.1,.03]},{kind:'text',color:'orange',text:'答え',rect:[.5,.4,.1,.03]},{kind:'white-cover',rect},{kind:'text',color:'black',text:'黒',rect}],regions:{hide:[[.1,.2,.1,.03]],keep:[[.6,.2,.1,.03]]}};
 const ts=classicTargets(page,data,source).targets;assert.equal(ts.length,4);assert.equal(ts.filter(t=>t.color==='red').length,2);assert.equal(ts.some(t=>t.text==='黒'),false);ts.forEach(validateTarget);assert.deepEqual(ts.find(t=>t.color==='green').rect,rect);
});
test('identical generated targets deduplicate and keep identity after labels change or reload',async()=>{
 const rect=[.2,.4,.1,.03],data={annotations:[{kind:'green-mask',rect},{kind:'green-mask',rect}]},a=classicTargets(page,data,source).targets,b=classicTargets(page,structuredClone(data),source).targets;assert.equal(a.length,1);assert.equal(await targetId(a[0]),await targetId({...b[0],text:'OCRの補正'}));assert.deepEqual(classicTargets(page,null,source),{targets:[],suppressed:[]});
});
