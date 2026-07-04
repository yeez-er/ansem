# Serwist / Workbox PWA Service Worker Wisdom

<!-- Service worker / offline caching patterns with Serwist (Workbox). Load ONLY if the project ships a PWA service worker. -->

- Cache Storage in a service worker (Serwist/Workbox) is ORIGIN-scoped, never user-scoped: a `NetworkFirst`/`defaultCache` rule over `/api/*` or `/api/trpc/*` caches one user's authenticated responses and serves them to the next user on a shared device. Use `NetworkOnly` for authenticated API routes (or `Cache-Control: private, no-store`), and purge all caches on logout via a SW `postMessage`. [from: itqan]
- A service-worker route predicate that matches API paths by substring (`url.includes('review.queue')`) silently auto-caches any future sibling route (`review.queueSnapshot`); tokenize the path and add a negative-boundary test so a new endpoint is not opted into caching by accident. [from: itqan]
