/* Private cloud ledger. Revision compare-and-swap and three-way merging prevent lost writes. */
(() => {
 'use strict';
 const KEY='blank-cloud-v1',STATE='blank-finance-v1',settingKeys=[];
 const copy=x=>structuredClone(x),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),round=x=>Math.round(x*100)/100;
 const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k))??f}catch{return f}};
 let metadata=read(KEY,{owner:null,base:null}),working=false,applying=false,timer;
 if(!localStorage.getItem('blank-before-cloud-v1'))localStorage.setItem('blank-before-cloud-v1',JSON.stringify({savedAt:new Date().toISOString(),state}));
 const panel=document.createElement('div');panel.className='cloud-status';panel.innerHTML='<div><b>云端同步</b><p id="cloudStatus" role="status" aria-live="polite">正在连接私有账本…</p><a id="cloudLogin" href="/signin-with-chatgpt?return_to=%2F" target="_top" hidden>登录后同步</a></div><button type="button" id="cloudRetry">立即同步</button>';
 document.querySelector('.top').after(panel);
 document.querySelector('#profile .sub').textContent='账目和截图同步到私有云端；离线记录在联网后补传。同一账号可在多台设备查看。';
 document.querySelector('#insights .coverage').textContent='云端账本';
 const reset=document.querySelector('#profile .danger');reset.textContent='检查云端更新';reset.className='setting';reset.onclick=()=>sync();
 function message(s){document.getElementById('cloudStatus').textContent=s}
 function snapshot(){return {version:1,state:copy(state),debts:copy(debts),deleted:metadata.base?.deleted||[],settings:Object.fromEntries(settingKeys.map(k=>[k,read(k,null)]))}}
 function delta(e,account){if(e?.account===account&&e.kind==='balance'&&Number.isFinite(e.balanceDelta))return e.balanceDelta;return e&&e.account===account&&['income','expense'].includes(e.kind)?(e.kind==='income'?e.amount:-e.amount):0}
 function spent(e){return e?.kind==='expense'&&e.date.startsWith(thisMonth())?e.amount:0}
 function merge(base,local,remote){
  if(!remote)return copy(local);
  base=base||{version:1,state:copy(seed),debts:copy(debts),deleted:[],settings:{}};
  const b=new Map(base.state.entries.map(e=>[e.id,e])),l=new Map(local.state.entries.map(e=>[e.id,e])),r=new Map(remote.state.entries.map(e=>[e.id,e]));
  const result=copy(remote),deleted=new Set(remote.deleted||[]);
  for(const id of new Set([...b.keys(),...l.keys()])){
   const before=b.get(id),after=l.get(id),theirs=r.get(id);
   if(same(before,after))continue;
   if(deleted.has(id)){if(after&&!before)throw Error('这笔记录已在另一设备删除，请核对后重新记账');continue}
   if(same(theirs,after))continue;
   if(before&&theirs&&!same(before,theirs))throw Error('同一笔记录在两台设备被修改，已保留本机数据，请先导出备份核对');
   if(!before&&theirs)throw Error('记录编号冲突，已保留本机数据，请导出备份核对');
   for(const [field,account] of [['bank','银行卡'],['wechat','微信']])result.state[field]=round(result.state[field]+delta(after,account)-delta(theirs,account));
   result.state.monthSpend=round(result.state.monthSpend+spent(after)-spent(theirs));
   if(after)r.set(id,copy(after));else{r.delete(id);deleted.add(id)}
  }
  // Reserve and planning changes are independent from transaction additions.
  if(local.state.reserve!==base.state.reserve)result.state.reserve=local.state.reserve;
  if(!same(local.debts,base.debts)){if(remote.debts&&!same(remote.debts,base.debts)&&!same(remote.debts,local.debts))throw Error('债务明细存在不同修改，请先导出备份核对');result.debts=copy(local.debts)}
  result.settings??={};for(const key of settingKeys)if(!same(local.settings?.[key],base.settings?.[key]))result.settings[key]=local.settings?.[key]??null;
  result.state.entries=[...r.values()].sort((a,b)=>b.date.localeCompare(a.date)||String(a.id).localeCompare(String(b.id)));
  result.deleted=[...deleted];return result;
 }
 async function api(path,options={}){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);
  try{const response=await fetch(path,{...options,cache:'no-store',credentials:'same-origin',signal:controller.signal});
   if(response.status===401){document.getElementById('cloudLogin').hidden=false;throw Error('请登录同一账号后同步，本机记录已保留')}
   if(response.status===409)return {conflict:true};
   if(!response.ok)throw Error('云端暂不可用，本机记录已保留，联网后将重试');
   return response;
  }finally{clearTimeout(timeout)}
 }
 async function uploadReceipts(doc,remote){
  const known=new Set((remote?.state.entries||[]).flatMap(e=>(e.receipts||[]).map(r=>r.id)));
  for(const entry of doc.state.entries)for(const ref of entry.receipts||[]){if(known.has(ref.id))continue;
   message('正在同步账单截图…');const file=await window.financeReceipts.local(ref.id);
   if(!file)throw Error('有截图在本机缺失，尚未完成同步；请保留并导出原设备备份');
   await api('/api/receipts/'+encodeURIComponent(ref.id),{method:'PUT',headers:{'Content-Type':file.blob.type},body:file.blob});known.add(ref.id);
  }
 }
 function adopt(doc){
  applying=true;try{state=copy(doc.state);if(Array.isArray(doc.debts))debts.splice(0,debts.length,...copy(doc.debts));localStorage.setItem(STATE,JSON.stringify(state));for(const key of settingKeys){const v=doc.settings?.[key];if(v==null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(v))}window.financeAnalysis?.reloadPreferences?.();render()}finally{applying=false}
 }
 let runningPromise=null;
 function sync(){if(runningPromise)return runningPromise;runningPromise=performSync().finally(()=>{runningPromise=null});return runningPromise}
 async function performSync(){
  if(working)return;if(!navigator.onLine){message('离线中 · 记录暂存本机，联网后自动同步');return}
  working=true;document.getElementById('cloudRetry').disabled=true;
  let needsAnother=false;
  try{
   message('正在同步…');
   for(let attempt=0;attempt<4;attempt++){
    const response=await api('/api/ledger'),cloud=await response.json();
    if(metadata.owner&&metadata.owner!==cloud.owner)throw Error('登录账号与本机账本不同，已暂停同步以保护数据。请切回原账号');
    const captured=snapshot(),next=merge(metadata.base,captured,cloud.document);
    await uploadReceipts(next,cloud.document);
    let updatedAt=cloud.updatedAt;
    if(!same(next,cloud.document)){
     const saved=await api('/api/ledger',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:cloud.revision,document:next})});
     if(saved.conflict)continue;updatedAt=(await saved.json()).updatedAt;
    }
    const current=snapshot(),rebased=merge(captured,current,next);
    metadata={owner:cloud.owner,base:next,updatedAt};localStorage.setItem(KEY,JSON.stringify(metadata));adopt(rebased);
    document.getElementById('cloudLogin').hidden=true;needsAnother=!same(rebased,next);
    message(needsAnother?'新增记录待同步…':'已同步 · '+new Date(updatedAt||Date.now()).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+' · '+state.entries.length+'条');
    return;
   }
   throw Error('其他设备正在更新，稍后自动重试；本机记录已保留');
  }catch(error){message(error.name==='AbortError'?'连接超时 · 本机记录已保留，将自动重试':error.message||'同步失败，本机记录已保留')}
  finally{working=false;document.getElementById('cloudRetry').disabled=false;if(needsAnother)schedule()}
 }
 function schedule(){if(applying)return;clearTimeout(timer);timer=setTimeout(sync,700)}
 const oldRender=render;render=function(){oldRender();schedule()};
 document.getElementById('cloudRetry').onclick=sync;
 document.getElementById('planningForm')?.addEventListener('submit',schedule);
 document.getElementById('marketForm')?.addEventListener('submit',schedule);
 window.addEventListener('online',sync);window.addEventListener('offline',()=>message('离线中 · 记录暂存本机，联网后自动同步'));
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync()});
 // Avoid stale in-memory state in two tabs of the same browser.
 window.addEventListener('storage',event=>{if(event.key===STATE&&!working){state=read(STATE,state);metadata=read(KEY,metadata);applying=true;try{render()}finally{applying=false}schedule()}});
 setInterval(()=>{if(!document.hidden)sync()},30000);
 window.financeCloud={sync,merge,getDocument:snapshot};sync();
})();
