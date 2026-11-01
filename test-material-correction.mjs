import assert from 'node:assert/strict';
import {editorDocument,applyEditorDocument,pairsOnPage} from './assets/materials/correction_model_v19.js';
import {snapshot} from './assets/materials/model_v15.js';
import {validateMaterialCorrections,materialData} from './assets/review/server/worker_v21.mjs';
const r=[.1,.2,.3,.04],g=[.2,.3,.2,.05];
const data={title:'教材',subject:'世界史',folder:'',annotations:[{id:'oldred',page:1,kind:'red-mask',rect:r},{id:'green',page:1,kind:'green-mask',rect:g},{id:'orange',page:1,kind:'text',rect:r,text:'元の文字',color:'orange',font_size:20},{id:'black',page:2,kind:'text',rect:r,text:'別ページ',color:'black',font_size:14}]};
let doc=editorDocument(data,1);assert.deepEqual(doc.regions.hide,[r]);assert.equal(doc.native.length,2);
doc.regions.keep.push([.1,.2,.05,.04]);doc.native.find(n=>n.ref==='orange').text='正しい文字';doc.native.find(n=>n.ref==='green').color='#112233';
doc.pairs.push({id:'pair1',body_rect:r,answer_page:'pdf_2',answer_rect:g,text:'条約',font_size:32,enabled:true});
applyEditorDocument(data,1,doc);assert.equal(data.annotations.find(a=>a.id==='orange').text,'正しい文字');assert.equal(data.annotations.find(a=>a.id==='green').color,'#112233');assert.ok(!data.annotations.some(a=>a.id==='oldred'));assert.ok(data.annotations.some(a=>a.id==='black'));
assert.equal(pairsOnPage(data,2)[0].text,'条約');assert.deepEqual(snapshot(data).corrections,data.corrections);
const roundTrip=validateMaterialCorrections(JSON.parse(JSON.stringify(data.corrections)),2);assert.deepEqual(roundTrip,data.corrections);const reopened=editorDocument({...data,corrections:roundTrip},1);assert.equal(reopened.pairs[0].answer_page,'pdf_2');assert.equal(reopened.regions.keep.length,1);
doc.annotations.push({id:'newgreen',page:1,kind:'green-mask',rect:g,color:'#abcdef'});applyEditorDocument(data,1,doc);applyEditorDocument(data,1,doc);assert.equal(data.annotations.filter(a=>a.id==='newgreen').length,1);doc.annotations=[];applyEditorDocument(data,1,doc,['newgreen']);assert.ok(!data.annotations.some(a=>a.id==='newgreen'),'deleting new green really removes it');
const orange=doc.native.find(n=>n.ref==='orange');orange.answer_page='pdf_2';orange.answer_rect=g;applyEditorDocument(data,1,doc);assert.ok(!data.annotations.some(a=>a.id==='orange'));assert.equal(editorDocument(data,1).pairs.find(p=>p.id==='orange').text,'正しい文字','existing orange can become a cross-page pair');
for(const bad of [{3:{regions:{hide:[],keep:[]},pairs:[]}},{1:{regions:{hide:[[1,1,.1,.1]],keep:[]},pairs:[]}},{1:{regions:{hide:[],keep:[]},pairs:[{...doc.pairs[0],answer_page:'pdf_3'}]}}])assert.throws(()=>validateMaterialCorrections(bad,2));
console.log('PASS: existing annotations, mask keep regions, cross-page pairs, preview snapshots, reload, green add/delete, orange conversion and server validation');

assert.deepEqual(materialData(data,2).corrections,data.corrections);assert.equal(materialData(data,2).annotations.find(a=>a.id==='green').color,'#112233');console.log('PASS: full server save preserves material corrections and marker color');
