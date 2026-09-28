<div align="center">

# GS-MongoDB Handler

**A secure, responsive MongoDB management application — by Geeta Systems.**

A modern, browser-based MongoDB GUI built with **Next.js 16**, **React 19**, **TypeScript**, and **Tailwind v4**.

</div>

---

## Overview

GS-MongoDB Handler is a full-stack MongoDB client that lets you:

- Save and manage multiple MongoDB connection profiles.
- Browse databases and collections from a structured sidebar explorer.
- Query documents using JSON filter/sort/limit.
- Insert, edit, view, and delete documents from the UI.
- View and manage collection indexes.
- Use the app smoothly on desktop and mobile with dark/light themes.

The UI runs in the browser, while all MongoDB driver operations run on server-side API routes.

---

## Key Features

### Connection Management
- Save multiple named MongoDB URIs.
- Connection strings are encrypted at rest **on the server** (AES-256-GCM, Node's built-in `crypto`) and are never sent back to the browser — the client only ever holds an opaque connection ID and a masked URI for display.
- Connection test endpoint with server info and latency.

### Explorer
- Database/collection tree view.
- Create and drop collections.
- Drop database with safety checks (system DBs are protected, and the server requires the exact name to be echoed back to confirm a drop).

### Document Workspace
- Paginated document table.
- Type-aware rendering for ObjectId/Date/primitive values.
- Query bar (JSON filter, sort, limit).
- Insert/edit modal JSON editor.
- Read-only JSON viewer modal.

### Index Management
- List indexes for selected collection.
- Create indexes from JSON key spec.
- Drop non-system indexes.

### UX and Responsiveness
- Fully responsive layout with mobile drawer sidebar.
- Touch-friendly controls.
- Dark/light theme toggle.
- Toast feedback for operations.

### Access Control
- The entire app (UI and API) sits behind a single-operator password login.
- Sessions are signed, HttpOnly cookies (12h expiry); no data route is reachable without a valid session.

---

## Tech Stack

- **Framework:** Next.js (App Router)
- **UI:** React + Tailwind CSS v4
- **Language:** TypeScript
- **Database Driver:** `mongodb`
- **Encryption / Auth:** Node's built-in `crypto` (AES-256-GCM, HMAC-SHA256) — no third-party crypto dependency
- **Icons:** `lucide-react`
- **Notifications:** `sonner`

---

## Project Structure

```text
src/
  app/
    api/
      auth/
        login/route.ts
        logout/route.ts
      connect/route.ts
      connections/route.ts
      connections/[id]/route.ts
      databases/route.ts
      databases/manage/route.ts
      collections/route.ts
      collections/manage/route.ts
      documents/route.ts
      indexes/route.ts
    globals.css
    layout.tsx
    page.tsx
    login/page.tsx
  components/
    layout/
      AppShell.tsx
      Sidebar.tsx
      ThemeProvider.tsx
    ui/
      ConnectionManager.tsx
      QueryBar.tsx
      DocumentTable.tsx
      DocumentEditor.tsx
      DocumentViewer.tsx
      IndexViewer.tsx
  lib/
    mongodb.ts
    connectionStore.ts
    auth.ts
    rateLimit.ts
    errors.ts
    mask.ts
  types/
    index.ts
middleware.ts
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm (recommended)
- A running MongoDB instance (local or Atlas)

### Install

```bash
pnpm install
```

### Environment

Create `.env.local` in project root — **all three are required**; the app refuses to start without them rather than falling back to an insecure default:

```env
# HMAC key used to sign login session cookies. Any long random string.
AUTH_SECRET=replace-with-a-strong-random-secret

# Password required to sign in to the app (single-operator login).
APP_PASSWORD=replace-with-a-strong-password

# Key used to encrypt saved connection strings at rest on the server.
ENCRYPTION_SECRET=replace-with-a-different-strong-random-secret

# Optional: where saved connections are persisted. Defaults to
# .data/connections.json — point this at a persistent volume if you
# deploy somewhere with an ephemeral/read-only filesystem.
# CONNECTIONS_STORE_PATH=/var/data/gs-mongodb-handler/connections.json
```

Generate strong random values with e.g. `openssl rand -hex 32`.

### Run Development Server

```bash
pnpm dev
```

Open: `http://localhost:3000`

### Build and Start Production

```bash
pnpm build
pnpm start
```

---

## Available Scripts

- `pnpm dev` — Run local development server.
- `pnpm build` — Build production bundle.
- `pnpm start` — Start production server.
- `pnpm lint` — Run ESLint.

---

## API Routes (Server)

All routes (except `/api/auth/login`) require a valid session cookie, set by signing in at `/login`.

All routes return:

```json
{ "success": true, "data": {} }
```

or

```json
{ "success": false, "error": "message" }
```

### Auth
- `POST /api/auth/login` — `{ password }` → sets the session cookie.
- `POST /api/auth/logout` — clears the session cookie.

### Connections
Saved connections are stored server-side, encrypted at rest. The browser only ever holds an opaque `connectionId`.

- `GET /api/connections` — List saved connections (masked URIs only).
- `POST /api/connections` — `{ name, uri }` → save a new connection.
- `PUT /api/connections/:id` — `{ name, uri? }` → update; omit `uri` to keep the existing connection string.
- `DELETE /api/connections/:id` — Delete a saved connection.
- `POST /api/connect` — `{ uri }` (ad-hoc, pre-save test) **or** `{ connectionId }` (test a saved connection).

### Databases
- `POST /api/databases` — `{ connectionId }` → list databases.
- `DELETE /api/databases/manage` — `{ connectionId, database, confirm }` → drop a database. `confirm` must exactly equal `database`.

### Collections
- `POST /api/collections` — `{ connectionId, database }` → list collections for a DB.
- `POST /api/collections/manage` — `{ connectionId, database, collection }` → create collection.
- `DELETE /api/collections/manage` — `{ connectionId, database, collection, confirm }` → drop collection. `confirm` must exactly equal `collection`.

### Documents
- `POST /api/documents` — `{ connectionId, database, collection, filter, sort, limit, skip, projection }` → query/paginate documents.
- `PUT /api/documents` — `{ connectionId, database, collection, document }` → insert document.
- `PATCH /api/documents` — `{ connectionId, database, collection, id, update }` → update document by `_id` (`id` is the document's already-serialized `_id`, e.g. `{"$oid": "..."}`).
- `DELETE /api/documents` — `{ connectionId, database, collection, id }` → delete document by `_id`.

### Indexes
- `POST /api/indexes` — `{ connectionId, database, collection }` → list indexes.
- `PUT /api/indexes` — `{ connectionId, database, collection, keys, options }` → create index.
- `DELETE /api/indexes` — `{ connectionId, database, collection, indexName }` → drop index.

---

## Security Notes

- The entire app requires sign-in (`APP_PASSWORD`); every API route is checked by `middleware.ts` and rejects unauthenticated requests with 401.
- MongoDB operations are server-side only via Next.js API routes.
- Saved connection strings are encrypted at rest **on the server** (AES-256-GCM) and the browser never receives the raw URI or the encryption key — only an opaque connection ID and a masked URI for display.
- Query filters and update payloads are checked against a denylist of server-side-JS-executing operators (`$where`, `$function`, `$accumulator`, `$mapReduce`) before being sent to MongoDB.
- System DBs (`admin`, `local`, `config`) are protected from deletion, and dropping a database/collection requires the caller to echo the exact name back as `confirm` — a client-side confirm dialog alone is not trusted.
- URI validation is enforced before connection attempts.
- Error responses are sanitized: unexpected driver errors are logged server-side and a generic message is returned to the client, rather than raw MongoDB error text (which can include internal hostnames/topology).
- This is designed for a single trusted operator (or a small trusted team sharing one password) — it is not a multi-tenant/multi-user system. If you need per-user accounts and audit logging, put a proper auth provider in front of it.

---

## Troubleshooting

### App redirects to `/login` immediately, or every API call 401s
- Confirm `AUTH_SECRET` and `APP_PASSWORD` are set in `.env.local` and the dev/prod server was restarted after adding them.
- The session cookie is `httpOnly` and `secure` in production — make sure you're serving over HTTPS in production, or `secure` will prevent the cookie from being set over plain HTTP.

### Connection Test Fails
- Verify URI format starts with `mongodb://` or `mongodb+srv://`.
- Check network/firewall/IP allowlist (Atlas).
- Confirm credentials and URL encoding.

### Saved connection won't decrypt / server logs "ENCRYPTION_SECRET is not set"
- `ENCRYPTION_SECRET` must be set for the server to read or write saved connections.
- If `ENCRYPTION_SECRET` is changed after connections were saved, previously saved connections can no longer be decrypted — re-add them with the new secret in place.

### Saved connections disappear after a redeploy
- By default connections are persisted to a local JSON file (`CONNECTIONS_STORE_PATH`, default `.data/connections.json`). On platforms with an ephemeral or read-only filesystem (most serverless platforms), this won't persist across deploys — point `CONNECTIONS_STORE_PATH` at a persistent volume, or swap `src/lib/connectionStore.ts` for a real datastore.

### Build/Lint Issues
- Ensure dependencies are installed: `pnpm install`.
- Run `pnpm lint` and resolve any reported warnings/errors.

---

## Contributing

1. Create a feature branch.
2. Make focused changes.
3. Run lint/build locally.
4. Open a PR with clear description and screenshots for UI changes.

---

## License

MIT Licence
Geeta Systems
