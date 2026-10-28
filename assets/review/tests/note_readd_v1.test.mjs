import {readFile} from 'node:fs/promises';
import test from 'node:test';

class Events {addEventListener(){} removeEventListener(){} dispatchEvent(){}}
const clone=v=>JSON.parse(JSON.stringify(v));
function harness(source,{admin=true,deleted=1,failPut=false,failRestore=false}={}){
 let disk={base:[{id:'target',version:2,deleted,body:'old',target:{kind:'page',no:85,page:'No85_p1'}}],queue:[]},server=clone(disk.base[0]),calls=[],serial=0;
 const R={state:()=>({auth:{user_id:'user',token:'token'}}),subscribe:()=>{},canonical:t=>t,targetId:async()=> 'target',random:()=> 'op'+(++serial),read:async()=>clone(disk),change:async(k,fn)=>{disk=fn(clone(disk))},api:async(path,opts={})=>{
 if(path==='/shared-notes')return {notes:[clone(server)],is_admin:admin};
 const op=JSON.parse(opts.body);calls.push(clone(op));
 if((failPut&&op.action==='put')||(failRestore&&op.action==='restore'))throw Error('offline');
 if(op.expected!==server.version)throw Object.assign(Error('conflict'),{status:409});
 if(op.action!=='put'&&!admin)throw Object.assign(Error('forbidden'),{status:403});
 if(op.action==='put'&&server.deleted)throw Error('restore_required');
 server={...server,version:server.version+1,deleted:op.action==='delete'?1:0,body:op.action==='put'?op.body:server.body};
 return {note:clone(server),is_admin:admin};
 }};
 const code=source.replace(/^import .*;\n/,'').replace(/\bexport /g,'');
 const service=new Function('R','EventTarget','Event','structuredClone','BroadcastChannel','window','document','navigator','setInterval',code+';return {init,put,remove,state};')(R,Events,class{},clone,class{postMessage(){}},{addEventListener(){}},{addEventListener(){},hidden:true},{},()=>{});
 return {service,target:server.target,disk:()=>disk,server:()=>server,calls};
}
async function verify(source,editors){
 const check=(v,msg)=>{if(!v)throw Error(msg)};
 const rejects=async(fn,pattern)=>{try{await fn()}catch(e){check(pattern.test(e.message),'unexpected '+e.message);return}throw Error('expected rejection')};
 let h=harness(source);await h.service.init();await h.service.put(h.target,'new',2);
 check(h.calls.map(o=>o.action).join(',')==='restore,put','must restore before put');
 check(h.calls[0].expected===2&&h.calls[1].expected===3,'versions advance');
 check(h.server().body==='new'&&!h.server().deleted&&h.server().version===4,'new note saved');
 h=harness(source,{deleted:0});await h.service.init();await h.service.remove(h.target,2);await h.service.put(h.target,'replacement',3);check(h.calls.map(o=>o.action).join(',')==='delete,restore,put'&&h.server().body==='replacement'&&!h.server().deleted,'delete then add completes');
 h=harness(source,{admin:false});await h.service.init();await rejects(()=>h.service.put(h.target,'new',2),/復元/);check(!h.calls.length,'nonadmin cannot restore');
 h=harness(source,{failPut:true});await h.service.init();await h.service.put(h.target,'new',2);
 check(h.disk().queue.length===1&&h.disk().queue[0].body==='new'&&h.disk().queue[0].expected===3,'offline new content retained');
 h=harness(source,{failRestore:true});await h.service.init();await h.service.put(h.target,'new',2);
 check(h.disk().queue.length===2&&h.disk().queue[1].body==='new','both operations retained before restore');
 h=harness(source);await h.service.init();await rejects(()=>h.service.put(h.target,' ',2),/6000/);await rejects(()=>h.service.put(h.target,'new',1),/更新/);check(!h.calls.length,'invalid body and stale revisions leave deleted note untouched');
 h=harness(source,{deleted:0});await h.service.init();await h.service.put(h.target,'new',2);check(h.calls.length===1&&h.calls[0].action==='put','active notes need no restore');
 for(const editor of editors)check(editor.includes("if(note?.deleted&&scope==='shared'&&!N.canDelete(scope))"),'admin can open blank editor');
 return 'PASS: admin delete/re-add, role restriction, offline after/before restore, validation, stale revision, normal edits, both editor entry points';
}

test('deleted shared memo can be replaced by admin with durable restore and put',async()=>{const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');await verify(await read('shared_notes_v12.js'),await Promise.all(['note_editor_v14.js','note_editor_v15.js'].map(read)));});
