// Service worker do app do vendedor: deixa a tela /vender abrir sem internet.
const CACHE = "vender-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.add("/vender")).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// A página manda a lista dos arquivos que ela usa, para guardar tudo de uma vez
self.addEventListener("message", (e) => {
  if (e.data && e.data.tipo === "cachear" && Array.isArray(e.data.urls)) {
    caches.open(CACHE).then((c) => Promise.all(e.data.urls.map((u) => c.add(u).catch(() => {}))));
  }
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // chamadas ao Supabase passam direto

  // arquivos estáticos do Next (têm hash no nome, nunca mudam)
  if (url.pathname.startsWith("/_next/static/") || /\.(png|svg|ico|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((achou) => achou || fetch(req).then((res) => {
        if (res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
        return res;
      })),
    );
    return;
  }

  // a tela do vendedor: tenta a internet, se não tiver usa a cópia guardada
  if (req.mode === "navigate" && url.pathname.startsWith("/vender")) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok && !res.redirected) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put("/vender", copia)); }
        return res;
      }).catch(() => caches.match("/vender").then((r) => r || Response.error())),
    );
  }
});
