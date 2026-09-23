const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');const {chromium}=require('playwright');
(async()=>{
 const worker=(await import('../server/worker.mjs')).default;
 const db=new DatabaseSync(':memory:');for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')))db.exec(fs.readFileSync('drizzle/'+f,'utf8'));
 const bucket=new Map();
 const env={
  DB:{prepare(sql){return {bind(...args){return {
   async first(){return db.prepare(sql).get(...args)||null},
   async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}}
  }}}}},
  BUCKET:{async put(key,bytes,options){bucket.set(key,{bytes,httpMetadata:options.httpMetadata})},async get(key){const r=bucket.get(key);return r?{body:r.bytes,httpMetadata:r.httpMetadata}:null}}
 };

 const call=(url,init={},user='owner-a')=>worker.fetch(new Request('http://localhost'+url,{...init,headers:{...(user?{'oai-authenticated-user-id':user}:{}),...init.headers}}),env);
 assert.equal((await call('/api/ledger',{},null)).status,401);
 assert.equal((await call('/api/ledger',{headers:{Origin:'https://evil.example'}})).status,403);
 const root=path.resolve('dist');
 const server=http.createServer(async(req,res)=>{try{if(req.url.startsWith('/api/')){const chunks=[];for await(const chunk of req)chunks.push(chunk);const headers={...req.headers,'oai-authenticated-user-id':'owner-a'};const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return}const p=path.join(root,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);if(!p.startsWith(root)||!fs.existsSync(p)){res.writeHead(404);res.end();return}res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':p.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(p))}catch(e){res.writeHead(500);res.end(String(e))}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
 const binary=(await import(process.env.CHROMIUM_PACKAGE+'/build/index.js')).default;browser=await chromium.launch({headless:true,executablePath:await binary.executablePath(),args:binary.args.filter(a=>a!=="--single-process")});
 const contexts=await Promise.all([browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'})]);
 const pages=await Promise.all(contexts.map(c=>c.newPage())),url='http://127.0.0.1:'+server.address().port,errors=[];pages.forEach(p=>p.on('pageerror',e=>errors.push(e.message)));
 const [a,b]=pages;await a.goto(url);await a.waitForFunction(()=>document.getElementById('cloudStatus').textContent.startsWith('已同步'));
 const initial=await a.evaluate(()=>({n:state.entries.length,bank:state.bank,wechat:state.wechat}));assert.deepEqual(initial,{n:0,bank:0,wechat:0});assert.equal(await a.evaluate(()=>debts.length),0);
 await b.goto(url);await b.waitForFunction(()=>document.getElementById('cloudStatus').textContent.startsWith('已同步'));assert.equal(await b.evaluate(()=>state.entries.length),initial.n);
 // Two offline devices independently add records then race on the same revision.
 await Promise.all(contexts.map(c=>c.setOffline(true)));
 async function add(p,amount,note){await p.evaluate(()=>openRecord('expense'));await p.fill('#moneyInput',String(amount));await p.fill('#note',note);await p.locator('#entryForm .submit').click();await p.waitForFunction(n=>state.entries.some(e=>e.note===n),note)}
 await add(a,12.34,'device A');await add(b,5.67,'device B');
 await Promise.all(contexts.map(c=>c.setOffline(false)));await Promise.all(pages.map(p=>p.evaluate(()=>financeCloud.sync())));
 for(let i=0;i<2;i++)await Promise.all(pages.map(p=>p.evaluate(()=>financeCloud.sync())));
 for(const p of pages){const v=await p.evaluate(()=>({bank:state.bank,entries:state.entries}));assert.equal(v.entries.length,initial.n+2);assert.equal(Math.round(v.bank*100),Math.round(initial.bank*100)-1801)}
 // Retry same upload / fetch never recharges a balance.
 await a.evaluate(()=>financeCloud.sync());assert.equal(Math.round(await a.evaluate(()=>state.bank*100)),Math.round(initial.bank*100)-1801);
 // Delete propagates and an offline stale device must not resurrect it.
 await contexts[1].setOffline(true);a.once('dialog',d=>d.accept());await a.evaluate(()=>removeEntry(state.entries.find(e=>e.note==='device A').id));await a.evaluate(()=>financeCloud.sync());await contexts[1].setOffline(false);await b.evaluate(()=>financeCloud.sync());assert.equal(await b.evaluate(()=>state.entries.some(e=>e.note==='device A')),false);
 assert.equal(Math.round(await b.evaluate(()=>state.bank*100)),Math.round(initial.bank*100)-567);
 // Screenshot uploaded before document, downloaded on the second device.
 await a.evaluate(async()=>{const id='receipt-cloud-test',db=await new Promise((ok,no)=>{const r=indexedDB.open('blank-finance-receipts',1);r.onupgradeneeded=()=>r.result.createObjectStore('images',{keyPath:'id'});r.onsuccess=()=>ok(r.result);r.onerror=no});await new Promise((ok,no)=>{const t=db.transaction('images','readwrite');t.objectStore('images').put({id,name:'test.jpg',blob:new Blob(['sample'],{type:'image/jpeg'})});t.oncomplete=ok;t.onerror=no});db.close();state.entries.unshift({id:'local-cloud-image',date:'2026-09-23',kind:'expense',amount:1,account:'微信',category:'食品',note:'云端截图验证',receipts:[{id,name:'test.jpg'}]});state.wechat-=1;state.monthSpend+=1;save();await financeCloud.sync()});
 await a.waitForFunction(()=>document.getElementById('cloudStatus').textContent.startsWith('已同步'));await b.evaluate(()=>financeCloud.sync());assert.equal(await b.evaluate(async()=>!!(await financeReceipts.get('receipt-cloud-test'))?.blob),true);assert.equal(bucket.size,1);
 assert.equal((await call('/api/receipts/receipt-cloud-test',{},'owner-b')).status,404);
 assert.equal((await (await call('/api/ledger',{},'owner-b')).json()).document,null);
 // Balance corrections sync without becoming income or expenses.
 assert.equal(await a.locator('[data-insight="invest"]').count(),0);
 const stats=await a.evaluate(()=>({spend:state.monthSpend,out:financeAnalysis.aggregate('2026-08-12','2026-12-31').out}));
 await a.locator('.nav[data-view="profile"]').click();
 await a.fill('#actualBank','1234.56');await a.fill('#actualWechat','0');
 await a.locator('#balanceForm .submit').click();await a.evaluate(()=>financeCloud.sync());await a.evaluate(()=>financeCloud.sync());await b.evaluate(()=>financeCloud.sync());
 for(const p of pages){const v=await p.evaluate(()=>({bank:state.bank,wechat:state.wechat,spend:state.monthSpend,out:financeAnalysis.aggregate('2026-08-12','2026-12-31').out,adjust:state.entries.filter(e=>e.balanceDelta!==undefined).length}));assert.equal(v.bank,1234.56);assert.equal(v.wechat,0);assert.equal(v.spend,stats.spend);assert.equal(v.out,stats.out);assert.equal(v.adjust,2)}
 await a.fill('#actualBank','1234.56');await a.locator('#balanceForm .submit').click();assert.equal(await a.evaluate(()=>state.entries.filter(e=>e.balanceDelta!==undefined).length),2);
 // CAS rejects stale writes; invalid state can't corrupt stored ledger.
 const current=await (await call('/api/ledger')).json();assert.equal((await call('/api/ledger',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:current.revision-1,document:current.document})})).status,409);
 assert.equal((await call('/api/ledger',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:current.revision,document:{}})})).status,400);
 assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['private authentication','cross-origin rejection','first migration','second device','offline additions','concurrent CAS merge','idempotent retries','deletion tombstones','cross-device screenshot','owner isolation','invalid document rejection','mobile width'],records:current.document.state.entries.length}));
 }finally{await browser?.close();server.close();db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
