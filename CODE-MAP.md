# NUUVI code map

A guide to where everything lives, in plain words. If you want to change something, find it in
**"I want to change…"** below and open that file.

## The three big folders

| Folder | What's in it |
|---|---|
| `server/` | The part that runs on the computer in the cloud (Fly.io). It keeps the database, checks who's allowed to do what, and answers the app's requests. |
| `public/` | The part that runs in your browser or phone: every screen, button and style. |
| `test/` | Automatic checks. `npm test` runs them all, and they run by themselves before every deploy. |

## I want to change…

| …this | Open this file |
|---|---|
| How a character's page looks (banner, picture, bio, tabs) | `public/js/views/characters.js` |
| The Ties chart or the Timeline | `public/js/views/world.js` (screen) and `server/routes/world.js` (saving) |
| The About tab and "Edit profile details" | `public/js/views/profiles.js` (screen) and `server/routes/profiles.js` (saving) |
| THE NU feed | `public/js/views/nu.js` |
| Posts, likes and comments on THE NU | `public/js/views/social.js` (screen) and `server/routes/social.js` (saving) |
| Stories (the circles at the top of THE NU) | `public/js/views/stories.js` and `server/routes/social-stories.js` |
| Character phones (texts, calls, contacts) | `public/js/views/phone.js` and `server/routes/phone.js` |
| Messages between writers | `public/js/views/messages.js` and `server/routes/messages.js` |
| Notifications | `public/js/views/notifications.js` (screen), `server/app.js` (how each one is worded and where it links) |
| Episodes and story chats | `public/js/views/channel.js`, `public/js/views/threads.js`, `server/routes/threads.js`, `server/routes/posts.js` |
| Home | `public/js/views/home.js` |
| Directory, Supporting Cast and Locations | `public/js/views/directory.js`, `npcs.js`, `map.js` |
| The Development hub (plot points, ideas, storylines) | `public/js/views/dev.js` (screen) and `server/routes/dev.js` (saving) |
| Calendar events and plans | `public/js/views/events.js`, `plans.js` |
| Settings and user profiles | `public/js/views/people.js` |
| Admin tools | `public/js/views/admin.js` and `server/routes/admin.js` |
| Colours, sizes, spacing, anything visual | `public/styles.css` (it starts with a numbered table of contents; search for `§` plus a number) |
| The icons | `public/js/lib.js`, in the `icons` list |
| The side menu, the rail and page switching | `public/js/main.js` |
| What's new (the update notes people see) | `public/changelog.json` (newest first) |
| The version number | `APP_BUILD` in `public/js/main.js`, and `CACHE` in `public/sw.js` (bump both together) |
| The database tables | `server/db.js` (add a new step at the end of `MIGRATIONS` and raise `SCHEMA_VERSION`) |
| Things Claude writes (fan comments, recaps, translations) | `server/ai.js`, `server/ai-buzz.js`, `server/routes/ai.js` |
| Songs that play on posts | `server/songs.js` (finding the preview) and `songLine` in `public/js/views/social.js` (the speaker button) |
| Photo batches (supporting cast posting by themselves) | `public/js/views/batches.js` (screen) and `server/routes/batches.js` (saving and posting) |

## Every file, one line each

### `server/`

| File | What it does |
|---|---|
| `index.js` | Starts NUUVI. |
| `app.js` | Builds the web server: files, the API, live updates, notifications and push. |
| `db.js` | The database tables and every change to them over time. |
| `model.js` | Turns database rows into what the app sees, and checks who can see what. |
| `http.js` | Small helpers: errors, checking what people typed, the router. |
| `auth.js` | Passwords and sign-in sessions. |
| `clock.js` | The date in Ardell City (real, fixed, or moving on a timer). |
| `text.js` | Turns posts into plain text, and capitalizes character names. |
| `names.js` | Username rules. |
| `profile.js` | Checks the free-form profile fields. |
| `push.js` | Phone and computer push notifications. |
| `ai.js` | The one place NUUVI talks to Claude. |
| `ai-buzz.js` | Fan comments written by Claude. |
| `buzz.js` | Built-in fan comments (used when Claude is off). |
| `bots.js` | Automatic NPCs that comment and post. |
| `songs.js` | Finds a 30-second preview of a post's song on Apple Music. |
| `ardell.js` | The Ardell City guide (boroughs and places). |
| `admin-cli.js` | Admin tools you run from the command line if you're locked out. |
| `routes/account.js` | Accounts, characters, uploads, notifications. |
| `routes/stories.js` | Stories, their members and turn order. |
| `routes/threads.js` | Episodes and channels inside a story. |
| `routes/posts.js` | Posts inside episodes, and reports. |
| `routes/social.js` | THE NU: posts, likes, comments, follows, polls. |
| `routes/social-stories.js` | Stories (the circles) on THE NU. |
| `routes/phone.js` | Character phones: contacts, texts, groups, calls. |
| `routes/messages.js` | Messages between writers. |
| `routes/profiles.js` | Character profiles (About tab). |
| `routes/world.js` | Ties (with their colours), the family-tree chart and the Timeline. |
| `routes/dev.js` | The Development hub: plot points, ideas and storylines, with comments. |
| `routes/batches.js` | Photo batches: pictures supporting cast post by themselves every few days. |
| `routes/events.js` | Calendar events. |
| `routes/plans.js` | Character plans on the calendar. |
| `routes/places.js` | Locations in Ardell City. |
| `routes/connections.js` | Connections (writers looking for partners for their muse). |
| `routes/overview.js` | The lore page. |
| `routes/ai.js` | "Check my writing", translations and recaps. |
| `routes/admin.js` | Moderation for admins. |

### `public/`

| File | What it does |
|---|---|
| `index.html` | The page the app lives in. |
| `styles.css` | Every style, with a table of contents at the top. |
| `sw.js` | Lets the app open offline and receive push notifications. |
| `changelog.json` | The update notes. |
| `js/main.js` | The app's frame: menus, rail, page switching, live updates. |
| `js/lib.js` | Shared helpers: building HTML safely, talking to the server, icons, menus, pop-up windows, uploads. |
| `js/theme.js` | Light/dark mode and interface size, applied before the page shows. |
| `js/weather.js` | The made-up but steady weather in Ardell City. |
| `js/citymap.js` | The drawn map of Ardell City. |
| `js/lore-preset.js` | Ready-made lore you can load into a story. |
| `js/views/…` | One file per screen (see "I want to change…" above). |

## How to check your changes

1. `npm test` runs every automatic check.
2. `npm run format` tidies the layout of the code (spacing, line breaks) so every file looks the same.
   `npm run format:check` only checks without changing anything.
3. `npm run dev` runs NUUVI on your computer and restarts it when you save a file.
