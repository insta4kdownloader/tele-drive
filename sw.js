/* Telegram Vault (TDLib build) — offline shell.

   The small shell is precached on install. The TDLib payload (tdweb.js, both
   workers and the ~12 MB .wasm) is cached on first use instead, so a slow
   connection can't fail the install. Those filenames are content-hashed, so
   cache-first can never serve a mismatched build.

   Nothing from Telegram's servers passes through here: TDLib talks to
   Telegram over its own transport inside a worker, not via window.fetch. */

const VERSION = "vault-td-v1";
const SHELL = ["./", "index.html", "manifest.json", "icon.svg"];
const BIG = /\.wasm$|\.worker\.js$|^tdweb\.js$/;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()).catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const name = url.pathname.split("/").pop() || "";

  if (BIG.test(name)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res && res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone())).catch(() => {});
        return res;
      }))
    );
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        caches.open(VERSION).then((c) => c.put("index.html", res.clone())).catch(() => {});
        return res;
      }).catch(() => caches.match("index.html").then((r) => r || caches.match("./")))
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
