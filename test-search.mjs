import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
class Element{constructor(){this.value='';this.children=[];this.style={};this.listeners={}}replaceChildren(...n){this.children=n}append(...n){this.children.push(...n)}addEventListener(n,fn){this.listeners[n]=fn}focus(){}}
const input=new Element(),results=new Element(),status=new Element();
const page={key:'No001_p1',no:1,href:'No001.html',label:'No.1',unit:'古代',width:1000,height:1000,lines:[{t:'見易物',n:'見易物',x:100,y:200,w:400,h:30},{t:'ピラミッド',n:'ぴらみっど',x:10,y:10,w:20,h:20}]};
const data=new TextEncoder().encode(JSON.stringify({pages:[page]}));
const c={state:()=>[{page:page.key,rect:[.1,.2,.4,.03],text:'賜物',original:'見易物'}],subscribe(fn){this.update=fn},async refresh(){this.update()}};
const context=vm.createContext({console,URL,URLSearchParams,TextDecoder,TextEncoder,Uint8Array,Map,Array,Number,Promise,document:{getElementById:id=>id==='q'?input:id==='status'?status:results,createElement:()=>new Element()},location:{href:'https://site/fullpuri/pages/search.html',search:'',origin:'https://site'},window:{},setTimeout,clearTimeout,fetch:async url=>{if(String(url).includes('orange'))throw Error('no orange in test');return {ok:true,arrayBuffer:async()=>data.buffer}}});
const synthetic=new vm.SyntheticModule(Object.keys(c),function(){for(const [k,v]of Object.entries(c))this.setExport(k,typeof v==='function'?v.bind(c):v)},{context});
const script=new vm.Script(readFileSync(new URL('./assets/search/search-app_v78.js',import.meta.url),'utf8'),{importModuleDynamically:async()=>{await synthetic.link(()=>{});await synthetic.evaluate();return synthetic}});script.runInContext(context);await new Promise(resolve=>setTimeout(resolve,30));
input.value='賜物';context.window.KopuriSearchTest.render();assert.equal(results.children.length,1);assert.ok(results.children[0].children.some(n=>n.textContent==='賜物'));assert.ok(results.children[0].href.includes('hit=100%2C200%2C400%2C30'));
input.value='見易物';context.window.KopuriSearchTest.render();assert.equal(results.children.length,0,'corrected exact OCR box no longer matches its misread text');
input.value='ピラミッド';context.window.KopuriSearchTest.render();assert.equal(results.children.length,1,'uncorrected OCR remains searchable');
console.log('Search: corrected text and coordinates, replaced OCR and existing OCR passed');
