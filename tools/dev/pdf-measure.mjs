import fs from 'fs';
import { createCanvas } from 'canvas';
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(process.argv[2]))}).promise;
const pn = parseInt(process.argv[3]);
const page = await doc.getPage(pn);
let vp = page.getViewport({scale:1}); const Hmm = vp.height/72*25.4, Wmm = vp.width/72*25.4;
const scale = 1000/vp.width; vp = page.getViewport({scale});
const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height)); const ctx=c.getContext('2d');
ctx.fillStyle='white'; ctx.fillRect(0,0,c.width,c.height);
await page.render({canvasContext:ctx, viewport:vp, canvasFactory:{create:(w,h)=>{const cc=createCanvas(w,h);return{canvas:cc,context:cc.getContext('2d')};},reset:(o,w,h)=>{o.canvas.width=w;o.canvas.height=h;},destroy:(o)=>{o.canvas.width=0;}}}).promise;
const d=ctx.getImageData(0,0,c.width,c.height).data;
const px2mm = Hmm/c.height;
// find first dark row (top content) and last dark row (footer bottom)
let firstDark=-1,lastDark=-1;
for(let y=0;y<c.height;y++){let dark=0;for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;if(d[i]<120)dark++;}if(dark>3){if(firstDark<0)firstDark=y;lastDark=y;}}
console.log(`page ${pn}: ${Wmm.toFixed(0)}x${Hmm.toFixed(0)}mm`);
console.log(`  TOP margin (edge->first content): ${(firstDark*px2mm).toFixed(1)}mm`);
console.log(`  BOTTOM (last content/footer -> edge): ${((c.height-lastDark)*px2mm).toFixed(1)}mm`);
