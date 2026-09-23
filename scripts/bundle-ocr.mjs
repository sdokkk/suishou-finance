import fs from 'node:fs';
import path from 'node:path';
const modules=process.argv[2];if(!modules)throw Error('Pass installed OCR node_modules');
const dest='dist/ocr';fs.mkdirSync(dest+'/core',{recursive:true});fs.mkdirSync(dest+'/lang',{recursive:true});
for(const name of ['tesseract.min.js','worker.min.js','tesseract.min.js.LICENSE.txt','worker.min.js.LICENSE.txt'])fs.copyFileSync(path.join(modules,'tesseract.js/dist',name),dest+'/'+name);
for(const name of fs.readdirSync(path.join(modules,'tesseract.js-core')).filter(n=>n.endsWith('.wasm.js')))fs.copyFileSync(path.join(modules,'tesseract.js-core',name),dest+'/core/'+name);
fs.copyFileSync(path.join(modules,'tesseract.js-core/LICENSE'),dest+'/core/LICENSE');
for(const lang of ['chi_sim','eng'])fs.copyFileSync(path.join(modules,'@tesseract.js-data',lang,'4.0.0_best_int',lang+'.traineddata.gz'),dest+'/lang/'+lang+'.traineddata.gz');
console.log('Bundled local Chinese/English OCR assets');
