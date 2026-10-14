# NUUVI

A private, invite-only writing home for a roleplay group. It's a **website** and an **installable app** (phone and desktop) from one codebase, laid out like Discord:

- **Story rail** (left): the logo, then Home, the **Archive** and **Profiles**, then your stories. Each story is like a server. Drag story icons to put them in your own order (on phones, hold a story, then slide your finger). Your order is saved to your account; new stories show at the top until you place them.
- **Channels**: the scenes inside each story.
- **Feed**: long-form, forum-style posts.
- **Members panel** (right): who's in the story, plus its cast of characters.

On phones the story rail stays on screen at all times, like Discord, with your shortcuts at its bottom. Tap a story (or ☰, or swipe right) and its channels slide out beside the rail. The members list slides in from the right. There is no bottom bar.

## Features

**Writing**
- In-character posts (with the character's picture and color), narration, and OOC asides.
- Formatting:
  - `*actions*`, `**bold**`, `__underline__`, `~~strike~~`
  - `||spoilers||`
  - `"dialogue"`
  - `@mentions`
  - **Discord-style:** `***bold italic***`, `_italic_`, `` `code` ``, ```` ``` ```` code blocks, `# / ## / ###` headings, `-# small print`, `> quote`, `>>> quote the rest`, `- bullet` and `1. numbered` lists, `[text](https://link)`, and bare links (picture and GIF links, including Giphy and Tenor, show as the picture).
  - **Forum (Jcink) codes** for building your own post layouts: `[center]`, `[left]`, `[right]`, `[align=…]`, `[indent]`, `[box]`, `[h]`, `[hr]`, `[quote=Name]`, `[list][*]…[/list]`, `[code]`, `[color=#hex or name]`, `[highlight=…]`, `[size=small|big|huge or 1–7]`, `[font=Verdana…]` (sans-serif fonts only), `[caps]`, `[b] [i] [u] [s] [strike]`, `[sup] [sub]`, `[spoiler]`, `[img]link[/img]`, `[url=link]text[/url]`. The full list is under **+ → Formatting guide** in the composer.
- **No length limit** on posts (technically capped at about 170,000 words, to protect the server).
- **GIFs:** uploaded GIFs keep moving (up to 15 MB), and GIF links work anywhere a picture link does. A Giphy page link is turned into the GIF itself.
- **Picture viewer:** tapping a picture someone sent opens it full-screen inside NUUVI (swipe or arrows for the others, ✕, Escape or a tap outside to close, and an "Open original" link).
- **Pictures in any channel:** attach uploads or picture links to messages in comms, OOC and threads.
- **Replies** in comms and OOC chats: reply to a message and it's quoted above yours (tap the quote to jump to it), and the person you replied to is notified.
- Content warnings on stories (readers confirm before entering) and on single posts (tap to reveal).
- Drafts save automatically per channel, and word counts show as you type. Ctrl/⌘+Enter posts.
- **Stars:** star any post to bookmark it, then jump back to it from ★ at the top of the thread. Stars are private to you.
- Turn order per channel. Whoever's turn it is gets notified, and posting in character passes the turn on. The writer whose turn it is can pass, and the owner can skip.

**Stories**
- **The lore:** one page about the whole NUUVI world, not tied to any story (sidebar → **Lore**, or the lore card on Home). It opens with the FOYAEN × ENTITY lore built in: a tagline, the world's numbers, a gossip column from the city's anonymous insider (loosely in the spirit of Gossip Girl, Euphoria and Scandal), the intro, numbered sections, and the organizations (conglomerates with their subsidiaries, then independents), each with a gossip line. Cards expand when tapped, and a contents bar jumps between sections. Admins edit it with **Edit** on the Lore page.
- Public (listed in Discover) or private (only the writers in it). Admins can open every writer's stories, private ones too, for moderation. A private story that belongs to an admin stays theirs: other admins see only that it exists and who owns it, until they're added. Owners add writers by username (Story settings → Writers) or with the invite link.
- **Profiles:** every character on NUUVI, NPCs included, can have a detailed profile (the card icon in the left bar, the menu, or **Full profile** on a character): a cover, portrait, signature quote, traits, quick facts (age, pronouns, birthday, job, face claim…), personality, appearance, history, relationships, goals, trivia, loves and hates, a gallery and a playlist. Everyone can read them; the writer (or an admin) edits them. Pronouns set here are what fan comments use.
- **Episodes** can have their own picture (shown at the top and on THE : NU), a season number and a location. In an episode, the **Location** button in the + panel marks where the scene moves to.
- **Archive:** when a story is finished, its owner (or an admin) marks it complete (story menu, or long-press / right-click its icon). It leaves the story list and goes to the **Archive**, a fixed icon under Home that can't be removed. Archived stories stay readable but nobody can post; **Reopen** puts one back. (Inside a story, older OOC and comms channels are under **Old chats**.)
- Open or closed to new writers.
- Owners (and admins) can add, rename, reorder and delete channels (any of them, even the last one; long-press or right-click a channel in the sidebar → Delete), remove writers, and change the story's header picture and icon. Long-press on phones, or right-click on computers, a story icon in the rail, the story name or an episode for quick options (settings, change header picture or icon, edit episode).

**Notifications**
- Unread badges on stories and channels.
- An alerts page.
- Push notifications to phones and desktops, **only while you're away**: no pop-ups while you have NUUVI open in front of you. Push contents are end-to-end encrypted.
- Per-story notification level: every post, mentions and turns only, or nothing.

**Look and feel**
- **Minimal and glassy:** a soft grey canvas (true black in Dark) with clean cards that float on soft shadows, frosted top bar, rail, menus and dialogs, pill buttons and tabs, and small motion: pages ease in, cards lift on hover, character cards tilt toward the pointer, tabs slide.
- **Header pictures:** the main pages (Home, Feed, Events, Directory, Characters, NPCs, Notifications) open with a wide header picture that fades to the next one every few seconds. Admins pick them under **Admin → Headers** (uploads are cropped to the banner's 3:1 shape automatically). Until then, the 16 pictures that ship in `public/headers/` are used, each pre-cropped to 3:1 around its faces and subject so it fills the banner neatly. They load one at a time to spare phone data.
- **Default gradient:** pink to purple (`#EE719E` → `#C79AD8` → `#B8A6DB`) fills anything that has no picture yet: character cards, profile and story covers, event banners and header pictures.
- **Your colors:** under **You & settings → Your colors**, pick your own gradient (presets or 2–3 colors of your own; the NUUVI pink-to-purple by default). It colors your display name everywhere and the writing-style bars on your profile.
- **What's new:** every update has its own code (like `NV-17`, listed in `public/changelog.json`). The first time someone opens NUUVI after an update, a card shows what changed. If an update lands while NUUVI is open, a bar offers to refresh. Settings shows the current code and reopens the card.
- **Home dashboard:** quick actions (new episode, post, event), a tappable "this week" calendar strip with what's coming up, and your latest notifications.
- **Notifications** are sorted into tabs: All, For you, Activity and System.
- **Pink (`#EE719E`) only on the brand touches:** the logo and "nuuvi" wordmark, the "···" in the top strip, your name and numbers in the greeting, and the ring on the selected item in the left rail. Everything else (buttons, tabs, badges, icons, chat bubbles, writing) follows Light or Dark: whites and greys with darkish-grey (`#48484A`) buttons and icons, or true blacks and dark greys with light-grey (`#B0AEAE`) ones. Light and Dark share the same pink logo.
  - **Light:** whites and light greys (`#FFFFFF` / `#F5F5F5` / `#B0AEAE`).
  - **Dark:** true blacks and dark greys (`#0E0E0F` / `#48484A`).
  - **Auto** (the default): Light or Dark, following the device.
  - Chat bubbles and the writing itself are never pink: they use the theme's greys and text colors, plus each character's own chosen color for their AKA highlights and formatted words.
- **Text size:** Normal, Large or Larger, under **You → Settings**. Post text is never justified.
- **Interface size:** makes the whole app smaller or bigger, on phones and computers alike: Smallest, Small, Standard, Large or Largest, under **You → Settings**. Phones start on Small (about Discord's scale), computers on Standard. On phones, including the home-screen app, NUUVI stays inside the safe area (below the clock and battery, above the home bar) and fills the screen. On iPhones, tapping a text box no longer zooms the page in, and the app stays fitted above the keyboard while you type.
- **Greetings:** the "Welcome back" line changes: a hello on your first visit, "long time no see" after a while away, time-of-day greetings, and the odd quirky one.
- The device's own sans-serif font (San Francisco on iPhone and Mac). No web fonts are downloaded.
- **User bar (Blue Hour style):**
  - **Computer:** across the top.
  - **Phone:** runs vertically down the slide-out drawer.
  - **Shows:** your avatar, "Welcome back", your stats, and shortcuts (light/dark, feed, alerts, characters, settings, sign out).
- **Episodes** (what used to be called threads, with a ▷ play icon): plain forum-style posts without a frame, so writers can format them their own way. Each post shows the character's name in capitals, an "aka" line the owner writes, avatar, star button, and a "for …" footer. Names switch sides automatically each time a different writer posts. Bold, italic, underlined and quoted words take the character's own color. The posting time is kept small and quiet: just the time today, or the date before that. Comms and OOC channels read like text messages.
- **Comms sides:** in comms, your character's texts are on the right and everyone else's on the left. If you write both sides of a chat, the character who started it is the sender (right) and your others are receivers (left).
- **Comms icons:** each comms thread can have its own icon, an emoji or a picture, to show which app it's in (texts, DMs, socials…).
- **Comms titles are personal:** each person sets their own contact names for the other characters, so the chat is titled with whatever you saved them as.
- **Usernames for characters:** every character has an @username, made from their name (editable). Their social posts and comments go out under it, and it's the big name on their profile, with their given name above.
- **Character profiles (Instagram style):** an optional full-width banner, a rounded-square picture, posts/followers/following/threads counts, a verified badge, bio, and tabs for recent posts, threads and details. Owners can set the follower and following numbers shown, for celebrity characters.
- **Gradient colors:** new characters start with the NUUVI gradient; instead of one color, a character can use a gradient of 2 or 3 colors (presets or your own). Their writing then picks colors from it: **bold** takes the first color, *actions* the middle, underlines the last, and their dialogue, name and AKA line sweep through the whole gradient.
- **Character cards** show the character only; a writer's own page lists their characters.

**Episodes & THE : NU**
- Each story's channels are typed: **episode**, **self para** (solo writing) and **event** (with a date). Texts happen on the **Phone** and out-of-character talk in **Messages**; new stories no longer get an OOC channel.
- Any writer can start an episode or comms. Story owners make events and OOC channels.
- **Episodes can be:**
  - **Open:** anyone in the story can write.
  - **Private:** only the tagged characters can write.
  - **Complete:** read-only.
- **An episode can have:** a starring character, tagged characters (who get notified), a plot summary and tags.
- **THE : NU** (the feed) is laid out like Instagram: story bubbles of who posted recently, then one column of posts, newest first, in the order they were made (character posts, open episodes, self paras, events and connections). On computers a side panel shows your cast and quick buttons. Posts with several photos show a "1/3" counter and dots; swipe on phones or use the arrows on computers. Double-tap a photo to like it.
- **Connections:** put out an idea for one of your muses (who you're looking for, details, pictures, tags). Connections and episodes on THE : NU are posted by the writer, with the muse or story named underneath. Anyone can **Pick it up** for one of their characters from a dropdown; it then stays on THE : NU, locked, showing who took it. Either side can open it up again.
- **Likes and comments:** a post's likes start from a share of the character's followers (or the number the writer set), and every real like adds one. Fans comment on their own, with lines that fit the post, and more of them when the writer raises the comment number. Characters' names show in their own colors among the fans. Comments can be replied to, show like counts (bigger for famous characters), and have **See translation** when they aren't in English (on-device in recent Chrome, otherwise Google Translate).
- **Picture panel:** the + in story chats, Messages and the Phone opens a panel from the bottom, like Discord: **Camera** and **Photos** tiles (your phone's own camera and photo library; iPhones may ask for permission the first time), your recent NUUVI pictures (tap to pick several, then Add), and a bar with Photos, Link / GIF and, in stories, Warning and Formatting. Websites can't show the whole camera roll inside the page, so the grid shows pictures you've already put on NUUVI.
- **Formatting:** Discord codes, forum (Jcink) codes and simple HTML (<center>, <b>, <i>, <span style="color: …">, <a href>, <img src>, <h1>…) all work. The formatting guide (+ → Formatting) has Copy and Insert buttons and a few ready-made layouts.
- **Settings:** change your username (once every 3 hours) and choose whether **About** shows on your profile.
- **Messages:** private, out-of-character conversations between writers (sidebar → **Messages**, or **Message** on anyone's profile). They replace OOC channels; older OOC and comms channels stay readable under **Archive** in a story. Only the two people can read a conversation.
- **Filters** on THE : NU: all, posts, episodes, connections and events.
- **Character social posts:** text, photos, videos, voice notes (record in the app or upload) and streams, with likes and comments made as a character. The writer can set the like and comment numbers shown on each post (••• → **Set like & comment numbers**), for famous characters. Any post can carry a song (title, artist and an optional link), shown under the character's name like on Instagram.
- **Events:** put events on the calendar (title, start and end, place, details, banner) from the Events page, which shows them as cards or a month calendar. Starting a thread as type **Event** lets you pick one of the story's upcoming events; comms can optionally be part of one too. An event's page lists every thread and comms that's part of it.
- **Phone** (replaces comms; in the main menu, and inside every story under **Texts**, where it opens within the story): every character has a phone (sidebar → **Phone**). Save other characters as contacts under any name you like, then text them one-to-one: pictures, replies and all. Only the two characters' writers can ever read a conversation. It's styled after a modern messaging app, with a soft gradient header, a contact strip and frosted chat bubbles. Change a contact's picture for your phone only (their writer still sees their own), and long-press contacts on phones to rename or change them. The message bar is Discord-style. On computers your contacts and the conversation fill the page side by side, with a deeper gradient behind the contacts.
- **NPCs page:** everyone's NPCs in one place (sidebar → **NPCs**), searchable and sorted into categories their writer picks (like `staff`, `foyaen`, `nightlife`). Open a category and its name shows in capitals with the NUUVI gradient. Anyone can tag any NPC into their episodes, even in stories the NPC's writer isn't in.
- **NPCs:** tick **This is an NPC** on a character for an NPC badge. NPCs can also post and comment **on their own**: give them lines to pick from (with placeholders like `{name}`) and they'll comment on new posts now and then and post every so often. Admins can run an **anonymous gossip account** that also posts tips when public threads start or finish (never about private threads or stories). Admin → **NPCs & bots** controls how often, and can make any of them post right away.
- Characters follow other characters, and their owners get notified.
- **Directory:** every writer by username, each with their whole cast, or every character A–Z. Searchable. The gossip account is listed on its own, never under whoever runs it.
- **Profiles from the menu:** your name in the greeting and at the top of the sidebar opens your profile; writers in the Directory, the online list and a story's member list open theirs.

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
