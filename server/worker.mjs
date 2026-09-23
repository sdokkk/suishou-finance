const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const validId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x);
function validDocument(d){
  if(!d||d.version!==1||!d.state||!Array.isArray(d.state.entries)||d.state.entries.length>20000||!Array.isArray(d.deleted)||d.deleted.length>20000)return false;
  if(![d.state.bank,d.state.wechat,d.state.monthSpend,d.state.reserve].every(x=>Number.isFinite(x)&&Math.abs(x)<1e10))return false;
  if(d.debts&&(!Array.isArray(d.debts)||d.debts.length>200||!d.debts.every(x=>x&&typeof x.id==='string'&&typeof x.name==='string'&&Number.isFinite(x.balance)&&Number.isFinite(x.payment))))return false;
  const ids=new Set();
  return d.deleted.every(validId)&&d.state.entries.every(e=>{
    if(!validId(e.id)||ids.has(e.id)||!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||!['income','expense','balance'].includes(e.kind)||!Number.isFinite(e.amount)||e.amount<0||e.amount>1e9)return false;
    if(e.balanceDelta!==undefined&&(!Number.isFinite(e.balanceDelta)||Math.abs(e.balanceDelta)>1e9||e.kind!=='balance'||!['银行卡','微信'].includes(e.account)))return false;
    ids.add(e.id);return ['category','account','note'].every(k=>typeof e[k]==='string'&&e[k].length<=4000)&&(!e.receipts||(Array.isArray(e.receipts)&&e.receipts.length<=5&&e.receipts.every(r=>validId(r.id)&&typeof r.name==='string'&&r.name.length<=500)));
  });
}
export default {async fetch(request,env){
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
  try{
    const owner=request.headers.get('oai-authenticated-user-id');
    if(!owner)return json({error:'请先登录后同步'},401);
    if(request.headers.get('sec-fetch-site')==='cross-site'||(request.headers.get('origin')&&request.headers.get('origin')!==url.origin))return json({error:'请求来源不匹配'},403);
    if(!env.DB||!env.BUCKET)return json({error:'云端存储暂不可用'},503);
    if(url.pathname==='/api/ledger'){
      if(request.method==='GET'){
        const row=await env.DB.prepare('SELECT revision, document, updated_at FROM finance_ledgers WHERE owner = ?').bind(owner).first();
        return json({owner,revision:row?.revision||0,document:row?JSON.parse(row.document):null,updatedAt:row?.updated_at||null});
      }
      if(request.method==='PUT'){
        if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'需要JSON'},415);
        const raw=await request.text();if(raw.length>4000000)return json({error:'账本过大'},413);
        let data;try{data=JSON.parse(raw)}catch{return json({error:'无效数据'},400)}
        if(!Number.isSafeInteger(data.revision)||data.revision<0||!validDocument(data.document))return json({error:'账本格式不正确'},400);
        const date=new Date().toISOString(),body=JSON.stringify(data.document);
        const result=data.revision===0
          ?await env.DB.prepare('INSERT INTO finance_ledgers (owner, revision, document, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT(owner) DO NOTHING').bind(owner,body,date).run()
          :await env.DB.prepare('UPDATE finance_ledgers SET revision = revision + 1, document = ?, updated_at = ? WHERE owner = ? AND revision = ?').bind(body,date,owner,data.revision).run();
        if(!result.meta.changes)return json({error:'账本已有更新，请合并后重试'},409);
        return json({revision:data.revision+1,updatedAt:date});
      }
      return json({error:'不支持此操作'},405);
    }
    const match=url.pathname.match(/^\/api\/receipts\/([a-zA-Z0-9_-]{1,100})$/);
    if(match){
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner));
      const folder=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
      const key=folder+'/'+match[1];
      if(request.method==='PUT'){
        const type=request.headers.get('content-type');if(!['image/jpeg','image/png','image/webp'].includes(type))return json({error:'不支持此图片格式'},415);
        if(Number(request.headers.get('content-length'))>10000000)return json({error:'图片超过10MB'},413);
        const bytes=await request.arrayBuffer();if(bytes.byteLength>10000000)return json({error:'图片超过10MB'},413);
        await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:type}});return json({ok:true});
      }
      if(request.method==='GET'){
        const obj=await env.BUCKET.get(key);if(!obj)return json({error:'截图尚未上传'},404);
        return new Response(obj.body,{headers:{'Content-Type':obj.httpMetadata?.contentType||'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
      }
    }
    return json({error:'未找到'},404);
  }catch(error){console.error('Finance storage error',error?.name);return json({error:'同步暂时失败，本机记录仍保留，请稍后重试'},503)}
}};
