const CACHE='michi-v020';
const shell=['./','./index.html','./style.css','./app.mjs','./core.mjs','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(shell))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('michi-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  const asset=shell.map(p=>new URL(p,self.registration.scope).href).includes(url.href);
  if(event.request.mode!=='navigate'&&!asset)return;
  event.respondWith(caches.open(CACHE).then(async cache=>{
    const hit=await cache.match(event.request.mode==='navigate'?new URL('./index.html',self.registration.scope).href:event.request);
    return hit||fetch(event.request);
  }));
});
