// بوابة Ministry of Interior — سيرفر مستقل بدون أي مكتبات خارجية (Node 18+)
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000, ADMIN_CODE=(process.env.ADMIN_CODE||'').trim().toUpperCase();
if(!ADMIN_CODE&&!process.env.ADMIN_HASH){console.error('حدد رمز المدير: ADMIN_CODE=xxxx node server.js');process.exit(1)}
const SEC=['LSPD','Sheriff','SWAT'],ST=['جديد','قيد التحقيق','محال للنيابة','مغلق'],PRI=['عادية','متوسطة','عاجلة'];
const RK=['Cadet','Officer I','Officer II','Officer III','Senior Lead Officer','Sergeant I','Sergeant II','Lieutenant','Captain','Commander','Deputy Chief','Assistant Chief','Chief of Police'];
const PERMS={addCase:1,setCase:2,delCase:5,viewPeople:5,addPerson:7,setPerson:7,delPerson:8};
const FILE=process.env.DATA_FILE||path.join(__dirname,'data.json');
let DB={accounts:{},cases:{},perms:{}};
try{DB=Object.assign(DB,JSON.parse(fs.readFileSync(FILE,'utf8')))}catch{}
const save=()=>{fs.writeFileSync(FILE+'.tmp',JSON.stringify(DB));fs.renameSync(FILE+'.tmp',FILE)};
const hp=(c,s)=>crypto.scryptSync(c,s,32).toString('hex');
const mkAcc=c=>{const salt=crypto.randomBytes(8).toString('hex');return{salt,hash:hp(c,salt)}};
const eq=(a,b)=>{a=Buffer.from(a);b=Buffer.from(b);return a.length===b.length&&crypto.timingSafeEqual(a,b)};
const ADMIN=process.env.ADMIN_HASH?{salt:process.env.ADMIN_SALT,hash:process.env.ADMIN_HASH}:mkAcc(ADMIN_CODE);
const adminObj={id:'ADMIN',name:'مدير النظام',rank:'Chief of Police',sector:'LSPD',admin:true,active:true};
const genCode=()=>[...crypto.randomBytes(8)].map(x=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x%32]).join('');
const ri=r=>RK.indexOf(r),minOf=k=>Number.isInteger(DB.perms[k])?DB.perms[k]:PERMS[k];
const can=(u,k)=>u.admin||ri(u.rank)>=minOf(k);
const mgr=(u,a)=>a&&!a.pending&&(u.admin||(a.id!==u.id&&ri(a.rank)<ri(u.rank)));
const pub=a=>({id:a.id,name:a.name,rank:a.rank,sector:a.sector,active:a.active!==false,date:a.date});
const S=new Map(),TRY=new Map();
const str=(v,n)=>String(v??'').trim().slice(0,n);
const badgeOf=v=>str(v,20).toUpperCase().replace(/[^A-Z0-9]/g,'');
function user(req){
 const m=/(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie||'');const s=m&&S.get(m[1]);
 if(!s||s.exp<Date.now())return null;
 if(s.id==='ADMIN')return adminObj;
 const a=DB.accounts[s.id];return a&&!a.pending&&a.active!==false?a:null;
}
const ok=(r,d={})=>[200,d],bad=(m,c=400)=>[c,{error:m}];
const H={
 login(req,b){
  const ip=(process.env.TRUST_PROXY?(req.headers['x-forwarded-for']||'').split(',')[0].trim():'')||req.socket.remoteAddress;
  const t=TRY.get(ip)||{n:0,until:0};
  if(t.until>Date.now())return bad('محاولات كثيرة، حاول بعد دقيقة',429);
  const id=badgeOf(b.badge),code=str(b.code,64).toUpperCase();let good=false,a;
  if(id==='ADMIN')good=eq(hp(code,ADMIN.salt),ADMIN.hash);
  else{a=DB.accounts[id];if(a){const h=hp(code,a.salt);if(eq(h,a.hash)){if(a.pending)return bad('حسابك بانتظار موافقة المدير',403);good=a.active!==false}}else hp(code,'x')}
  if(!good){t.n++;if(t.n>=5){t.until=Date.now()+60000;t.n=0}TRY.set(ip,t);return bad('رقم الشارة أو الرمز غير صحيح، أو الحساب موقوف',401)}
  TRY.delete(ip);const sid=crypto.randomBytes(24).toString('hex');S.set(sid,{id,exp:Date.now()+12*3600e3});
  return[200,{ok:1},sid];
 },
 register(req,b){
  const id=badgeOf(b.badge),name=str(b.name,40),code=str(b.code,64).toUpperCase();
  if(!id||!name||code.length<5||!/^[A-Z0-9]+$/.test(code)||!SEC.includes(b.sector))return bad('بيانات غير مكتملة');
  if(id==='ADMIN'||DB.accounts[id])return bad('رقم الشارة مستخدم');
  if(Object.values(DB.accounts).filter(a=>a.pending).length>=100)return bad('الطلبات ممتلئة، حاول لاحقاً');
  DB.accounts[id]={id,name,sector:b.sector,rank:'Cadet',...mkAcc(code),active:false,pending:true,date:new Date().toISOString().slice(0,10)};save();return ok();
 },
};
const A={ // يحتاج تسجيل دخول
 state(u){return ok(0,{me:{id:u.id,name:u.name,rank:u.rank,sector:u.sector,admin:!!u.admin},
  accounts:Object.values(DB.accounts).filter(a=>!a.pending).map(pub),
  pending:u.admin?Object.values(DB.accounts).filter(a=>a.pending).map(pub):[],
  cases:Object.values(DB.cases).sort((a,b)=>b.ts-a.ts),perms:Object.fromEntries(Object.keys(PERMS).map(k=>[k,minOf(k)]))})},
 logout(u,b,req){const m=/sid=([a-f0-9]+)/.exec(req.headers.cookie||'');if(m)S.delete(m[1]);return ok()},
 addCase(u,b){if(!can(u,'addCase'))return bad('لا تملك الصلاحية',403);
  const type=str(b.type,40),desc=str(b.desc,600);if(!type||!desc||!SEC.includes(b.sector)||!PRI.includes(b.pri))return bad('بيانات غير مكتملة');
  const id='C'+Date.now()+crypto.randomBytes(2).toString('hex');
  DB.cases[id]={id,ts:Date.now(),date:new Date().toISOString().slice(0,10),type,loc:str(b.loc,80),party:str(b.party,60),sector:b.sector,pri:b.pri,desc,status:'جديد',officer:`${u.rank} ${u.name}`};save();return ok()},
 setCase(u,b){if(!can(u,'setCase'))return bad('لا تملك الصلاحية',403);const c=DB.cases[b.id];if(!c||!ST.includes(b.status))return bad('غير صالح');c.status=b.status;save();return ok()},
 delCase(u,b){if(!can(u,'delCase'))return bad('لا تملك الصلاحية',403);delete DB.cases[b.id];save();return ok()},
 addPerson(u,b){if(!can(u,'addPerson'))return bad('لا تملك الصلاحية',403);
  const id=badgeOf(b.badge),name=str(b.name,40);
  if(!id||!name||id==='ADMIN'||DB.accounts[id])return bad('رقم الشارة مستخدم أو البيانات ناقصة');
  if(!SEC.includes(b.sector)||ri(b.rank)<0||(!u.admin&&ri(b.rank)>=ri(u.rank)))return bad('رتبة أو قطاع غير مسموح');
  const code=genCode();DB.accounts[id]={id,name,sector:b.sector,rank:b.rank,...mkAcc(code),active:true,date:new Date().toISOString().slice(0,10)};save();return ok(0,{code})},
 resetCode(u,b){const a=DB.accounts[b.id];if(!can(u,'setPerson')||!mgr(u,a))return bad('غير مسموح',403);const code=genCode();Object.assign(a,mkAcc(code));save();return ok(0,{code})},
 toggle(u,b){const a=DB.accounts[b.id];if(!can(u,'setPerson')||!mgr(u,a))return bad('غير مسموح',403);a.active=!!b.active;save();return ok()},
 delPerson(u,b){const a=DB.accounts[b.id];if(!can(u,'delPerson')||!mgr(u,a))return bad('غير مسموح',403);delete DB.accounts[b.id];save();return ok()},
 approve(u,b){const a=DB.accounts[b.id];if(!u.admin||!a||!a.pending||ri(b.rank)<0)return bad('غير مسموح',403);a.pending=false;a.active=true;a.rank=b.rank;save();return ok()},
 reject(u,b){const a=DB.accounts[b.id];if(!u.admin||!a||!a.pending)return bad('غير مسموح',403);delete DB.accounts[b.id];save();return ok()},
 setPerm(u,b){if(!u.admin||!(b.k in PERMS)||!Number.isInteger(b.v)||b.v<0||b.v>=RK.length)return bad('غير مسموح',403);DB.perms[b.k]=b.v;save();return ok()},
};
const HDR={'X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'"};
http.createServer((req,res)=>{
 const send=(c,d,extra={})=>{res.writeHead(c,{'Content-Type':'application/json; charset=utf-8',...HDR,...extra});res.end(JSON.stringify(d))};
 if(req.method==='GET'){
  const f=path.join(process.env.PUBLIC_DIR||path.join(__dirname,'public'),'index.html');
  if(req.url==='/'||req.url.startsWith('/?')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...HDR});return res.end(fs.readFileSync(f))}
  return send(404,{error:'not found'});
 }
 if(req.method!=='POST'||!(req.headers['content-type']||'').includes('application/json')||!req.url.startsWith('/api/'))return send(400,{error:'bad request'});
 let body='';req.on('data',d=>{body+=d;if(body.length>20000)req.destroy()});
 req.on('end',()=>{
  let b={};try{b=JSON.parse(body||'{}')}catch{return send(400,{error:'bad json'})}
  const name=req.url.slice(5).split('?')[0];
  try{
   if(H[name]){const [c,d,sid]=H[name](req,b);
    const ck=sid?{'Set-Cookie':`sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${(req.headers['x-forwarded-proto']==='https'||process.env.HTTPS)?'; Secure':''}`}:{};return send(c,d,ck)}
   const u=user(req);if(!u)return send(401,{error:'سجّل الدخول'});
   if(!A[name]||name==='constructor')return send(404,{error:'غير موجود'});
   const [c,d]=A[name](u,b,req);send(c,d);
  }catch(e){console.error(e);send(500,{error:'خطأ في السيرفر'})}
 });
}).listen(PORT,process.env.HOST||'0.0.0.0',()=>console.log('http://localhost:'+PORT));
