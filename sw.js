/* Telegram Vault (TDLib build) — offline shell + engine cache.

   The TDLib engine (tdweb.js, both workers, the ~11.4 MB .wasm) is fetched by
   code running inside a Web Worker, which does NOT reliably pass through this
   service worker's fetch handler, and Chrome does not keep the wasm in its HTTP
   cache either. Left alone, that costs ~11.4 MB of GitHub Pages bandwidth on
   EVERY launch — and the same again from the user's mobile data.

   So the engine is precached here explicitly at install time and served
   cache-first afterwards. Filenames are content-hashed, so a cached copy can
   never be stale for a different build.

   Nothing from Telegram passes through here: TDLib talks to Telegram over its
   own transport, not window.fetch. */

const VERSION = "vault-td-v2";
const SHELL   = ["./", "index.html", "manifest.json", "icon.svg"];
const ENGINE  = [
  "tdweb.js",
  "b5452fdafbf71399f7a9.worker.js",
  "1.b5452fdafbf71399f7a9.worker.js",
  "3954d526ee7f66ea79957ddbbc4f4d44.wasm"
];
const BIG = /\.wasm$|\.worker\.js$|^tdweb\.js$/;

async function fill(cache, urls) {
  // one at a time and individually tolerant: a single miss must not throw away
  // the whole install the way cache.addAll() would
  for (const u of urls) {
    try {
      if (await cache.match(u)) continue;
      const res = await fetch(u);   // default cache mode: reuse what the page just fetched
      if (res && res.ok) await cache.put(u, res.clone());
    } catch (_) { /* keep going; the network path still works */ }
  }
}

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await fill(c, SHELL);
    await fill(c, ENGINE);      // ~11.4 MB, paid once
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const name = url.pathname.split("/").pop() || "";

  // Engine: cache first, always. Never revalidate — the names are hashed.
  if (BIG.test(name)) {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      const hit = await c.match(name, { ignoreSearch: true }) || await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.ok) c.put(name, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { caches.open(VERSION).then((c) => c.put("index.html", res.clone())).catch(() => {}); return res; })
        .catch(() => caches.match("index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone())).catch(() => {});
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
