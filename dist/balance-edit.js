(() => {
 const section=document.createElement('section');section.className='card';section.style.marginBottom='18px';
 section.innerHTML='<h3 style="margin-top:0">修正账户余额</h3><p class="sub">填写实际余额，留空的账户保持不变。差额记为对账调整，不计入收入、消费或预算。</p><form id="balanceForm" class="form"><div class="row"><div class="field"><label for="actualBank">银行卡实际余额（元）</label><input id="actualBank" type="number" step="0.01" min="0" max="999999999" inputmode="decimal" placeholder="留空不修改"></div><div class="field"><label for="actualWechat">微信实际余额（元）</label><input id="actualWechat" type="number" step="0.01" min="0" max="999999999" inputmode="decimal" placeholder="留空不修改"></div></div><div class="field"><label for="balanceReason">调整说明（选填）</label><input id="balanceReason" maxlength="200" placeholder="例如：与银行 App 余额核对"></div><p id="balancePreview" class="sub" aria-live="polite"></p><button class="submit" type="submit">保存余额修正</button><p id="balanceFeedback" role="status" class="sub"></p></form>';
 document.querySelector('#profile .settings').before(section);
 const form=document.getElementById('balanceForm'),feedback=document.getElementById('balanceFeedback'),preview=document.getElementById('balancePreview');
 const fields=[['actualBank','bank','银行卡'],['actualWechat','wechat','微信']];
 const cents=n=>Math.round(Number(n)*100);
 function draw(){preview.textContent=fields.filter(([id])=>document.getElementById(id).value!=='').map(([id,key,label])=>{const val=Number(document.getElementById(id).value);return `${label}：${money(state[key])} → ${money(val)}（差额 ${money((cents(val)-cents(state[key]))/100)}）`}).join('；')}
 form.addEventListener('input',draw);
 const oldRender=render;render=function(){oldRender();draw()};
 form.onsubmit=e=>{
  e.preventDefault();if(!form.reportValidity())return;
  const changes=fields.filter(([id])=>document.getElementById(id).value!=='').map(([id,key,account])=>({key,account,value:Number(document.getElementById(id).value)}));
  if(!changes.length){feedback.textContent='请至少填写一个账户的实际余额。';return}
  if(changes.some(c=>!Number.isFinite(c.value)||c.value<0||c.value>999999999)){feedback.textContent='余额必须是有效的非负金额。';return}
  const previous=structuredClone(state),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());let count=0;
  try{for(const {key,account,value} of changes){const delta=(cents(value)-cents(state[key]))/100;if(!delta)continue;
    state.entries.unshift({id:'adjust-'+crypto.randomUUID(),sourceId:'balance-reconciliation',date,kind:'balance',category:'余额修正',account,amount:Math.abs(delta),balanceDelta:delta,note:`余额修正：${money(state[key])} → ${money(value)}`+(document.getElementById('balanceReason').value.trim()?'；'+document.getElementById('balanceReason').value.trim():''),receipts:[]});state[key]=cents(value)/100;count++;
   }
   localStorage.setItem('blank-finance-v1',JSON.stringify(state));form.reset();render();feedback.textContent=count?'余额已修正，正在同步；请以上方同步状态为准。':'余额一致，无需调整。';window.financeCloud?.sync();
  }catch{state=previous;feedback.textContent='保存失败，输入已保留，请检查设备存储后重试。'}
 };
})();
