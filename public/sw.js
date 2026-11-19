// Never cache authenticated pages, API responses, or financial records.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>口袋账本 · 暂时离线</title><body style="font-family:system-ui;padding:48px;color:#245c49"><h1>暂时离线</h1><p>请联网后重新打开账本。离线时无法读取或保存记录。</p><button onclick="location.reload()">重新连接</button></body></html>',{status:503,headers:{'Content-Type':'text/html;charset=utf-8'}})));
});
