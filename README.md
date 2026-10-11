# NUUVI

A writing platform for roleplayers. It runs as a **website** and installs as an **app** on phones and desktops (it's a Progressive Web App), all from one codebase.

## Features

- **Accounts:** sign up and sign in with a username and password (scrypt-hashed, HttpOnly session cookies).
- **Characters:** keep a sheet for each character with a name, tagline, signature color and long-form bio. Each character has a public profile page.
- **Stories:** public or private (invite-only) roleplay threads with a genre, a G/T/M rating, and open or closed membership. Owners get a shareable invite link they can regenerate.
- **Three post types:**
  - *In character*: written as one of your characters, in their color.
  - *Narration*: scene-setting text.
  - *OOC*: out-of-character chatter.
- **Roleplay formatting:** `*actions*`, `**bold**` and `"dialogue"` are styled automatically.
- **Live updates:** new, edited and deleted posts show up instantly for everyone reading (Server-Sent Events).
- **Writer comforts:** word counts, drafts that autosave per story, a remembered "writing as" character, and Ctrl/⌘+Enter to post.
- **Discover:** browse and search public stories.
- **Installable:** add it to your home screen. A service worker caches the app shell so it opens instantly.

## Running it

Requires **Node.js 22.5+** and has **no npm dependencies** (it uses Node's built-in SQLite).

```bash
npm start          # http://localhost:3000
npm run dev        # restarts on file changes
npm test           # API test suite
```

Environment variables:

| Variable        | Default          | Purpose                                   |
|-----------------|------------------|-------------------------------------------|
| `PORT`          | `3000`           | HTTP port                                 |
| `DATABASE_PATH` | `data/nuuvi.db`  | SQLite database file                      |
| `NODE_ENV`      | –                | `production` marks cookies as `Secure`    |

To install it as an app, open the site in Chrome, Edge or Safari and choose **Install** / **Add to Home Screen**. Outside `localhost`, installing requires HTTPS.

## Project layout

```
server/
  index.js   entry point
  app.js     HTTP server, REST API, live events, static files
  auth.js    password hashing, sessions, rate limiting
  db.js      SQLite schema
public/      the web app (vanilla JS SPA, PWA manifest, service worker)
test/        node:test API tests
```

## API overview

All endpoints are under `/api` and use JSON request and response bodies.

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register`, `/auth/login`, `/auth/logout` | |
| GET/PUT | `/me` | current user, update display name / bio |
| GET/POST | `/characters` | your characters |
| GET/PUT/DELETE | `/characters/:id` | GET is public |
| GET/POST | `/stories?scope=public\|mine&q=` | list / create |
| GET/PUT/DELETE | `/stories/:id` | PUT/DELETE owner only |
| POST | `/stories/:id/join`, `/stories/:id/leave` | `join` accepts `{ inviteCode }` |
| GET/POST | `/stories/:id/posts?after=` | `{ kind: ic\|narration\|ooc, body, characterId }` |
| PUT/DELETE | `/posts/:id` | edit: author; delete: author or story owner |
| GET | `/stories/:id/events` | Server-Sent Events: `post`, `edit`, `delete` |
