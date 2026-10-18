import * as pdfjs from './vendor/pdfjs-6.4.299/legacy/build/pdf.min.mjs';
const base=new URL('./vendor/pdfjs-6.4.299/',import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc=new URL('legacy/build/pdf.worker.min.mjs',base).href;
export function openPDF(bytes){const task=pdfjs.getDocument({data:bytes,cMapUrl:new URL('cmaps/',base).href,cMapPacked:true,standardFontDataUrl:new URL('standard_fonts/',base).href,wasmUrl:new URL('wasm/',base).href,iccUrl:new URL('iccs/',base).href,isEvalSupported:false,enableXfa:false});return task.promise.then(doc=>{doc.destroy=()=>task.destroy();return doc}).catch(async e=>{await task.destroy();if(e.name==='PasswordException')throw Error('パスワード付きPDFは対応していません。解除したPDFを選択してください');throw Error('PDFを開けません：'+e.message)})}
