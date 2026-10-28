// Keep the reader position across keyboard movement, without changing its zoom or masks.
const sessions=new WeakMap();
export function preserveNoteViewport(dialog,win=window,doc=document){
 const previous=[...doc.querySelectorAll('.kn-editor[open]')].map(d=>sessions.get(d)).find(Boolean);
 const snapshot=previous||{x:win.scrollX,y:win.scrollY,scrollers:[...doc.querySelectorAll('#scroller,.scroller')].map(node=>({node,x:node.scrollLeft,y:node.scrollTop}))};
 sessions.set(dialog,snapshot);
 for(const field of dialog.querySelectorAll('textarea,select,input'))field.style.fontSize='16px';
 let frame=0,timer=0,stopped=false;
 const anotherEditor=()=>[...doc.querySelectorAll('.kn-editor[open]')].some(d=>d!==dialog);
 const stop=()=>{if(stopped)return;stopped=true;win.cancelAnimationFrame(frame);win.clearTimeout(timer);win.visualViewport?.removeEventListener('resize',schedule);for(const type of ['pointerdown','touchstart','wheel','keydown'])win.removeEventListener(type,stop,true)};
 const restore=()=>{frame=0;if(stopped)return;if(anotherEditor()){stop();return}win.scrollTo({left:snapshot.x,top:snapshot.y,behavior:'instant'});for(const {node,x,y}of snapshot.scrollers)if(node.isConnected){node.scrollLeft=x;node.scrollTop=y}};
 function schedule(){if(stopped)return;win.cancelAnimationFrame(frame);frame=win.requestAnimationFrame(restore)}
 dialog.addEventListener('close',()=>{
  if(anotherEditor())return;
  const focus=doc.activeElement;if(focus&&dialog.contains(focus)&&typeof focus.blur==='function')focus.blur();
  restore();schedule();win.visualViewport?.addEventListener('resize',schedule);
  for(const type of ['pointerdown','touchstart','wheel','keydown'])win.addEventListener(type,stop,{capture:true,passive:true});
  // iOS finishes hiding the keyboard after dialog.close() has returned.
  timer=win.setTimeout(()=>{restore();stop()},600);
 },{once:true});
 return snapshot;
}
