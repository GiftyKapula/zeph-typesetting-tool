import fs from 'fs';
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(process.argv[2]))}).promise;
for(const pn of [1,2,3,4]){ const p=await doc.getPage(pn); const v=p.getViewport({scale:1}); console.log('p'+pn, v.width.toFixed(0)+'x'+v.height.toFixed(0), v.width>v.height?'LANDSCAPE':'PORTRAIT'); }
