// Match the existing No. page renderer: fit inside the body box and center.
export function drawNumberText(ctx,rect,text,fontSize){
 const [x,y,w,h]=rect;
 ctx.fillStyle='#fff';ctx.fillRect(x,y,w,h);
 ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
 const maxW=Math.max(1,w-8),maxH=Math.max(1,h-6);let size=Math.min(Number(fontSize)||34,maxH),fitted=8;
 for(;size>=8;size--){ctx.font=`700 ${size}px "Yu Gothic","Hiragino Kaku Gothic ProN",sans-serif`;const m=ctx.measureText(text),height=(m.actualBoundingBoxAscent||size*.8)+(m.actualBoundingBoxDescent||size*.2);if(m.width<=maxW&&height<=maxH){fitted=size;break}}
 ctx.fillStyle='#e6812b';ctx.font=`700 ${fitted}px "Yu Gothic","Hiragino Kaku Gothic ProN",sans-serif`;
 ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,x+w/2,y+h/2);ctx.restore();
}
