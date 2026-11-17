/**
 * The CrazyGames submission assets, rendered from the game itself:
 *   covers: 1920x1080 (16:9), 800x1200 (2:3), 800x800 (1:1), with only the title as text;
 *   preview videos: an 18 s action montage of fast cuts (no sound), 1920x1080 and 1080x1620.
 * The game runs in a dev server with ?autopilot (your car drives itself) and is
 * stepped a frame at a time, so the footage is smooth however slow this machine is.
 *
 * The montage: a race is simulated (a full field, damage on), and its replay
 * gives its passes and contacts, each filmed for 1.3 s, cutting between the TV
 * and chase cameras; plus the live launch from the grid, a rain race, a track
 * drawn in the editor, and the whole field away from the start to finish.
 *
 *   node scripts/crazygamesAssets.mjs [outDir] [covers|videos|all] [scale]
 * (scale < 1 renders a quick small draft, e.g. 0.33.)
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const out = resolve(process.argv[2] ?? 'dist/crazygames-assets');
const what = process.argv[3] ?? 'all';
const scale = Number(process.argv[4] ?? 1);
const port = 5390;
const TITLE = 'Track Builder 3D';
const FPS = 30;
/** The race filmed for the replay shots, and the one in the rain. */
const RACE_TRACK = 'world-at-1969';
const RAIN_TRACK = 'world-mc-1929';
mkdirSync(out, { recursive: true });

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'web', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
const executablePath = process.env.PW_CHROMIUM || undefined;
let browser;

const TITLE_CSS =
  '#ui.clean { display: none !important; } .studio-welcome { display: none !important; } * { cursor: none !important; } .cover-title { position: fixed; left: 0; right: 0; top: 6%; text-align: center; font: 900 clamp(2rem, 8.5vmin, 7rem)/1 system-ui, sans-serif; color: #ffd34d; letter-spacing: 0.01em; -webkit-text-stroke: 0.035em #14182a; paint-order: stroke fill; text-shadow: 0 0.06em 0 #14182a, 0 0.12em 0.3em rgba(0,0,0,0.45); z-index: 10; pointer-events: none; }';

/** A page with the game, its frames stepped by hand (window.__step). */
async function gamePage(width, height) {
  const page = await browser.newPage({ viewport: { width: Math.round(width * scale), height: Math.round(height * scale) }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    const pending = [];
    let t = 0;
    window.requestAnimationFrame = (cb) => pending.push(cb);
    window.__step = (ms) => {
      t += ms;
      for (const cb of pending.splice(0)) cb(t);
    };
    localStorage.setItem('inkcircuit.settings', JSON.stringify({ played: true, graphics: 'full', graphicsChosen: true, muted: true, tower: 'off', camera: 'chase' }));
  });
  await page.goto(`http://127.0.0.1:${port}/?autopilot`);
  await page.waitForFunction(() => window.__game, null, { polling: 200, timeout: 60000 });
  await page.addStyleTag({ content: TITLE_CSS });
  await page.evaluate(() => document.getElementById('ui').classList.add('clean'));
  return page;
}

/** Starts a race on track `id` (the setup patched by `patch`). */
async function race(page, id, patch) {
  await page.evaluate(
    async ([id, patch]) => {
      const g = window.__game;
      const { builtInTracks } = await import('/src/editor/pipeline.ts');
      g.setTrack(builtInTracks().find((b) => b.def.id === id).track());
      g.start({ mode: 'race', ghost: false, tyreWear: false, safetyCar: false, ...patch });
    },
    [id, patch],
  );
  await step(page, 2);
}

/** Moves the game on `n` frames of 1/60 s, without saving any. */
const step = (page, n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.__step(1000 / 60); }, n);

const setTitle = (page, opacity) =>
  page.evaluate(([text, o]) => {
    let el = document.querySelector('.cover-title');
    if (!el) {
      el = Object.assign(document.createElement('div'), { className: 'cover-title', textContent: text });
      document.body.append(el);
    }
    el.style.display = o > 0 ? '' : 'none';
    el.style.opacity = String(o);
  }, [TITLE, opacity]);

/** The film: frames saved in order, FPS a second (two 1/60 s game frames each). */
class Film {
  constructor(dir) {
    this.dir = dir;
    this.n = 0;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
  /** `seconds` of `page` running, with `each(t)` before each frame (t: seconds into the shot). */
  async shoot(page, seconds, each) {
    const frames = Math.round(seconds * FPS);
    for (let k = 0; k < frames; k++) {
      if (each) await each(k / FPS);
      await step(page, 60 / FPS);
      await page.screenshot({ path: join(this.dir, `${String(this.n++).padStart(4, '0')}.png`) });
    }
  }
}

/** The cameras for the replay shots, in turn (a different one each cut). */
const CAMS = ['tv', 'chase'];
/** Seconds per replay shot. */
const SHOT = 1.3;

/** Simulates the whole race already started on `page` (no frames drawn), then opens its replay. */
async function simulateAndReplay(page) {
  await page.evaluate(() => {
    const r = window.__game.screens.race;
    let n = 0;
    while (r.session.phase !== 'finished' && n < 120 * 600) {
      r.tick();
      n++;
    }
    while (r.stillRacing() && n < 120 * 800) {
      r.tick();
      n++;
    }
  });
  // (The results, and the finished recording, come a few frames later.)
  for (let i = 0; i < 60 && !(await page.evaluate(() => !!window.__game.lastReplay)); i++) await step(page, 30);
  return page.evaluate(() => {
    const g = window.__game;
    g.watchReplay('menu');
    const rs = g.screens.replay;
    rs.setMode('full');
    rs.playing = true;
    rs.speed = 1;
    document.getElementById('ui').classList.add('clean');
    return g.lastReplay.events.map((e) => ({ kind: e.kind, t: e.t, car: e.cars[0], weight: e.weight }));
  });
}

/** Points to draw a track with in the editor: a lumpy loop round the middle of the paper (world m). */
function loop(n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 1 + 0.28 * Math.sin(3 * a) + 0.12 * Math.cos(5 * a);
    pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.62]);
  }
  return pts;
}

async function montage(name, width, height) {
  const film = new Film(join(out, `${name}-frames`));
  // 1. The launch from the grid (live, chase camera), with the title over the first moment.
  const live = await gamePage(width, height);
  await race(live, RACE_TRACK, { opponents: 11, difficulty: 85, grid: 'random', damage: true, time: 'sunset' });
  await step(live, 60 * 2.5);
  await film.shoot(live, 2, (t) => setTitle(live, t < 0.8 ? 1 : Math.max(0, 1 - (t - 0.8) / 0.4)));
  await setTitle(live, 0);
  // 2. The rest of that race, simulated; its passes and contacts (at least 3 s apart, the weightiest first) are the shots.
  const events = await simulateAndReplay(live);
  const moments = [];
  for (const e of events.filter((e) => e.kind === 'pass' || e.kind === 'contact').sort((a, b) => b.weight - a.weight)) {
    if (moments.every((m) => Math.abs(m.t - e.t) >= 3)) moments.push(e);
  }
  moments.sort((a, b) => a.t - b.t);
  const start = events.find((e) => e.kind === 'start');
  let cut = 0;
  const replayShot = async (m, cam, seconds, before = 0.7) => {
    await live.evaluate(
      ([t, car, cam]) => {
        const rs = window.__game.screens.replay;
        rs.seek(Math.max(0, t));
        rs.follow = car;
        rs.setCam(cam);
        rs.playing = true;
      },
      [m.t - before, m.car, cam],
    );
    await film.shoot(live, seconds);
  };
  const next = async () => {
    const m = moments[cut % Math.max(1, moments.length)];
    // (Each shot starts a second before its moment, as the cars close in.)
    if (m) await replayShot(m, CAMS[cut % CAMS.length], SHOT, 1);
    cut++;
  };
  await next();
  await next();
  await next();
  // 3. Rain: a pack in the spray (live, chase camera).
  const rain = await gamePage(width, height);
  await race(rain, RAIN_TRACK, { opponents: 7, difficulty: 85, grid: 'pick', startSlot: 6, damage: true, weather: 'rain', time: 'day' });
  await step(rain, 60 * 7);
  await film.shoot(rain, 1.5);
  await rain.close();
  await next();
  await next();
  // 4. The editor: a track drawn in one stroke.
  const ed = await gamePage(width, height);
  await ed.evaluate(() => {
    document.getElementById('ui').classList.remove('clean');
    window.__game.go('editor');
  });
  await step(ed, 10);
  await ed.evaluate(() => window.__game.screens.editor.clear());
  await step(ed, 10);
  const pts = loop(42);
  const box = await ed.evaluate(() => {
    const r = window.__game.surface.canvas.getBoundingClientRect();
    return { x: r.left + r.width * 0.55, y: r.top + r.height * 0.55, rx: r.width * 0.28, ry: r.height * 0.36 };
  });
  const at = (k) => ({ x: box.x + pts[k][0] * box.rx, y: box.y + (pts[k][1] / 0.62) * box.ry });
  await ed.mouse.move(at(0).x, at(0).y);
  await ed.mouse.down();
  let k = 0;
  await film.shoot(ed, 1.4, async () => {
    for (let j = 0; j < 2 && k < pts.length - 1; j++) {
      k++;
      await ed.mouse.move(at(k).x, at(k).y, { steps: 2 });
    }
  });
  await ed.mouse.up();
  await ed.close();
  // 5. More racing, then the whole field away from the start (TV camera), with the title.
  await next();
  await next();
  await next();
  const left = 18 - film.n / FPS;
  if (start && left > 0) {
    await live.evaluate(([t, car]) => {
      const rs = window.__game.screens.replay;
      rs.seek(Math.max(0, t));
      rs.follow = car;
      rs.setCam('tv');
      rs.playing = true;
    }, [start.t + 0.8, start.car]);
    await film.shoot(live, left, (t) => setTitle(live, Math.min(1, Math.max(0, (t - 0.2) / 0.4))));
  } else if (left > 0) await film.shoot(live, left, (t) => setTitle(live, Math.min(1, t / 0.4)));
  await live.close();
  // Encode, trimmed to exactly 18 s.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(film.dir, '%04d.png'), '-t', '18', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-an', '-movflags', '+faststart', join(out, `${name}.mp4`)]);
  rmSync(film.dir, { recursive: true, force: true });
  console.log('video', name, film.n, 'frames,', moments.length, 'moments');
}

try {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ executablePath, args: ['--enable-unsafe-swiftshader', '--no-sandbox'] });
  if (what === 'covers' || what === 'all') {
    for (const [name, w, h] of [['cover-landscape-1920x1080', 1920, 1080], ['cover-portrait-800x1200', 800, 1200], ['cover-square-800x800', 800, 800]]) {
      const page = await gamePage(w, h);
      await race(page, 'world-be-1925', { opponents: 7, difficulty: 80, grid: 'pick', startSlot: 6, damage: false, time: 'sunset' });
      await step(page, 60 * 9);
      await setTitle(page, 1);
      await page.screenshot({ path: join(out, `${name}.png`) });
      console.log('cover', name);
      await page.close();
    }
  }
  if (what === 'videos' || what === 'all') {
    await montage('preview-landscape-1920x1080', 1920, 1080);
    await montage('preview-portrait-1080x1620', 1080, 1620);
  }
} finally {
  await browser?.close();
  server.kill();
}
