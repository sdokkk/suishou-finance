(function(root){
  function parseReceipt(text){
    const lines=String(text).replace(/[：]/g,':').replace(/[．]/g,'.').split(/\r?\n/).map(l=>l.replace(/\s+/g,'').trim()).filter(Boolean),joined=lines.join('\n');
    let amount=null,amountLabel='',date=null;
    const priorities=[/实际支付|实付金额|实付款|实际付款|实付/,/支付金额|交易金额|付款金额|扣款金额/,/支出金额|转账金额|收款金额|到账金额/];
    for(const labels of priorities){
      const candidates=[];
      lines.forEach((line,i)=>{const hit=line.match(labels);if(!hit)return;const tail=line.slice(hit.index+hit[0].length);const chunks=[tail,...lines.slice(i+1,i+3)];for(const chunk of chunks){if(/优惠|折扣|订单号|交易号|时间|配送费|包装费/.test(chunk))continue;const m=chunk.match(/^[^\d\n]{0,8}([\d,]+(?:\.\d{1,2})?)(?:元|人民币|RMB|CNY)?$/);if(m){const value=Number(m[1].replace(/,/g,''));if(value>0&&value<1000000&&!/\$|USD|USDT|日元|JPY|港元|HKD/i.test(chunk)){candidates.push({value,label:hit[0]});break}}}});
      const unique=[...new Set(candidates.map(c=>c.value))];if(unique.length===1){amount=unique[0];amountLabel=candidates[0].label;break}if(unique.length>1)return {amount:null,date:null,category:'其他',note:'截图中有多个实付金额，请分笔保存',warning:'检测到多个不同的实付金额，未自动选择。',text};
    }
    const datePattern=/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?/;
    for(const label of ['付款时间','支付时间','交易时间','出场时间']){const i=lines.findIndex(l=>l.includes(label));if(i<0)continue;const m=lines.slice(i,i+3).join(' ').match(datePattern);if(m){date=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;break}}
    if(!date){const m=joined.match(datePattern);if(m)date=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`}
    if(date&&(!Number.isFinite(Date.parse(date))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date))date=null;
    const groups=[['宠物',/宠物|狗粮|犬用|拾便|尿垫|猫粮/],['日用品',/纸巾|抽纸|洗手液|洗发|牙膏|沐浴|湿巾/],['食品',/玉米|鸡|牛肉|猪|包子|小笼包|小笼|水果|果切|火龙果|蜜柚|蜜瓜|甜瓜|燕麦|饮用水|矿泉水|米饭|面条|面袋|三明治|鸡蛋|花生|扇贝|叉烧|黄瓜|沙拉|雪饼|粽/],['订阅',/GitHub|ChatGPT|Gemini|订阅|会员|机场/i],['话费',/话费|流量充值/],['物业水电',/物业费|电费|水费|燃气费/],['交通',/充电|单车|打车|出租车/]];
    const matches=groups.filter(([,re])=>re.test(joined));const category=matches.length===1?matches[0][0]:matches.length>1?'混合支出':'其他';
    const skip=/订单|出场|付款|支付|交易|收货|发票|商品总数|商品金额|优惠|折扣|配送|包装|合计|总价|打包|申请|退货|客服|调查|展开|查看|领券|再次购买|二维码|银行|已完成|已送达|免费|承诺|缺货|电话|隐私|退款|保障/;
    const names=lines.filter(l=>/[\u4e00-\u9fff]/.test(l)&&groups.some(([,re])=>re.test(l))&&!skip.test(l)&&l.length<90).slice(0,5);
    let account=null;if(/零钱|微信余额/.test(joined))account='微信';else if(/信用卡/.test(joined))account='信用卡';else if(/储蓄卡|借记卡|银行卡/.test(joined))account='银行卡';
    const order=joined.match(/订单(?:编号|号)[:：]?([0-9]{10,30})/);
    return {amount,amountLabel,date,category,account,orderId:order?.[1]||null,note:names.join('、')||'截图账单',warning:account?'':'截图未明确实际扣款账户，请核对账户选择。',text};
  }
  root.parseFinanceReceipt=parseReceipt;
  let workerPromise;
  root.recognizeFinanceReceipt=async function(blob,progress){
    if(!workerPromise)workerPromise=(async()=>{if(!root.Tesseract)await new Promise((ok,no)=>{const s=document.createElement('script');s.src='/ocr/tesseract.min.js';s.onload=ok;s.onerror=()=>no(Error('识别组件下载失败，请检查网络后重试'));document.head.append(s)});return root.Tesseract.createWorker(['chi_sim','eng'],1,{workerPath:'/ocr/worker.min.js',corePath:'/ocr/core',langPath:'/ocr/lang',workerBlobURL:false,logger:m=>{if(root.receiptOcrProgress)root.receiptOcrProgress(m.status==='recognizing text'?`识别中 ${Math.round(m.progress*100)}%`:'首次加载识别组件…')}})})();
    root.receiptOcrProgress=progress;
    let timer;
    try{return await Promise.race([(async()=>{const worker=await workerPromise;await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});const result=await worker.recognize(blob);return {...parseReceipt(result.data.text),confidence:result.data.confidence}})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('识别超时，请重试或裁剪截图')),90000)})])}catch(e){workerPromise?.then(w=>w.terminate()).catch(()=>{});workerPromise=null;throw e}finally{clearTimeout(timer);root.receiptOcrProgress=null}
  };
})(typeof window!=='undefined'?window:globalThis);
