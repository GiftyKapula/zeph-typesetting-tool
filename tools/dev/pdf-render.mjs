import fs from 'fs';
import { createCanvas } from 'canvas';
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const [ , , file, pagesArg, outPrefix ] = process.argv;
const pages = pagesArg.split(',').map(n=>parseInt(n));
const data = new Uint8Array(fs.readFileSync(file));
const doc = await pdfjs.getDocument({data, useSystemFonts:true}).promise;
console.log('numPages', doc.numPages);
for(const pn of pages){
  if(pn>doc.numPages) continue;
  const page = await doc.getPage(pn);
  let vp = page.getViewport({scale:1});
  // target max width ~1600px
  const scale = Math.min(1600/vp.width, 2);
  vp = page.getViewport({scale});
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle='white'; ctx.fillRect(0,0,canvas.width,canvas.height);
  await page.render({canvasContext:ctx, viewport:vp, canvasFactory:{
    create:(w,h)=>{const c=createCanvas(w,h);return{canvas:c,context:c.getContext('2d')};},
    reset:(cc,w,h)=>{cc.canvas.width=w;cc.canvas.height=h;},
    destroy:(cc)=>{cc.canvas.width=0;cc.canvas.height=0;}
  }}).promise;
  const out = `${outPrefix}_p${pn}.png`;
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log('wrote', out);
}
