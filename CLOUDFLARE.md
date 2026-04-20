# Cloudflare Move Notes

Paseito no longer carries the old Render/Postgres setup. The Cloudflare entrypoint is `cloudflare/worker.js`, configured by `wrangler.toml`.

The Worker serves:

- Static files from `public/`.
- `/ws?room=main` as the native WebSocket room endpoint.
- `/api/maps/:name/model` and `/api/maps/:name/ambient` as allowlisted same-origin asset proxy routes.

The Durable Object owns:

- Presence and interpolated position state.
- WebRTC signaling messages.
- Admin auth and admin commands.
- Persisted signs/world objects via Durable Object storage.
- Room settings such as map, speed, scale, acceleration, and voice distance.

## Local Cloudflare Dev

```bash
npm run cf:dev
```

Open the local Wrangler URL printed in the terminal. The client automatically falls back to the native WebSocket transport when Socket.IO is not present.

## Deploy

```bash
npm run cf:deploy
```

Before production, set the admin password as a Wrangler secret instead of relying on the default in `wrangler.toml`:

```bash
npx wrangler secret put ADMIN_PASSWORD
```

## Still Worth Doing

- Move hosted map/audio assets to R2 and update `sourceUrl` values in `cloudflare/worker.js`.
- Replace CDN imports with vendored or bundled assets if you want fully self-contained Cloudflare deploys.
- Add a proper room selector once more than one public room is needed.

The local Node server remains useful for quick development and still avoids Render-only pieces:

- No `DATABASE_URL` or Postgres dependency.
- No Render database reset workflow.
- Map and ambient asset requests go through allowlisted same-origin proxy routes.
