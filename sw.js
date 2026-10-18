/* PWA pública: no cachear API, sesiones, documentos, sistemas ni datos escolares. */
const CACHE='ithla-publico-v6-0-1';const PRECACHE=['/','/manifest.webmanifest','/assets/ithla-logo.png','/assets/ithla-192.png','/assets/ithla-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(PRECACHE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const req=e.request,origin=new URL(req.url);if(req.method!=='GET'||origin.origin!==self.location.origin)return;if(!PRECACHE.includes(origin.pathname))return;e.respondWith(fetch(req).then(res=>{if(res.ok){const c=res.clone();caches.open(CACHE).then(cache=>cache.put(req,c))}return res}).catch(()=>caches.match(req)))});
