/* Vefa Auto – web eşitleme katmanı: giriş, sunucu veritabanı ile eşitleme, hesap kartı */
(function(){
'use strict';
var KEY='galeri-defteri.v1',TK='vefa-token',token=null,user=null,rev=null,dirty=false,busy=false,again=false,timer=null,users=[],launched=false;
var $=function(s,r){return(r||document).querySelector(s)};
function RL(r){return r==='admin'?'Yönetici':r==='viewer'?'İzleyici':'Satışçı'}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function ls(a,k,v){try{return a==='g'?localStorage.getItem(k):a==='s'?localStorage.setItem(k,v):localStorage.removeItem(k)}catch(e){return null}}

/* ---- stil ---- */
var st=document.createElement('style');st.textContent=
'#gate{position:fixed;inset:0;z-index:999;display:grid;place-items:center;padding:20px;background:radial-gradient(900px 600px at 15% 10%,#974063aa,transparent 60%),radial-gradient(800px 600px at 90% 90%,#F5476855,transparent 60%),#1b1a38;font-family:"Plus Jakarta Sans",system-ui,sans-serif;color:#fff}'+
'#gate .gc{width:100%;max-width:380px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);border-radius:26px;padding:28px 24px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 30px 60px -20px rgba(0,0,0,.6);animation:gIn .5s cubic-bezier(.3,1.3,.5,1)}'+
'@keyframes gIn{from{opacity:0;transform:translateY(18px) scale(.97)}}'+
'#gate img{display:block;width:170px;max-width:60%;margin:0 auto 6px;filter:drop-shadow(0 8px 18px rgba(0,0,0,.4))}'+
'#gate h1{font:700 22px Sora,system-ui,sans-serif;text-align:center;margin:6px 0 4px}#gate p{text-align:center;color:#d9d3ee;font-size:13.5px;margin:0 0 18px;line-height:1.5}'+
'#gate label{display:block;font-size:12px;font-weight:700;color:#cfc8ea;margin:12px 0 6px}'+
'#gate input{width:100%;box-sizing:border-box;font:inherit;font-size:16px;color:#fff;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.2);border-radius:14px;padding:13px 14px;outline:0}#gate input:focus{border-color:#FF9677;box-shadow:0 0 0 3px #ff967733}'+
'#gate button{width:100%;margin-top:20px;font:700 16px inherit;font-family:inherit;color:#fff;border:0;border-radius:14px;padding:14px;cursor:pointer;background:linear-gradient(100deg,#FF9677,#F54768);box-shadow:0 14px 26px -10px #F54768}#gate button:disabled{opacity:.6}'+
'#gate .er{color:#ffb4c0;font-size:13px;text-align:center;margin-top:12px;min-height:1.2em}'+
'#sy{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(86px + env(safe-area-inset-bottom,0px));z-index:70;font:600 12px "Plus Jakarta Sans",system-ui,sans-serif;padding:7px 14px;border-radius:99px;background:#25264aee;color:#fff;border:1px solid rgba(255,255,255,.18);box-shadow:0 10px 24px -8px rgba(0,0,0,.5);opacity:0;pointer-events:none;transition:opacity .25s}#sy.on{opacity:1}#sy.bad{background:#7a1f3d}'+
'@media(min-width:901px){#sy{left:auto;right:24px;transform:none;bottom:24px}}';
document.head.appendChild(st);

/* ---- ağ ---- */
function call(method,url,body){
  var o={method:method,headers:{}};if(token)o.headers.Authorization='Bearer '+token;
  if(body!==undefined){o.headers['Content-Type']='application/json';o.body=JSON.stringify(body)}
  return fetch(url,o).then(function(r){return r.json().catch(function(){return{}}).then(function(j){if(r.status===401&&token&&url!=='/api/login'){ls('r',TK);location.reload()}return{status:r.status,ok:r.ok,data:j}})});
}
var pill=null,pt=null;
function say(t,bad,ms){if(!pill){pill=document.createElement('div');pill.id='sy';document.body.appendChild(pill)}pill.textContent=t;pill.className='on'+(bad?' bad':'');clearTimeout(pt);if(ms!==0)pt=setTimeout(function(){pill.className=''},ms||1600)}

/* ---- giriş ekranı ---- */
function gate(setup,msg){
  return new Promise(function(res){
    var g=document.createElement('div');g.id='gate';
    g.innerHTML='<form class="gc" autocomplete="on"><img src="/logo.png" alt="Vefa Auto"><h1>'+(setup?'İlk kurulum':'Hoş geldiniz')+'</h1><p>'+(setup?'Yönetici hesabınızı oluşturun. Bu bilgilerle her cihazdan giriş yapacaksınız.':'Devam etmek için giriş yapın.')+'</p>'+
    '<label for="gu">Kullanıcı adı</label><input id="gu" name="username" autocomplete="username" autocapitalize="none" required><label for="gp">Şifre'+(setup?' (en az 6 karakter)':'')+'</label><input id="gp" name="password" type="password" autocomplete="'+(setup?'new-password':'current-password')+'" required>'+
    '<button type="submit">'+(setup?'Hesabı oluştur':'Giriş yap')+'</button><div class="er" id="ge">'+esc(msg||'')+'</div></form>';
    document.body.appendChild(g);var f=$('form',g);$('#gu').focus();
    f.addEventListener('submit',function(e){e.preventDefault();var b=$('button',g);b.disabled=true;$('#ge').textContent='';
      call('POST',setup?'/api/setup':'/api/login',{username:$('#gu').value.trim(),password:$('#gp').value}).then(function(r){
        b.disabled=false;if(!r.ok){$('#ge').textContent=r.data.error||'Hata';return}
        token=r.data.token;user=r.data.user;ls('s',TK,token);g.remove();res()}).catch(function(){b.disabled=false;$('#ge').textContent='Sunucuya ulaşılamadı'})});
  });
}

/* ---- yerel fotoğraf geçişi (IndexedDB) ---- */
function localPhotos(){return new Promise(function(res){try{var r=indexedDB.open('galeri-defteri-foto',1);r.onupgradeneeded=function(){r.result.createObjectStore('p')};r.onerror=function(){res({})};
  r.onsuccess=function(){var o={};try{var c=r.result.transaction('p').objectStore('p').openCursor();c.onsuccess=function(){var cur=c.result;if(cur){o[cur.key]=cur.value;cur.continue()}else res(o)};c.onerror=function(){res(o)}}catch(e){res(o)}}}catch(e){res({})}})}

/* ---- eşitleme ---- */
function cache(db){ls('s',KEY,JSON.stringify(db))}
window.__onSave=function(db){dirty=true;clearTimeout(timer);timer=setTimeout(push,500)};
function push(){
  if(!dirty)return;if(busy){again=true;return}
  var db=window.__galeri&&window.__galeri.db;if(!db)return;busy=true;dirty=false;say('Kaydediliyor…',false,0);
  call('PUT','/api/db',{baseRev:rev,db:db,force:rev===null}).then(function(r){
    busy=false;
    if(r.ok){rev=r.data.rev;say('Kaydedildi ✓');if(again||dirty){again=false;dirty=true;push()}return}
    if(r.status===409){return pull(true)}
    if(r.status===403){say(r.data.error||'Yetkiniz yok',true,3000);return pull(true)}
    dirty=true;say('Kaydedilemedi, yeniden denenecek',true);timer=setTimeout(push,8000);
  }).catch(function(){busy=false;dirty=true;say('Çevrimdışı – bağlanınca kaydedilecek',true,0);timer=setTimeout(push,8000)});
}
function modalOpen(){return !!$('#mb')}
function pull(conflict){
  return call('GET','/api/db').then(function(r){if(!r.ok)return;rev=r.data.rev;dirty=false;cache(r.data.db);window.__galeri.setDb(r.data.db);
    say(conflict?'Başka cihazdaki değişiklikler yüklendi':'Güncel veriler yüklendi',false,2400)})
}
function poll(){
  if(dirty||busy||modalOpen()||document.hidden)return;
  call('GET','/api/rev').then(function(r){if(r.ok&&rev!==null&&r.data.rev!==rev&&!dirty&&!modalOpen())pull(false)}).catch(function(){})
}
var phq={};
window.__onPhoto=function(id,list){clearTimeout(phq[id]);phq[id]=setTimeout(function(){call('PUT','/api/photos/'+encodeURIComponent(id),{list:list}).catch(function(){})},400)};

/* ---- hesap kartı (Ayarlar sayfası) ---- */
function loadUsers(){return call('GET','/api/users').then(function(r){if(r.ok){users=r.data.users;if(launched)window.__galeri.render()}})}
window.__acctCard=function(){
  if(!user)return'';
  var h='<div class="card" style="margin-top:16px"><h3>Hesap ve web sürümü</h3><p class="muted" style="margin:6px 0 12px">Giriş yapan: <b>'+esc(user.username)+'</b> · '+RL(user.role)+'. Veriler sunucudaki SQLite veritabanında saklanır; her cihazdan aynı verilere ulaşırsınız.</p>'+
   '<div class="toolbar" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="ext" data-fn="backup">Sunucu yedeğini indir</button><button class="btn" data-act="ext" data-fn="refresh">Verileri yenile</button><button class="btn danger" data-act="ext" data-fn="logout">Çıkış yap</button></div>'+
   '<div class="fgrid" style="margin-top:16px"><div class="fld"><label for="pwo">Eski şifre</label><input id="pwo" type="password" autocomplete="current-password"></div><div class="fld"><label for="pwn">Yeni şifre (en az 6)</label><input id="pwn" type="password" autocomplete="new-password"></div></div><button class="btn" style="margin-top:10px" data-act="ext" data-fn="pw">Şifreyi değiştir</button>';
  if(user.role==='admin'){
    h+='<h3 style="margin-top:22px">Kullanıcılar</h3><div class="tw" style="margin-top:8px"><table style="min-width:360px"><thead><tr><th>Kullanıcı</th><th>Yetki</th><th></th></tr></thead><tbody>'+users.map(function(u){return'<tr><td>'+esc(u.username)+'</td><td>'+RL(u.role)+'</td><td class="r">'+(u.username===user.username?'':'<button class="btn sm" data-act="ext" data-fn="deluser" data-id="'+u.id+'">Sil</button>')+'</td></tr>'}).join('')+'</tbody></table></div>'+
     '<div class="fgrid" style="margin-top:12px"><div class="fld"><label for="nu">Yeni kullanıcı adı</label><input id="nu" autocapitalize="none" autocomplete="off"></div><div class="fld"><label for="np">Şifre (en az 6)</label><input id="np" type="password" autocomplete="new-password"></div><div class="fld"><label for="nr">Yetki</label><select id="nr"><option value="user">Satışçı (kasa ve raporları görmez)</option><option value="viewer">İzleyici (yalnızca görüntüler)</option><option value="admin">Yönetici</option></select></div></div><button class="btn" style="margin-top:10px" data-act="ext" data-fn="adduser">Kullanıcı ekle</button>';
  }
  return h+'</div>';
};
window.__ext={
  logout:function(){call('POST','/api/logout').finally(function(){ls('r',TK);ls('r',KEY);location.reload()})},
  refresh:function(){pull(false)},
  backup:function(){fetch('/api/backup',{headers:{Authorization:'Bearer '+token}}).then(function(r){return r.blob()}).then(function(b){var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='vefa-yedek-'+new Date().toISOString().slice(0,10)+'.json';document.body.appendChild(a);a.click();a.remove();say('Yedek indirildi')})},
  pw:function(){call('POST','/api/password',{old:$('#pwo').value,password:$('#pwn').value}).then(function(r){say(r.ok?'Şifre değiştirildi':(r.data.error||'Hata'),!r.ok,2600);if(r.ok){$('#pwo').value='';$('#pwn').value=''}})},
  adduser:function(){call('POST','/api/users',{username:$('#nu').value.trim(),password:$('#np').value,role:$('#nr').value}).then(function(r){say(r.ok?'Kullanıcı eklendi':(r.data.error||'Hata'),!r.ok,2600);if(r.ok)loadUsers()})},
  deluser:function(el){if(!confirm('Bu kullanıcı silinsin mi?'))return;call('DELETE','/api/users/'+el.dataset.id).then(function(r){say(r.ok?'Kullanıcı silindi':(r.data.error||'Hata'),!r.ok,2600);if(r.ok)loadUsers()})}
};

/* ---- açılış ---- */
function launch(){
  window.__role=user&&user.role;
  call('GET','/api/db').then(function(r){
    if(!r.ok)throw new Error('db');rev=r.data.rev;
    var localRaw=ls('g',KEY);
    if(r.data.empty){
      /* sunucu boş: bu cihazdaki veriler (varsa) sunucuya taşınır */
      if(localRaw){try{var d=JSON.parse(localRaw);return call('PUT','/api/db',{baseRev:rev,db:d,force:true}).then(function(x){if(x.ok)rev=x.data.rev;return localPhotos()}).then(function(ph){window.__PHOTOS=ph;if(Object.keys(ph).length)call('POST','/api/photos',{all:ph});say('Mevcut verileriniz sunucuya taşındı ✓',false,3000)})}catch(e){}}
      window.__FIRMA_HINT=r.data.hint||null;ls('r',KEY);window.__PHOTOS={};dirty=false;rev=null;return;
    }
    cache(r.data.db);return call('GET','/api/photos').then(function(p){window.__PHOTOS=p.ok?p.data:{}});
  }).catch(function(){say('Sunucuya ulaşılamadı',true,4000)}).then(function(){
    window.__launch();launched=true;
    if(window.__FIRMA_HINT&&window.__galeri&&window.__galeri.db&&window.__galeri.db.demo){var d=window.__galeri.db;d.firma=Object.assign({},d.firma,window.__FIRMA_HINT);window.__onSave(d);window.__galeri.render()}
    if(user&&user.role==='admin')loadUsers();else if(user)loadUsers();
    setInterval(poll,15000);document.addEventListener('visibilitychange',function(){if(!document.hidden)poll()});
    window.addEventListener('online',function(){if(dirty)push()});
    window.addEventListener('pagehide',function(){if(dirty&&token){try{fetch('/api/db',{method:'PUT',keepalive:true,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({baseRev:rev,db:window.__galeri.db,force:rev===null})})}catch(e){}}});
  });
}
function boot(){
  token=ls('g',TK);
  call('GET','/api/status').then(function(r){
    if(!r.ok)throw 0;
    if(r.data.user){user=r.data.user;return launch()}
    token=null;ls('r',TK);return gate(r.data.setup).then(launch);
  }).catch(function(){var g=document.createElement('div');g.id='gate';g.innerHTML='<div class="gc"><img src="/logo.png" alt=""><h1>Sunucuya ulaşılamadı</h1><p>İnternet bağlantınızı kontrol edip sayfayı yenileyin.</p><button onclick="location.reload()">Yenile</button></div>';document.body.appendChild(g)});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
