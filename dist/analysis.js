/* Personal analysis: local ledger calculations and explicitly dated market observations. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const html = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cents = v => Math.round(Number(v || 0)*100);
  const fmt = v => money(v/100);
  const localDate = (d=new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  const shift = (s,n) => new Date(Date.parse(s+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
  const dayCount = (a,b) => Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000)+1;
  const round = v => Math.round(v);
  const ledger = window.financeLedger || [];
  const reference = Object.fromEntries(ledger.map(r=>[r.id,r]));
  const read = (key,fallback) => {try{return JSON.parse(localStorage.getItem(key))||fallback}catch{return fallback}};
  let rangeMode='month', from='',to='',metricMode='recorded',selectedIndex=0;
  let model;

  const panel=document.createElement('section'); panel.id='insights';panel.className='view';
  panel.innerHTML=`
    <div class="insight-header"><div><div class="analysis-kicker">FINANCIAL INSIGHTS</div><h2 class="title">分析与建议</h2><p class="sub" id="analysisAsOf"></p></div><span class="coverage">本机账本</span></div>
    <div class="insight-tabs" role="tablist" aria-label="财务分析"><button role="tab" aria-selected="true" data-insight="trends">收支曲线</button><button role="tab" aria-selected="false" data-insight="habits">消费习惯</button><button role="tab" aria-selected="false" data-insight="optimize">开销优化</button></div>
    <div class="analysis-controls" id="analysisControls"><label>分析区间<select id="analysisRange"><option value="month">最新记账月份</option><option value="7">最近7天（截至最新记录）</option><option value="30">最近30天（截至最新记录）</option><option value="all">从第一笔开始</option><option value="custom">自定义日期</option></select></label><div class="analysis-dates" id="analysisDates" hidden><label>开始<input type="date" id="analysisFrom"></label><label>结束<input type="date" id="analysisTo"></label></div></div>
    <p id="analysisError" class="analysis-error" role="alert"></p>
    <div class="insight-pane" id="insight-trends" role="tabpanel"><div id="analysisMetrics" class="metric-grid"></div>
      <div class="insight-box"><div class="chart-head"><div><h3>每天的钱去了哪里</h3><div class="legend"><span><i style="background:var(--a-line)"></i>收入</span><span><i style="background:var(--b-line)"></i><span id="spendLegend">支出</span></span></div></div><label class="muted">统计口径 <select id="analysisMode" style="padding:7px;background:var(--p2);color:white;border:1px solid var(--line);border-radius:8px"><option value="recorded">已记收支</option><option value="cash">人民币现金流</option></select></label></div>
      <div id="dailyChart"></div><label for="chartDay" class="muted">拖动查看某一天</label><input id="chartDay" class="chart-scrubber" type="range" min="0" max="0" value="0" aria-label="查看某天收支"><div id="chartDetail" class="chart-detail" aria-live="polite"></div><p id="chartNote" class="analysis-note"></p></div>
      <div class="insight-box"><h3>区间累计净变化</h3><p>从区间起点的 0 开始累计，不代表账户余额。</p><div id="netChart"></div></div>
      <details class="insight-box"><summary>查看每天的数字</summary><div id="dailyTable" class="analysis-table-wrap"></div></details>
    </div>
    <div class="insight-pane" id="insight-habits" role="tabpanel" hidden><div id="habitSummary" class="habit-grid"></div><div class="insight-box" style="margin-top:16px"><h3>分类支出</h3><p>按记录中的分类汇总支出。</p><div id="categoryBars"></div></div><div id="habitEvidence"></div></div>
    <div class="insight-pane" id="insight-optimize" role="tabpanel" hidden><div id="optimizationAdvice"></div><div class="insight-box"><h3>试算你的调整方案</h3><p>按所选区间消费估算节省空间；这里只做试算，不会修改原始账目或预算。</p><div class="analysis-form"><label>食品溢价削减 <b id="foodCutLabel">8%</b><input id="foodCut" type="range" min="0" max="20" value="8" step="1"></label><label>其他开销削减 <b id="otherCutLabel">10%</b><input id="otherCut" type="range" min="0" max="50" value="10" step="1"></label><label>增加必要开销（元）<input id="essentialAdd" type="number" min="0" step="1" value="0"></label></div><div id="scenarioResult" class="scenario-result" aria-live="polite"></div></div></div>
`;
  document.querySelector('main').append(panel);
  const nav=document.createElement('button');nav.className='nav';nav.dataset.view='insights';nav.innerHTML='<i>⌁</i>分析';nav.onclick=()=>{renderAll();showView('insights')};document.querySelector('.bottom').insertBefore(nav,document.querySelector('[data-view="profile"]'));

  function entriesModel(entries=state.entries){
    return entries.map(e=>{
      const match=e.sourceId?.match(/^ledger-(\d+)-(expense|income|opening)$/),r=match?reference[match[1]]:null;
      const parts = e.kind==='expense' ? Object.fromEntries(Object.entries(r?.parts||{[e.category]:e.amount}).map(([k,v])=>[k,cents(v)])) : {};
      const isCredit = e.kind==='income' && r && /积分抵扣/.test(r.note);
      const actualIncome=e.kind==='income'&&!isCredit?cents(e.amount):0;
      const cashOut=e.kind==='expense' ? r ? Math.max(0,cents(r.income)-(isPointsRow(r)?cents(r.income):0)-cents(r.netCash)) : e.account==='信用卡'?0:cents(e.amount) : 0;
      return {...e,parts,income:actualIncome,out:e.kind==='expense'?cents(e.amount):0,cashOut,credit:isCredit?cents(e.amount):0};
    });
  }
  function isPointsRow(r){return /积分抵扣/.test(r.note)}
  function limits(){const days=state.entries.map(e=>e.date).filter(Boolean).sort();return {first:days[0]||localDate(),last:days.at(-1)||localDate()}}
  function bounds(){const {first,last}=limits();if(rangeMode==='custom')return {start:el('analysisFrom').value,end:el('analysisTo').value};return {start:rangeMode==='all'?first:rangeMode==='month'?last.slice(0,7)+'-01':shift(last,1-Number(rangeMode)),end:last}}
  function aggregate(start,end,entries=entriesModel()){
    if(!start||!end||start>end||dayCount(start,end)>3700) return null;
    const selected=entries.filter(e=>e.date>=start&&e.date<=end);
    const days=[];for(let d=start;d<=end;d=shift(d,1))days.push({date:d,income:0,out:0,cashOut:0,recorded:false,parts:{}});
    const map=Object.fromEntries(days.map(d=>[d.date,d]));const cats={};
    selected.forEach(e=>{const d=map[e.date];d.recorded=true;d.income+=e.income;d.out+=e.out;d.cashOut+=e.cashOut;for(const [c,n]of Object.entries(e.parts)){cats[c]=(cats[c]||0)+n;d.parts[c]=(d.parts[c]||0)+n}});
    // Internal transfers absent from transaction list are shown only in cash-flow mode.
    ledger.filter(r=>r.date>=start&&r.date<=end&&!r.income&&!r.spend&&r.netCash<0).forEach(r=>{map[r.date].cashOut+=cents(-r.netCash);map[r.date].recorded=true});
    const sum=k=>days.reduce((a,d)=>a+d[k],0);
    return {start,end,days,selected,cats,income:sum('income'),out:sum('out'),cashOut:sum('cashOut'),active:days.filter(d=>d.out>0).length,coverage:days.filter(d=>d.recorded).length,life:sum('out')-(cats['债务']||0)-(cats['投资']||0)};
  }
  function seriesChart(days,series,id){
    const w=Math.max(280,Math.min(800,window.innerWidth-62)),h=240,p={l:56,r:22,t:18,b:36};const values=days.flatMap(d=>series.map(s=>d[s.key]));
    let min=Math.min(0,...values),max=Math.max(0,...values);if(max===min)max=min+100;
    const x=i=>p.l+(w-p.l-p.r)*(days.length===1?.5:i/(days.length-1));const y=v=>p.t+(h-p.t-p.b)*(max-v)/(max-min);
    let s=`<svg class="finance-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${id==='daily'?'每日收入及支出折线图':'区间累计净变化折线图'}"><title>${days[0]?.date||''} 至 ${days.at(-1)?.date||''}</title>`;
    for(let i=0;i<=4;i++){let v=min+(max-min)*i/4,yy=y(v);s+=`<line x1="${p.l}" y1="${yy}" x2="${w-p.r}" y2="${yy}" stroke="#ffffff12"/><text x="${p.l-9}" y="${yy+4}" text-anchor="end">${(v/100).toLocaleString('zh-CN',{maximumFractionDigits:0})}</text>`}
    s+=`<text x="12" y="12">元</text><line x1="${p.l}" y1="${y(0)}" x2="${w-p.r}" y2="${y(0)}" stroke="#8aa5c477" stroke-dasharray="3 4"/>`;
    const indices=[...new Set([0,Math.floor((days.length-1)/2),days.length-1])];indices.forEach(i=>s+=`<text x="${x(i)}" y="${h-9}" text-anchor="middle">${days[i].date.slice(5)}</text>`);
    series.forEach(ser=>{s+=`<polyline points="${days.map((d,i)=>`${x(i)},${y(d[ser.key])}`).join(' ')}" fill="none" stroke="${ser.color}" stroke-width="2.8" stroke-linejoin="round"/>`;days.forEach((d,i)=>s+=`<circle class="chart-point" data-point="${i}" cx="${x(i)}" cy="${y(d[ser.key])}" r="${days.length>100?1.5:3.7}" fill="${ser.color}"><title>${d.date} ${ser.name} ${fmt(d[ser.key])}${d.recorded?'':'（未记录）'}</title></circle>`)});
    return s+'</svg>';
  }
  function renderCharts(){
    if(!model)return;
    if(!model.selected.length){el('analysisMetrics').innerHTML='';el('dailyChart').innerHTML='<p class="empty">暂无收支数据，记账后自动生成曲线。</p>';el('netChart').innerHTML='<p class="empty">暂无累计数据</p>';el('chartDetail').textContent='';el('chartNote').textContent='';el('dailyTable').innerHTML='';el('chartDay').disabled=true;return}el('chartDay').disabled=false;
    const cash=metricMode==='cash',out=cash?model.cashOut:model.out;
    el('analysisMetrics').innerHTML=[['实际收入',model.income,'不含积分抵扣'],[cash?'现金流出':'已记支出',out,cash?'含还款及资产划转':'含还款、非现金消费'],[cash?'现金净变化':'收支差额',model.income-out,'非账户余额']].map(([t,v,sub])=>`<div class="metric"><span>${t}</span><b class="${v<0?'bad':t==='实际收入'?'good':''}">${fmt(v)}</b><small>${sub}</small></div>`).join('');
    let total=0;const data=model.days.map(d=>({...d,value:cash?d.cashOut:d.out,net:(total+=d.income-(cash?d.cashOut:d.out))}));
    el('dailyChart').innerHTML=seriesChart(data,[{key:'income',name:'收入',color:'#57e39b'},{key:'value',name:cash?'现金流出':'支出',color:'#ffb86b'}],'daily');
    el('netChart').innerHTML=seriesChart(data,[{key:'net',name:'累计净变化',color:'#78afff'}],'net');
    el('spendLegend').textContent=cash?'现金流出':'支出';el('chartDay').max=Math.max(0,data.length-1);selectedIndex=Math.min(selectedIndex,data.length-1);el('chartDay').value=selectedIndex;showPoint(selectedIndex);
    el('chartNote').textContent=`${model.start} — ${model.end}，${model.days.length}天中${model.coverage}天有记录。空白日按“已记录金额0”连线，不表示实际没有花钱。${cash?'信用卡消费不直接扣减现金；余额修正不计入收支。漏记账目会影响结果。':'按已记录的收入和支出计算；余额修正不计入收支。'}`;
    el('dailyTable').innerHTML=`<table class="analysis-table"><thead><tr><th>日期</th><th>收入</th><th>${cash?'流出':'支出'}</th><th>当日净额</th><th>记录</th></tr></thead><tbody>${data.map(d=>`<tr><td>${d.date}</td><td>${fmt(d.income)}</td><td>${fmt(d.value)}</td><td>${fmt(d.income-d.value)}</td><td>${d.recorded?'有':'未记录'}</td></tr>`).join('')}</tbody></table>`;
    panel.querySelectorAll('[data-point]').forEach(p=>p.addEventListener('click',()=>{selectedIndex=Number(p.dataset.point);el('chartDay').value=selectedIndex;showPoint(selectedIndex)}));
  }
  function showPoint(i){if(!model)return;const d=model.days[i];if(!d)return;const out=metricMode==='cash'?d.cashOut:d.out;el('chartDetail').textContent=`${d.date} · 收入 ${fmt(d.income)} · ${metricMode==='cash'?'流出':'支出'} ${fmt(out)} · 净额 ${fmt(d.income-out)}${d.recorded?'':' · 当天未记录'}`}
  function renderHabits(){if(!model.selected.length){el("habitSummary").innerHTML="<p class=empty>暂无消费记录</p>";el("categoryBars").innerHTML="";el("habitEvidence").innerHTML="";return}
    const peak=[...model.days].sort((a,b)=>b.out-a.out)[0];const ranked=Object.entries(model.cats).sort((a,b)=>b[1]-a[1]);const top=ranked[0];
    const cards=[['有支出的日子',`${model.active} / ${model.days.length}天`,'按记账天数，不代表购买订单数量。'],['每个支出日的日常消费',fmt(model.active?model.life/model.active:0),'剔除债务与投资；不是全月预测。'],['最高支出日',fmt(peak.out),`${peak.date}，其中还款 ${fmt(peak.parts['债务']||0)}。`],['最大支出分类',top?html(top[0]):'暂无',top?`${fmt(top[1])}，占已记支出 ${(100*top[1]/model.out).toFixed(1)}%。`:'这个区间还没有消费。']];
    el('habitSummary').innerHTML=cards.map(([t,v,n])=>`<div class="insight-box"><p>${t}</p><div class="habit-value">${v}</div><p>${n}</p></div>`).join('');
    el('categoryBars').innerHTML=ranked.length?ranked.map(([c,v])=>`<div class="category-row"><span>${html(c)}</span><div class="category-track"><b style="width:${Math.max(1,v/(ranked[0][1]||1)*100)}%"></b></div><strong>${fmt(v)}</strong></div>`).join(''):'<p>这个区间没有支出。</p>';
    const cut=model.selected.filter(e=>e.kind==='expense'&&/果切|鲜切|蜜瓜|甜瓜/.test(e.note));
    const mixed=model.selected.filter(e=>e.kind==='expense'&&Object.keys(e.parts).length>1);
    el('habitEvidence').innerHTML=`<div class="insight-box" style="margin-top:16px"><h3>从明细看到的习惯</h3><p>有 ${cut.length} 条记录提到果切或瓜类。部分是合并订单，不能把整单金额都当成果切支出。</p><p>${mixed.length} 条混合记录已按食品、宠物、日用品等拆分。还款 ${fmt(model.cats['债务']||0)} 不用于判断生活消费是否浪费。</p><p>工资与其他现金收入分开识别，零星微信收入不当作稳定月收入。</p><details><summary>查看果切相关记录</summary>${cut.length?cut.map(e=>`<p>${e.date} · ${html(e.note)}</p>`).join(''):'<p>该区间未检出相关说明。</p>'}</details></div>`;
  }
  function renderOptimization(){if(!model.selected.length){el("optimizationAdvice").innerHTML="<p class=empty>记账后，这里会根据实际消费生成优化建议。</p>";renderScenario();return}
    const food=model.cats['食品']||0,other=model.cats['其他']||0,pet=model.cats['宠物']||0,supplies=model.cats['日用品']||0;
    const suggestion=(tag,title,amount,body,keep=false)=>`<article class="insight-box suggestion ${keep?'keep':''}"><span class="tag">${tag}</span><div class="advice-head"><h3>${title}</h3>${amount?`<b>${amount}</b>`:''}</div><p>${body}</p></article>`;
    el('optimizationAdvice').innerHTML=
      suggestion('减少溢价','果切换整果，合并零散采购',food?`目标省 ${fmt(round(food*.08))}`:'',`区间食品 ${fmt(food)}。先尝试用整果、现有主食与备餐替代部分即食溢价；以食品金额的8%做节省目标，属于试算，不是已验证节省。饮用水和正常三餐继续保留。`)+
      suggestion('先查库存','日用品与宠物：补缺，不重复囤货','',`日用品 ${fmt(supplies)}，宠物 ${fmt(pet)}。纸巾可能一次覆盖多月，不能按单次大额判定浪费。先暂停未用完用品的重复购买和非必要宠物零食，保留狗粮、清洁及医疗需要。`)+
      suggestion('按使用价值','保留在用工具，复核低频订阅','',`区间订阅入账 ${fmt(model.cats['订阅']||0)}。季度或年度付款需结合服务期评估；订阅若长期未使用，可考虑到期暂停。`)+
      suggestion('增加必要份额','把省下的钱优先补到正常饮食','同额调配优先','如果家里缺蔬菜、蛋白质或必需用品，可从零食和即食溢价中调出预算。账单不足以证明营养缺乏，因此不自动增加食品总预算；确有需要可在下方填入增加额。',true)+
      suggestion('保留履约开销','房屋水电、通讯和到期还款照常保障','',`区间物业水电 ${fmt(model.cats['物业水电']||0)}、话费 ${fmt(model.cats['话费']||0)}、债务还款 ${fmt(model.cats['债务']||0)}。先保障必要服务，再处理可选开销；其他类 ${fmt(other)} 中也可能有开锁等必要费用，需逐笔确认。`,true);
    renderScenario();
  }
  function renderScenario(){if(!model)return;const f=Number(el('foodCut').value),o=Number(el('otherCut').value),add=Number(el('essentialAdd').value);el('foodCutLabel').textContent=f+'%';el('otherCutLabel').textContent=o+'%';if(!Number.isFinite(add)||add<0){el('scenarioResult').textContent='增加金额必须为0或正数。';return}const food=round((model.cats['食品']||0)*f/100),other=round((model.cats['其他']||0)*o/100),net=food+other-cents(add);el('scenarioResult').innerHTML=`<span class="muted">按这个区间的金额 · 净节省目标</span><strong class="${net<0?'bad':''}">${fmt(net)}</strong><p>食品 ${fmt(food)} + 其他 ${fmt(other)} − 增加必要开销 ${money(add)}。只减少已经确认可替代的部分；不叠加另一笔“取消订阅”节省。</p>`}

  function renderAll(){const b=bounds();model=aggregate(b.start,b.end);el('analysisAsOf').textContent=state.entries.length?`账本 ${limits().first} — ${limits().last} · 新记账后自动重算`:'暂无记录 · 记账后自动分析';el('analysisError').textContent=model?'':'请选择有效的起止日期（最长10年）。';if(!model){['dailyChart','netChart','analysisMetrics','habitSummary','categoryBars','habitEvidence','optimizationAdvice','dailyTable'].forEach(id=>el(id).innerHTML='');return}selectedIndex=model.days.length-1;renderCharts();renderHabits();renderOptimization();}

  el('analysisFrom').value=limits().first;el('analysisTo').value=limits().last;
  panel.querySelectorAll('[data-insight]').forEach(b=>{b.setAttribute('aria-controls','insight-'+b.dataset.insight);b.onclick=()=>{panel.querySelectorAll('[data-insight]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));panel.querySelectorAll('.insight-pane').forEach(x=>x.hidden=x.id!=='insight-'+b.dataset.insight);;window.scrollTo({top:panel.offsetTop,behavior:'instant'})}});
  el('analysisRange').onchange=e=>{rangeMode=e.target.value;el('analysisDates').hidden=rangeMode!=='custom';renderAll()};el('analysisFrom').onchange=el('analysisTo').onchange=renderAll;
  el('analysisMode').onchange=e=>{metricMode=e.target.value;renderCharts()};el('chartDay').oninput=e=>{selectedIndex=Number(e.target.value);showPoint(selectedIndex)};
  ['foodCut','otherCut','essentialAdd'].forEach(id=>el(id).oninput=renderScenario);
  const previousRender=render;render=function(){previousRender();renderAll()};
  // Keep the original transaction export, including the optional scenario settings.
  const previousExport=exportData;exportData=async function(){try{const attachments=window.receiptBackup?await window.receiptBackup():[];const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({...state,debts,attachments},null,2)],{type:'application/json'}));a.download='随手账本完整备份.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}catch{flash('备份失败，请检查截图与存储空间后重试')}};
  window.financeAnalysis={entriesModel,aggregate,renderAll,getModel:()=>model};
  renderAll();
})();
