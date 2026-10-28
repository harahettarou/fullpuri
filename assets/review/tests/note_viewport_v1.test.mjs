import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preserveNoteViewport} from '../note_viewport_v1.js';
function setup(){
 const win=new EventTarget(),viewport=new EventTarget(),frames=new Map(),timers=new Map();let id=0;
 Object.assign(win,{scrollX:0,scrollY:42,visualViewport:viewport,readerZoom:103.5,scrollTo({left,top}){this.scrollX=left;this.scrollY=top},requestAnimationFrame(fn){frames.set(++id,fn);return id},cancelAnimationFrame(i){frames.delete(i)},setTimeout(fn){timers.set(++id,fn);return id},clearTimeout(i){timers.delete(i)}});
 const scroller={scrollLeft:170,scrollTop:820,isConnected:true},dialogs=[];
 const doc={activeElement:null,querySelectorAll(selector){return selector==='.kn-editor[open]'?dialogs.filter(d=>d.open):[scroller]}};
 function open(){const d=new EventTarget();Object.assign(d,{open:false,fields:[{style:{}}],querySelectorAll(){return this.fields},contains(node){return this.fields.includes(node)}});dialogs.push(d);preserveNoteViewport(d,win,doc);d.open=true;return d}
 function close(d){d.open=false;d.dispatchEvent(new Event('close'))}
 const flush=map=>{const jobs=[...map.values()];map.clear();jobs.forEach(fn=>fn())};
 return {win,viewport,scroller,doc,open,close,frames,timers,frame:()=>flush(frames),settle:()=>flush(timers)};
}
test('close restores reader/document scroll, including delayed keyboard resize, without changing viewer zoom',()=>{
 const s=setup(),d=s.open();assert.equal(d.fields[0].style.fontSize,'16px');let blurred=false;d.fields[0].blur=()=>blurred=true;s.doc.activeElement=d.fields[0];
 s.win.scrollY=180;s.scroller.scrollTop=130;s.close(d);assert.ok(blurred);assert.equal(s.win.scrollY,42);assert.equal(s.scroller.scrollTop,820);
 s.win.scrollY=80;s.scroller.scrollLeft=0;s.viewport.dispatchEvent(new Event('resize'));s.frame();assert.equal(s.win.scrollY,42);assert.equal(s.scroller.scrollLeft,170);assert.equal(s.win.readerZoom,103.5);s.settle();assert.equal(s.frames.size,0);assert.equal(s.timers.size,0);
});
test('switching memo scope keeps the original reader position and does not move the replacement dialog',()=>{
 const s=setup(),first=s.open();s.win.scrollY=210;s.scroller.scrollTop=40;const next=s.open();s.close(first);assert.equal(s.win.scrollY,210);assert.equal(s.scroller.scrollTop,40);s.close(next);s.frame();assert.equal(s.win.scrollY,42);assert.equal(s.scroller.scrollTop,820);s.settle();
});
test('cancelling an unsaved-close confirmation does not restore or remove the active editor',()=>{
 const s=setup(),d=s.open();s.win.scrollY=200;d.dispatchEvent(new Event('cancel'));s.viewport.dispatchEvent(new Event('resize'));s.frame();s.settle();assert.equal(d.open,true);assert.equal(s.win.scrollY,200);
});
test('the next reader gesture cancels delayed restoration so intentional scrolling stays put',()=>{
 const s=setup(),d=s.open();s.close(d);s.win.dispatchEvent(new Event('pointerdown'));s.win.scrollY=99;s.scroller.scrollTop=1200;s.viewport.dispatchEvent(new Event('resize'));s.frame();s.settle();assert.equal(s.win.scrollY,99);assert.equal(s.scroller.scrollTop,1200);
});
