'use strict';
/* Vefa Auto – web sunucusu. Bağımlılık yok: Node 22.5+ (node:sqlite) yeterli. */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');

const PORT=+process.env.PORT||3000;
const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'data');
const PUB=path.join(__dirname,'public');
const SESSION_DAYS=+process.env.SESSION_DAYS||30;
const COLS=['accounts','contacts','vehicles','options','requests','expenses','sales','inst','txs','makbuzlar'];
fs.mkdirSync(DATA_DIR,{recursive:true});

const sql=new DatabaseSync(path.join(DATA_DIR,'vefa.sqlite'));
sql.exec(`
PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'admin',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS docs(coll TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(coll,id));
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY,json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS photos(vehicle_id TEXT NOT NULL,idx INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(vehicle_id,idx));
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT NOT NULL);
INSERT OR IGNORE INTO meta(k,v) VALUES('rev','0');
CREATE INDEX IF NOT EXISTS docs_coll ON docs(coll);
`);
const q=s=>sql.prepare(s);
const tx=fn=>{sql.exec('BEGIN IMMEDIATE');try{const r=fn();sql.exec('COMMIT');return r}catch(e){try{sql.exec('ROLLBACK')}catch(_){}throw e}};
const getRev=()=>+q("SELECT v FROM meta WHERE k='rev'").get().v;
const bump=()=>{const r=getRev()+1;q("UPDATE meta SET v=? WHERE k='rev'").run(String(r));return r};

/* ---------- şifre / oturum ---------- */
const hashPw=(pw,salt)=>crypto.scryptSync(pw,salt,64).toString('hex');
const mkUser=(username,pw,role)=>{const salt=crypto.randomBytes(16).toString('hex');return q('INSERT INTO users(username,salt,hash,role) VALUES(?,?,?,?)').run(username,salt,hashPw(pw,salt),role).lastInsertRowid};
const newSession=uid=>{const t=crypto.randomBytes(32).toString('hex');q('INSERT INTO sessions VALUES(?,?,?)').run(t,uid,Date.now()+SESSION_DAYS*864e5);return t};
const userOf=req=>{const h=req.headers.authorization||'';const t=h.startsWith('Bearer ')?h.slice(7):'';if(!t)return null;
  const r=q('SELECT u.id,u.username,u.role,s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(t);
  if(!r)return null;if(r.expires<Date.now()){q('DELETE FROM sessions WHERE token=?').run(t);return null}return{...r,token:t}};
const fails=new Map();
const throttled=ip=>{const f=fails.get(ip);return f&&f.n>=8&&Date.now()-f.t<10*60e3};
const failed=ip=>{const f=fails.get(ip)||{n:0,t:0};f.n=Date.now()-f.t>10*60e3?1:f.n+1;f.t=Date.now();fails.set(ip,f)};
const safeEq=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y)};

/* ---------- veri: istemci db nesnesi <-> tablolar ---------- */
function readDb(){
  const db={};
  for(const r of q('SELECT k,json FROM kv').all())db[r.k]=JSON.parse(r.json);
  for(const c of COLS)db[c]=[];
  const rows=q('SELECT coll,json FROM docs ORDER BY rowid').all();
  for(const r of rows)if(db[r.coll])db[r.coll].push(JSON.parse(r.json));
  return db;
}
function writeDb(d){
  const now=Date.now();let changed=0;
  const get=q('SELECT json FROM docs WHERE coll=? AND id=?'),put=q('INSERT INTO docs(coll,id,json,updated_at) VALUES(?,?,?,?) ON CONFLICT(coll,id) DO UPDATE SET json=excluded.json,updated_at=excluded.updated_at'),del=q('DELETE FROM docs WHERE coll=? AND id=?'),ids=q('SELECT id FROM docs WHERE coll=?');
  for(const c of COLS){
    const list=Array.isArray(d[c])?d[c]:[];const keep=new Set();
    list.forEach((it,i)=>{const id=String(it&&it.id!=null?it.id:'#'+i);keep.add(id);const js=JSON.stringify(it);const old=get.get(c,id);if(!old||old.json!==js){put.run(c,id,js,now);changed++}});
    for(const r of ids.all(c))if(!keep.has(r.id)){del.run(c,r.id);changed++}
  }
  const kvPut=q('INSERT INTO kv(k,json) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET json=excluded.json'),kvGet=q('SELECT json FROM kv WHERE k=?'),kvDel=q('DELETE FROM kv WHERE k=?');
  const keys=Object.keys(d).filter(k=>!COLS.includes(k));
  for(const k of keys){const js=JSON.stringify(d[k]);const o=kvGet.get(k);if(!o||o.json!==js){kvPut.run(k,js);changed++}}
  for(const r of q('SELECT k FROM kv').all())if(!keys.includes(r.k)){kvDel.run(r.k);changed++}
  return changed;
}
const hasData=()=>q("SELECT 1 FROM kv WHERE k='v'").get()!==undefined;

/* ---------- http yardımcıları ---------- */
const SEC={'X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Referrer-Policy':'same-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
const json=(res,code,obj)=>{const b=JSON.stringify(obj);res.writeHead(code,{...SEC,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':Buffer.byteLength(b)});res.end(b)};
const body=(req,max=60e6)=>new Promise((ok,no)=>{let n=0;const ch=[];req.on('data',c=>{n+=c.length;if(n>max){no(Object.assign(new Error('çok büyük'),{code:413}));req.destroy();return}ch.push(c)});req.on('end',()=>{try{ok(ch.length?JSON.parse(Buffer.concat(ch).toString('utf8')):{})}catch(e){no(Object.assign(new Error('geçersiz JSON'),{code:400}))}});req.on('error',no)});
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.ico':'image/x-icon'};
const needsSetup=()=>q('SELECT COUNT(*) n FROM users').get().n===0;
const SETUP_CODE=process.env.SETUP_CODE||(()=>{const A='ABCDEFGHJKLMNPRSTUVYZ23456789';let o='';for(const b of crypto.randomBytes(8))o+=A[b%A.length];return o.slice(0,4)+'-'+o.slice(4)})();
function setupChecks(req){
  const out=[];const add=(id,ad,durum,not)=>out.push({id,ad,durum,not});
  add('node','Node.js sürümü','ok',process.version);
  try{const f=path.join(DATA_DIR,'.yazma-testi');fs.writeFileSync(f,'ok');fs.unlinkSync(f);add('yaz','Veri klasörüne yazma','ok',DATA_DIR)}catch(e){add('yaz','Veri klasörüne yazma','bad','Yazılamıyor: '+DATA_DIR+'. Klasör izinlerini kontrol edin.')}
  try{q('SELECT 1').get();add('db','Veritabanı (SQLite)','ok','Çalışıyor')}catch(e){add('db','Veritabanı (SQLite)','bad',String(e.message))}
  try{const st=fs.statfsSync(DATA_DIR),mb=Math.round(st.bavail*st.bsize/1048576);add('disk','Boş disk alanı',mb<200?'warn':'ok',mb+' MB boş'+(mb<200?'. Fotoğraflar için az olabilir.':''))}catch(e){}
  /* kalıcı disk: veri klasörü kökten ayrı bir bağlama noktasında mı? */
  try{const mi=fs.readFileSync('/proc/self/mountinfo','utf8').split('\n').map(l=>l.split(' ')).filter(x=>x[4]);const real=fs.realpathSync(DATA_DIR);
    let best=null;for(const x of mi){const mp=x[4];if(real===mp||real.startsWith(mp==='/'?'/':mp+'/')){if(!best||mp.length>best[4].length)best=x}}
    const dash=best?best.indexOf('-'):-1,fst=best&&dash>0?best[dash+1]:'';
    if(best&&best[4]!=='/')add('kalici','Kalıcı disk','ok','Veri klasörü ayrı bir diske bağlı ('+best[4]+')');
    else if(process.env.NODE_ENV==='production'||process.env.RENDER||process.env.FLY_APP_NAME||process.env.RAILWAY_ENVIRONMENT)add('kalici','Kalıcı disk','warn','Veri klasörü kalıcı bir diske bağlı görünmüyor. Hosting yeniden başladığında veriler SİLİNEBİLİR. Hostingde bir disk/volume ekleyip /data olarak bağlayın.');
    else add('kalici','Kalıcı disk','ok','Yerel çalışma, veriler bu bilgisayarda saklanır')}catch(e){}
  const proto=(req.headers['x-forwarded-proto']||'').split(',')[0],host=(req.headers.host||'');
  const local=/^(localhost|127\.|192\.168\.|10\.)/.test(host);
  add('https','Güvenli bağlantı (HTTPS)',proto==='https'||local?'ok':'warn',proto==='https'?'HTTPS etkin':local?'Yerel ağ, HTTPS gerekmez':'Bu adres HTTPS ile açılmıyor. İnternete açık kullanımda şifreniz korunmaz; hostingde HTTPS\'i açın.');
  return out}
function serveFile(res,f,type){res.writeHead(200,{...SEC,'Content-Type':type,'Cache-Control':'no-cache'});fs.createReadStream(f).pipe(res)}
function serveStatic(req,res){
  let p=decodeURIComponent(new URL(req.url,'http://x').pathname);
  if(p==='/healthz'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('ok')}
  const ns=needsSetup();
  if(ns&&(p==='/'||p==='/index.html'||p==='/kurulum'||p==='/kurulum.html'))return serveFile(res,path.join(PUB,'kurulum.html'),MIME['.html']);
  if(!ns&&(p==='/kurulum'||p==='/kurulum.html')){res.writeHead(302,{Location:'/'});return res.end()}
  if(p==='/')p='/index.html';
  const f=path.normalize(path.join(PUB,p));
  if(!f.startsWith(PUB)||!fs.existsSync(f)||!fs.statSync(f).isFile()){const i=path.join(PUB,'index.html');res.writeHead(200,{...SEC,'Content-Type':MIME['.html'],'Cache-Control':'no-cache'});return fs.createReadStream(i).pipe(res)}
  res.writeHead(200,{...SEC,'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':p==='/index.html'?'no-cache':'public, max-age=3600'});fs.createReadStream(f).pipe(res);
}
const okName=u=>typeof u==='string'&&/^[\p{L}0-9._-]{3,32}$/u.test(u);
const okPw=p=>typeof p==='string'&&p.length>=6&&p.length<=200;

/* ---------- yönlendirme ---------- */
async function api(req,res,url){
  const ip=req.socket.remoteAddress||'?',m=req.method,p=url.pathname;
  if(p==='/api/status'&&m==='GET'){const u=userOf(req);return json(res,200,{setup:q('SELECT COUNT(*) n FROM users').get().n===0,user:u?{username:u.username,role:u.role}:null})}
  if(p==='/api/setup/check'&&m==='GET'){if(!needsSetup())return json(res,403,{error:'Kurulum zaten yapılmış'});return json(res,200,{checks:setupChecks(req),codeFromEnv:!!process.env.SETUP_CODE})}
  if(p==='/api/setup'&&m==='POST'){
    if(!needsSetup())return json(res,403,{error:'Kurulum zaten yapılmış'});
    if(throttled(ip))return json(res,429,{error:'Çok fazla deneme. 10 dakika sonra tekrar deneyin.'});
    const b=await body(req);
    if(!safeEq(String(b.code||'').trim().toUpperCase(),SETUP_CODE.toUpperCase())){failed(ip);return json(res,403,{error:'Kurulum kodu hatalı. Kodu hosting panelindeki günlükten (Logs) alın.'})}
    if(!okName(b.username)||!okPw(b.password))return json(res,400,{error:'Kullanıcı adı 3+ karakter (harf, rakam, . _ -), şifre en az 6 karakter olmalı'});
    const f=b.firma&&typeof b.firma==='object'?b.firma:{},str=(x,n)=>String(x||'').slice(0,n);
    const firma={ad:str(f.ad,80)||'Vefa Auto',vergiNo:str(f.vergiNo,20),vergiDairesi:str(f.vergiDairesi,60),tel:str(f.tel,30),adres:str(f.adres,200),yetkiNo:'',yetkiBitis:''};
    const out=tx(()=>{
      const id=Number(mkUser(b.username,b.password,'admin'));
      if(b.restore&&b.restore.db&&typeof b.restore.db==='object'){const d=b.restore.db;d.firma={...(d.firma||{}),...firma,ad:firma.ad};d.v=d.v||1;writeDb(d);bump();
        const ph=b.restore.photos;if(ph&&typeof ph==='object'){const ins=q('INSERT OR REPLACE INTO photos VALUES(?,?,?)');for(const vid of Object.keys(ph)){if(!/^[\w-]{1,64}$/.test(vid))continue;(ph[vid]||[]).slice(0,8).forEach((x,i)=>{if(typeof x==='string'&&x.startsWith('data:image/'))ins.run(vid,i,x)})}}}
      else if(b.mod==='bos'){writeDb({v:1,demo:false,firma,accounts:[{id:crypto.randomBytes(5).toString('hex'),ad:'Kasa (nakit)',tur:'kasa',acilis:0}]});bump()}
      else if(b.mod==='ornek'){q('INSERT OR REPLACE INTO kv(k,json) VALUES(?,?)').run('ilkFirma',JSON.stringify(firma))}  /* örnek veriyi ilk girişte uygulama oluşturur; firma bilgisi ipucu olarak saklanır */
      return id});
    return json(res,200,{token:newSession(out),user:{username:b.username,role:'admin'}});
  }
  if(p==='/api/login'&&m==='POST'){
    if(throttled(ip))return json(res,429,{error:'Çok fazla deneme. 10 dakika sonra tekrar deneyin.'});
    const b=await body(req);const u=q('SELECT * FROM users WHERE username=?').get(String(b.username||''));
    const good=u&&safeEq(hashPw(String(b.password||''),u.salt),u.hash);
    if(!good){failed(ip);return json(res,401,{error:'Kullanıcı adı veya şifre hatalı'})}
    fails.delete(ip);return json(res,200,{token:newSession(u.id),user:{username:u.username,role:u.role}});
  }
  const me=userOf(req);if(!me)return json(res,401,{error:'Giriş gerekli'});
  if(p==='/api/logout'&&m==='POST'){q('DELETE FROM sessions WHERE token=?').run(me.token);return json(res,200,{ok:1})}
  if(p==='/api/rev'&&m==='GET')return json(res,200,{rev:getRev()});
  if(p==='/api/db'&&m==='GET'){const d=readDb(),e=!hasData();return json(res,200,{rev:getRev(),empty:e,hint:e?d.ilkFirma||null:null,db:e?{}:d})}
  if(me.role==='viewer'&&m!=='GET'&&!['/api/logout','/api/password'].includes(p))return json(res,403,{error:'İzleyici hesabı salt okunurdur'});
  if(p==='/api/db'&&m==='PUT'){
    const b=await body(req);if(!b.db||typeof b.db!=='object')return json(res,400,{error:'db yok'});
    const out=tx(()=>{const cur=getRev();if(b.force!==true&&hasData()&&+b.baseRev!==cur)return{conflict:cur};const ch=writeDb(b.db);return{rev:ch?bump():cur,changed:ch}});
    if(out.conflict!==undefined)return json(res,409,{error:'Veri başka bir cihazda değişti',rev:out.conflict});
    return json(res,200,out);
  }
  if(p==='/api/photos'&&m==='GET'){const o={};for(const r of q('SELECT vehicle_id,data FROM photos ORDER BY vehicle_id,idx').all())(o[r.vehicle_id]||(o[r.vehicle_id]=[])).push(r.data);return json(res,200,o)}
  let mm=p.match(/^\/api\/photos\/([\w-]{1,64})$/);
  if(mm&&m==='PUT'){const b=await body(req);const list=Array.isArray(b.list)?b.list.filter(x=>typeof x==='string'&&x.startsWith('data:image/')).slice(0,8):[];
    tx(()=>{q('DELETE FROM photos WHERE vehicle_id=?').run(mm[1]);const ins=q('INSERT INTO photos VALUES(?,?,?)');list.forEach((d,i)=>ins.run(mm[1],i,d))});return json(res,200,{ok:1,n:list.length})}
  if(p==='/api/photos'&&m==='POST'){ /* toplu yükleme (ilk geçiş) */
    const b=await body(req);tx(()=>{const ins=q('INSERT OR REPLACE INTO photos VALUES(?,?,?)');for(const id of Object.keys(b.all||{})){if(!/^[\w-]{1,64}$/.test(id))continue;(b.all[id]||[]).slice(0,8).forEach((d,i)=>{if(typeof d==='string'&&d.startsWith('data:image/'))ins.run(id,i,d)})}});return json(res,200,{ok:1})}
  if(p==='/api/backup'&&m==='GET'){const b=JSON.stringify({vefa:1,tarih:new Date().toISOString(),db:readDb(),photos:(()=>{const o={};for(const r of q('SELECT vehicle_id,data FROM photos ORDER BY vehicle_id,idx').all())(o[r.vehicle_id]||(o[r.vehicle_id]=[])).push(r.data);return o})()});
    res.writeHead(200,{...SEC,'Content-Type':'application/json','Content-Disposition':'attachment; filename="vefa-yedek-'+new Date().toISOString().slice(0,10)+'.json"','Cache-Control':'no-store'});return res.end(b)}
  /* kullanıcılar */
  if(p==='/api/users'&&m==='GET')return json(res,200,{users:q('SELECT id,username,role,created_at FROM users ORDER BY id').all()});
  if(p==='/api/users'&&m==='POST'){if(me.role!=='admin')return json(res,403,{error:'Yalnızca yönetici kullanıcı ekleyebilir'});
    const b=await body(req);if(!okName(b.username)||!okPw(b.password))return json(res,400,{error:'Kullanıcı adı 3+ karakter, şifre en az 6 karakter olmalı'});
    if(q('SELECT 1 FROM users WHERE username=?').get(b.username))return json(res,409,{error:'Bu kullanıcı adı kayıtlı'});
    mkUser(b.username,b.password,['admin','user','viewer'].includes(b.role)?b.role:'user');return json(res,200,{ok:1})}
  mm=p.match(/^\/api\/users\/(\d+)$/);
  if(mm&&m==='DELETE'){if(me.role!=='admin')return json(res,403,{error:'Yetki yok'});if(+mm[1]===me.id)return json(res,400,{error:'Kendi hesabınızı silemezsiniz'});q('DELETE FROM users WHERE id=?').run(+mm[1]);return json(res,200,{ok:1})}
  if(p==='/api/password'&&m==='POST'){const b=await body(req);const u=q('SELECT * FROM users WHERE id=?').get(me.id);
    if(!safeEq(hashPw(String(b.old||''),u.salt),u.hash))return json(res,401,{error:'Eski şifre hatalı'});if(!okPw(b.password))return json(res,400,{error:'Yeni şifre en az 6 karakter olmalı'});
    const salt=crypto.randomBytes(16).toString('hex');q('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt,hashPw(b.password,salt),me.id);q('DELETE FROM sessions WHERE user_id=? AND token<>?').run(me.id,me.token);return json(res,200,{ok:1})}
  return json(res,404,{error:'Bulunamadı'});
}
const server=http.createServer(async(req,res)=>{
  try{const url=new URL(req.url,'http://x');
    if(url.pathname.startsWith('/api/'))return await api(req,res,url);
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end()}
    serveStatic(req,res);
  }catch(e){if(!res.headersSent)json(res,e.code===413||e.code===400?e.code:500,{error:e.code?e.message:'Sunucu hatası'});else res.end();if(!e.code)console.error(e)}
});
setInterval(()=>{try{q('DELETE FROM sessions WHERE expires<?').run(Date.now())}catch(e){}},36e5).unref();
if(require.main===module)server.listen(PORT,()=>{console.log('Vefa Auto web: http://localhost:'+PORT+'  (veri: '+DATA_DIR+')');
  if(needsSetup())console.log('\n  ==============================================\n   KURULUM KODU: '+SETUP_CODE+'\n   Tarayıcıda siteyi açın ve bu kodu kurulum sihirbazına yazın.\n  ==============================================\n')});
module.exports={server,sql};
