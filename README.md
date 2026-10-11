# NUUVI

A private, invite-only writing home for a roleplay group. It's a **website** and an **installable app** (phone and desktop) from one codebase, laid out like Discord:

- **Story rail** (left): each story is like a server.
- **Channels**: the scenes inside each story.
- **Feed**: long-form, forum-style posts.
- **Members panel** (right): who's in the story, plus its cast of characters.

On phones, the rail and channels slide out from the left (tap ☰ or swipe right), the members list slides in from the right, and tabs run along the bottom.

## Features

**Writing**
- In-character posts (with the character's picture and color), narration, and OOC chat.
- Formatting:
  - `*actions*`, `**bold**`, `__underline__`, `~~strike~~`
  - `||spoilers||`
  - `"dialogue"`
  - `> quotes`
  - `@mentions`
- Dice: the 🎲 button, or type `/roll 2d6+3 what for`. The server rolls the dice, so nobody can fudge a result.
- Content warnings on stories (readers confirm before entering) and on single posts (tap to reveal).
- Drafts save automatically per channel, and word counts show as you type. Ctrl/⌘+Enter posts.
- Turn order per channel. Whoever's turn it is gets notified, and posting in character passes the turn on. The writer whose turn it is can pass, and the owner can skip.

**Stories**
- Public (listed in Discover) or private (invite link only).
- Open or closed to new writers.
- Owners can add, rename, reorder and delete channels, and remove writers.

**Notifications**
- Unread badges on stories and channels.
- An alerts page.
- Push notifications to phones and desktops, even when the app is closed. Push contents are end-to-end encrypted.
- Per-story notification level: every post, mentions and turns only, or nothing.

**Safety and privacy**
- **Invite-only sign-up.** The first account becomes the admin. Everyone after that needs an invite code from an admin.
- **No email addresses or phone numbers are collected.** The only personal data is a username and a password hash.
- Uploaded pictures are resized in the browser before upload, which strips hidden photo data like GPS location.
- **Blocking:** a blocked person's posts are hidden for you, they can't notify you, and they can't join stories you own.
- **Reports:** anyone can report a post or a person, and admins get notified.
- **Admin panel:**
  - Handle reports.
  - Delete posts or stories.
  - Suspend people (signs them out and blocks sign-in).
  - Make password-reset links (there's no email, so you pass the link on yourself).
  - Create and revoke invites.
  - A moderation log of admin actions.
- Admins can't read private stories. They only see titles, plus any posts reported to them.
- Search engines are told not to index the site.

## Running it on your computer

You need **Node.js 22.5 or newer**. There are no packages to install.

```bash
npm start      # then open http://localhost:3000
npm test       # run the automated tests
```

The first account you create is the admin. To invite friends, go to **Admin → Invites**.

## Putting it online

For your friends to use it from their own phones, NUUVI has to run on a server with an `https://` address. HTTPS is also required for installing the app and for push notifications. The steps below use **[Fly.io](https://fly.io)**, which works well for a small group. It should cost a few dollars a month, since the server sleeps when nobody is using it, but check Fly's current pricing.

1. Create a Fly.io account and install their `fly` command-line tool ([instructions](https://fly.io/docs/flyctl/install/)), then run `fly auth login`.
2. Pick a name for your site, for example `ourstories`. In `fly.toml`, replace both occurrences of `nuuvi-change-me` with it.
3. From this folder, run:
   ```bash
   fly apps create ourstories
   fly volumes create nuuvi_data --size 1 --region iad   # the database and uploaded pictures live here
   fly deploy --ha=false                                 # one server, because the database is a single file
   ```
4. Open `https://ourstories.fly.dev`. **Create your account first**: the first account becomes the admin.

To update the site later, run `fly deploy` again. Fly takes daily snapshots of the volume. For an extra manual backup, run `fly ssh sftp get /data/nuuvi.db`.

**Any other server:** this works anywhere that runs Docker or Node 22. Run it behind an HTTPS proxy such as [Caddy](https://caddyserver.com), store `DATABASE_PATH` on persistent disk, and set `PUBLIC_URL` and `TRUST_PROXY=1`.

### Settings (environment variables)

| Variable            | Default                  | Purpose |
|---------------------|--------------------------|---------|
| `PORT`              | `3000`                   | HTTP port |
| `DATABASE_PATH`     | `data/nuuvi.db`          | SQLite database file (uploads go in an `uploads` folder next to it) |
| `UPLOAD_DIR`        | next to the database     | Where uploaded pictures are stored |
| `PUBLIC_URL`        | –                        | Your site's address; push services use it as the contact address |
| `NODE_ENV`          | –                        | `production` makes the login cookie HTTPS-only |
| `TRUST_PROXY`       | –                        | `1` when behind a proxy such as Fly or Caddy, so per-person login rate limits work |
| `OPEN_REGISTRATION` | –                        | `1` lets anyone sign up without an invite (not recommended) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | generated once and stored in the database | Push notification keys |

### If you get locked out

These commands run on the server (on Fly, use `fly ssh console` first, then run them from `/app`):

```bash
npm run admin -- make-admin <username>   # make someone an admin again
npm run admin -- reset-link <username>   # print a password reset link
npm run admin -- invite "note"           # print an invite code
```

## Installing the app

- **iPhone/iPad:** in Safari, tap Share → **Add to Home Screen**. Open NUUVI from the Home Screen, then turn on notifications under **You → Settings**. iOS only allows web notifications for home-screen apps.
- **Android:** in Chrome, open the menu → **Install app**.
- **Computer:** click the install icon in Chrome or Edge's address bar.

## How it's built

```
server/
  index.js          starts the server (reads environment variables)
  app.js            HTTP server, live updates (Server-Sent Events), notifications, file serving
  routes/           account.js · stories.js · posts.js · admin.js
  model.js          database row mapping and access checks
  push.js           Web Push encryption and signing (no third-party packages)
  dice.js           dice parser and roller
  db.js             SQLite schema
  admin-cli.js      command-line admin tools
public/
  index.html        app shell
  js/main.js        layout, navigation, router, live connection
  js/lib.js         templating, API calls, formatting, dialogs
  js/views/         one file per screen
  sw.js             offline shell and push notifications
test/               API and unit tests (node:test)
```
