import fs from 'node:fs/promises';
await fs.rm('dist/client',{recursive:true,force:true});
await fs.mkdir('dist/client',{recursive:true});
for(const entry of await fs.readdir('dist')){
 if(['client','server','.openai'].includes(entry))continue;
 await fs.cp('dist/'+entry,'dist/client/'+entry,{recursive:true});
}
await fs.mkdir('dist/server',{recursive:true});
await fs.copyFile('server/worker.mjs','dist/server/index.js');
await fs.mkdir('dist/.openai',{recursive:true});
await fs.copyFile('.openai/hosting.json','dist/.openai/hosting.json');
