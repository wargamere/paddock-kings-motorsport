# Track Builder 3D: CrazyGames launch kit

Everything for submitting the game on the [CrazyGames Developer Portal](https://developer.crazygames.com/), in the order the portal asks for it.

## 1. The build

| Launch | Command | Upload |
|---|---|---|
| **Basic Launch** (first; no ads) | `npm run package:cg` | `dist/crazygames/index.html` |
| **Full Launch** (when CrazyGames invites you; ads on) | `npm run package:cg:ads` | `dist/crazygames/index.html` (rebuilt with ads on) |

Each command builds the game as **one self-contained `index.html`**: the game's code is inline in it, and the third-party notices are in a comment at the top. It also checks it against CrazyGames' limits, and writes a zip of it (`dist/track-builder-3d-crazygames-basic.zip` / `-full.zip`) in case the portal asks for one. The build is about 1 MB in one file, against limits of 50 MB initial download, 250 MB total and 1,500 files. That's small enough for the mobile homepage (20 MB). Before packaging, put the Supabase project details in `.env` (see [`../supabase/README.md`](../supabase/README.md)) so the zip includes cloud saves.

## 2. Store text (copy and paste)

**Title:** Track Builder 3D

**Short description:** Draw any racetrack you can imagine, then race it in 3D against AI rivals.

**Description:**

> Track Builder 3D lets you design a racetrack in seconds and race it straight away. Sketch a loop freehand or place it dot by dot. Then shape it with hills, banked corners, bridges and tunnels, kerbs, gravel traps, barriers and grandstands. Hit Race and you're on the grid against up to 11 AI drivers, who find the fastest line round whatever you've built.
>
> Not feeling creative? Pick one of 23 ready-made tracks or 30 circuit layouts inspired by famous racetracks. Or let the generator make a Grand Prix, street circuit, oval or kart track for you.
>
> **Features**
> - A draw-and-race track editor: freehand or dots, hills, banking, bridges or tunnels, run-off, barriers, scenery and weather-proof roads (tarmac, dirt or snow)
> - A career as a team owner: hire staff, develop the car and both drivers, take team decisions, face the press after big races and build a rivalry with the team that's closest to you, season after season. Knockout qualifying, sprint races and the real points system
> - Race up to 11 AI cars that take racing lines, slipstream and battle wheel to wheel
> - Races of 1 to 50 laps, with tyre wear and pit stops through a real pit lane with a 60 km/h limiter
> - DRS zones and an overtake boost, a race engineer on the radio, AI drivers with their own personalities and mistakes
> - Two players on one keyboard, split screen
> - Damage (wreck the car and you're out of the race), yellow flags and a safety car that bunches the field up
> - Rain, changing weather (from drizzle to heavy rain, with intermediate and wet tyres) and night races
> - Car setup: wing, gears and brake balance
> - A live timing tower, a ghost of your best lap, and medals for every track
> - Share any track with a short code

**Controls:**

> **Driving:** W / ↑ accelerate · S / ↓ brake and reverse · A D / ← → steer · E / Q shift up / down (manual gears) · R back onto the track · C camera · T timing tower · 1–5 choose tyres in the pits · P pause (or Esc) · M sound. Every key can be changed under Controls. Gamepads work too, and phones and tablets get on-screen controls.
>
> **Editor:** drag to draw a loop, or click to place dots · drag dots to reshape · scroll or pinch to zoom · Z undo · Y redo · V 3D view · Enter race your track.

**Category:** Driving (racing). **Suggested tags:** Car, Racing, 3D, Building, Drawing, Level editor, AI.

## 3. Submission form answers

| Question | Answer |
|---|---|
| Engine / technology | HTML5 (JavaScript, Three.js) |
| Devices | Desktop and mobile (touch controls on phones and tablets) |
| Orientation | **Landscape** (CrazyGames asks mobile players to rotate; the game has no lock of its own) |
| Multiplayer | No |
| Progress save | **Yes, using the Data Module.** That's the only place saves go: the CrazyGames build talks to no server of its own. |
| Account integration | CrazyGames accounts only: the username labels your ghost car, and saves follow the account. No other login. |
| In-game purchases | No |
| Ads | Basic Launch: none. Full Launch: midgame ads at natural breaks ("Race again" on the results screen) and an optional rewarded ad to unlock a paint colour early (paints also unlock by playing). |
| Language | English |
| Content | Racing, no violence; suitable for PEGI 12 |
| Third-party content | Circuit outlines from bacinger/f1-circuits and the three.js library (both MIT licence); their notices ship in a comment at the top of `index.html`. Tracks are named after places only, with no series or circuit brands. |

## 4. Covers and videos

| File | Size | Where |
|---|---|---|
| `covers/cover-landscape.jpg` | 1920 × 1080 (16:9) | Landscape cover |
| `covers/cover-portrait.jpg` | 800 × 1200 (2:3) | Portrait cover |
| `covers/cover-square.jpg` | 800 × 800 (1:1) | Square cover |
| `preview-landscape-1920x1080.mp4` | 1920 × 1080 (16:9), 18 s | Landscape preview video |
| `preview-portrait-1080x1620.mp4` | 1080 × 1620 (2:3, as the portal asks), 18 s | Portrait preview video |

The covers show real in-game footage plus the title only: no other text, icons, store logos or borders, as the cover rules ask. The videos are an action montage of real gameplay, cut every 1–2 seconds: the launch from the grid (with the title), wheel-to-wheel passes and contacts from the TV and chase cameras, a pack in the rain, a track drawn in the editor in one stroke, and the whole field away from the start with the title to finish. No sound, no fast-forward, no mouse cursor, no black bars or logo screens. Render them with `node scripts/crazygamesAssets.mjs <outDir> videos` (they're not kept in the repository).

**Alternative covers:** `covers/alt/cover-sunset-*.jpg` (the same three sizes): a sunset pack of cars into a corner. **Re-rendering covers and videos** from the game: `PW_CHROMIUM=<chromium> node scripts/crazygamesAssets.mjs <outDir> [covers|videos|all]` (needs ffmpeg for the videos). It steps the game a frame at a time, so the footage is smooth on any machine.

## 5. Requirements checklist

| Requirement (CrazyGames docs) | Status |
|---|---|
| Initial download ≤ 50 MB (≤ 20 MB for the mobile homepage), total ≤ 250 MB, ≤ 1,500 files | ✅ about 1 MB, one file |
| `index.html` at the zip's root, relative paths | ✅ checked by `scripts/size.mjs` |
| Gameplay start / stop events | ✅ start when driving begins or resumes; stop on pause, menus, editor and results (checked against the SDK in local mode) |
| Loading start / stop | ✅ from SDK init to the first rendered frame |
| No custom fullscreen button | ✅ none |
| Legible at 907×510, 1216×684, 1077×606, 1920×1080, 1280×720 and 800×450 (mobile) | ✅ the browser checks cover desktop and phone sizes |
| Same physics at any refresh rate | ✅ fixed 120 Hz physics (tested at 60, 144 and 240 Hz) |
| English | ✅ |
| PEGI 12 | ✅ no violence |
| No external ads; ads only via the SDK; game paused and muted during ads; nothing given on an ad error; ad-blocker users can play | ✅ (ads only in the Full Launch build) |
| No links to other sites | ✅ the CrazyGames build shows no URLs or links |
| Saves within the Data Module's 1 MB | ✅ ghosts are capped at 450 KB in total |
| Unique, clear name | ✅ "Track Builder 3D": no game with exactly that name found (similar names exist, e.g. "Race Track Builder") |
| New players land in gameplay immediately (at most 1 click) | ✅ a first visit goes straight into a 3-lap race with a "How to drive" card (key caps, or touch hints); later visits open the menu, where **Race this track** starts a race in one click |
| Restricted keys: Esc leaves fullscreen | ✅ pause is **P** (shown in every hint); Esc also pauses, but the game never relies on it |
| Smooth on low-end devices (4 GB Chromebooks) | ✅ if the first seconds of a race run under 28 fps, graphics drop to Fast by themselves (unless you've chosen) |
| No calls to servers of our own | ✅ the CrazyGames build only talks to the CrazyGames SDK |
| Settings and progress kept between visits | ✅ fixed: settings used to be read before the SDK had loaded the save, so they reset every visit |

## 6. Resubmitting (after a rejection)

CrazyGames only looks at a resubmission with clear improvements. Paste this into the notes:

> Changes since the last submission: new players now land straight in a race (no menus), with an on-screen "How to drive" card; from the menu a race is one click away. Pause moved to P (Esc leaves fullscreen). Graphics drop to Fast by themselves on slow devices. Settings and progress now persist between visits through the Data Module (a bug reset them), and the build no longer contacts any server of ours. The menu fits the smallest iframe sizes. New since then: a team-owner career with press conferences and rivalries, DRS and an overtake boost, a race engineer, AI personalities, intermediate tyres and changing rain, and two-player split screen.

## 7. Steps

1. **Sign up** at developer.crazygames.com and finish onboarding. You can choose "hold payments" for now.
2. **Submit a game:** upload `dist/crazygames/index.html`, then fill in the text and answers above.
3. **Preview / QA tool** (in the portal): play a race to the end, try "Race again", pause and resume, open the editor, draw and race a track, mute from the CrazyGames bar, and try on a phone in landscape.
4. **Upload** the three covers and the two videos, then **submit for Basic Launch**.
5. **When invited to Full Launch:**
   - Run `npm run package:cg:ads` and upload the new `dist/crazygames/index.html` as the new version.
