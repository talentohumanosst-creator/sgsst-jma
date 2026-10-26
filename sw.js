/* SG-SST JMA · permite abrir la app sin señal */
const CACHE='sgsst-jma-1793025937';
const ASSETS=['./','index.html','sync.js','manifest.webmanifest','vendor/qrcode.min.js','vendor/jsQR.js','img/icon-192.png','img/icon-512.png','img/jma-horizontal.png','img/jma-principal.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>Promise.all(ASSETS.map(a=>c.add(a).catch(()=>{})))));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.hostname.endsWith('google.com')||u.hostname.endsWith('googleusercontent.com'))return;   // el servidor siempre va por internet
  e.respondWith(caches.open(CACHE).then(async c=>{
    const hit=await c.match(r,{ignoreSearch:u.origin===location.origin});
    const net=fetch(r).then(res=>{if(res&&(res.ok||res.type==='opaque'))c.put(r,res.clone());return res}).catch(()=>hit);
    return hit||net;
  }));
});
