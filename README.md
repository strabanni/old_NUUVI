# NUUVI

A private, invite-only writing home for a roleplay group. It's a **website** and an **installable app** (phone and desktop) from one codebase, laid out like Discord:

- **Story rail** (left): each story is like a server.
- **Channels**: the scenes inside each story.
- **Feed**: long-form, forum-style posts.
- **Members panel** (right): who's in the story, plus its cast of characters.

On phones the story rail stays on screen at all times, like Discord, with your shortcuts at its bottom. Tap a story (or ☰, or swipe right) and its channels slide out beside the rail. The members list slides in from the right. There is no bottom bar.

## Features

**Writing**
- In-character posts (with the character's picture and color), narration, and OOC chat.
- Formatting:
  - `*actions*`, `**bold**`, `__underline__`, `~~strike~~`
  - `||spoilers||`
  - `"dialogue"`
  - `@mentions`
  - **Add-on codes** for building your own post layouts: `[center]`, `[right]`, `[box]`, `[h]`, `[hr]`, `[color=#hex]`, `[size=small|big|huge]`, `[caps]`, `[b] [i] [u] [s]`, `[img]link[/img]`, `[url=link]text[/url]`. The full list is under **+ → Formatting guide** in the composer.
- **No length limit** on posts (technically capped at about 170,000 words, to protect the server).
- **Pictures in any channel:** attach uploads or picture links to messages in comms, OOC and threads.
- **Replies** in comms and OOC chats: reply to a message and it's quoted above yours (tap the quote to jump to it), and the person you replied to is notified.
- Content warnings on stories (readers confirm before entering) and on single posts (tap to reveal).
- Drafts save automatically per channel, and word counts show as you type. Ctrl/⌘+Enter posts.
- **Stars:** star any post to bookmark it, then jump back to it from ★ at the top of the thread. Stars are private to you.
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

**Look and feel**
- **Pink (`#EE719E`) only on the brand touches:** the logo and "nuuvi" wordmark, the "···" in the top strip, your name and numbers in the greeting, and the ring on the selected item in the left rail. Everything else (buttons, tabs, badges, icons, chat bubbles, writing) follows Light or Dark: whites and greys with darkish-grey (`#48484A`) buttons and icons, or true blacks and dark greys with light-grey (`#B0AEAE`) ones. Light and Dark share the same pink logo.
  - **Light:** whites and light greys (`#FFFFFF` / `#F5F5F5` / `#B0AEAE`).
  - **Dark:** true blacks and dark greys (`#0E0E0F` / `#48484A`).
  - **Neutral light** and **Neutral dark:** the same, without the pink brand touches (grey logo; characters' and stories' own colors stay).
  - **Auto** (the default): Light or Dark, following the device.
  - Chat bubbles and the writing itself are never pink: they use the theme's greys and text colors, plus each character's own chosen color for their AKA highlights and formatted words.
- **Text size:** Normal, Large or Larger, under **You → Settings**. Post text is never justified.
- **Interface size (phones and tablets):** Compact (the default, about Discord's scale), Standard or Large, under **You → Settings**.
- **Greetings:** the "Welcome back" line changes: a hello on your first visit, "long time no see" after a while away, time-of-day greetings, and the odd quirky one.
- The device's own sans-serif font (San Francisco on iPhone and Mac). No web fonts are downloaded.
- **User bar (Blue Hour style):**
  - **Computer:** across the top.
  - **Phone:** runs vertically down the slide-out drawer.
  - **Shows:** your avatar, "Welcome back", your stats, and shortcuts (light/dark, feed, alerts, characters, settings, sign out).
- **Threads:** plain forum-style posts without a frame, so writers can format them their own way. Each post shows the character's name in capitals, an "aka" line the owner writes, avatar, star button, and a "for …" footer. Names switch sides automatically each time a different writer posts. Bold, italic, underlined and quoted words take the character's own color. Comms and OOC channels read like text messages.
- **Comms icons:** each comms thread can have its own icon, an emoji or a picture, to show which app it's in (texts, DMs, socials…).
- **Comms titles are personal:** each person sets their own contact names for the other characters, so the chat is titled with whatever you saved them as.
- **Character profiles (Instagram style):** an optional full-width banner, a rounded-square picture, posts/followers/following/threads counts, a verified badge, bio, and tabs for recent posts, threads and details. Owners can set the follower and following numbers shown, for celebrity characters.
- **Character cards** show the character only; a writer's own page lists their characters.

**Threads & feed**
- Each story's channels are typed: **thread**, **self para** (solo writing), **comms** (texts), **event** (with a date) and **OOC**.
- Any writer can start a thread or comms. Story owners make events and OOC channels.
- **Threads can be:**
  - **Open:** anyone in the story can write.
  - **Private:** only the tagged characters can write.
  - **Complete:** read-only.
- **A thread can have:** a starring character, tagged characters (who get notified), a plot summary and tags.
- **The feed** shows only open threads, self paras, character social posts and events. Filters: all, open threads, self paras, social, events and mine. You can also search.
- **Character social posts:** text, photos, videos, voice notes (record in the app or upload) and streams, with likes and comments made as a character. Any post can carry a song (title, artist and an optional link), shown under the character's name like on Instagram.
- **Feed layout:** a brick wall. Each card is as tall as its content and they pack together in order, in columns on computers and two columns on phones.
- **Events page:** upcoming events as cards or as a month calendar.
- Characters follow other characters, and their owners get notified.
- **Directory:** every writer by username, each with their whole cast, or every character A–Z. Searchable.

**Safety and privacy**
- **A quiet sign-in page:** just the logo and the form, nothing that describes the site.
- **Usernames** can use any letters, symbols or emoji at any length (up to 100 characters). They can't have spaces, which would break @mentions; display names can. Slurs and explicit words are turned away, and names are unique regardless of capitals.
- **Invite-only sign-up.** The first account becomes the admin. Everyone after that needs an invite code from an admin.
- **No email addresses or phone numbers are collected.** The only personal data is a username and a password hash.
- Uploads are checked by their actual file contents, and each person has 2 GB of storage.
- **Picture links:** anywhere you can upload a picture you can also paste a link to one (Pinterest, Tumblr, Imgur…). Links must be `https://`. The site hosting a linked picture can see the internet address of whoever views it, the same as on any forum; uploads don't have that issue.
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
  routes/           account.js · stories.js · threads.js · social.js · posts.js · admin.js
  model.js          database row mapping and access checks
  push.js           Web Push encryption and signing (no third-party packages)
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
