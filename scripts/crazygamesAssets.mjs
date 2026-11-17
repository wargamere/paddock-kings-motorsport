/**
 * The CrazyGames submission assets, rendered from the game itself:
 *   covers: 1920x1080 (16:9), 800x1200 (2:3), 800x800 (1:1), with only the title as text;
 *   preview videos: 18 s, 1920x1080 and 1080x1620, no sound (needs ffmpeg).
 * The game runs in a dev server with ?autopilot (your car drives itself) and is
 * stepped a frame at a time, so the footage is smooth however slow this machine is.
 *
 *   node scripts/crazygamesAssets.mjs [outDir] [covers|videos|all]
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const out = resolve(process.argv[2] ?? 'dist/crazygames-assets');
const what = process.argv[3] ?? 'all';
const port = 5390;
const TITLE = 'Track Builder 3D';
const TRACK = 'world-be-1925';
const FPS = 30;
mkdirSync(out, { recursive: true });

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'web', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
const executablePath = process.env.PW_CHROMIUM || undefined;
let browser;

/** A page with the game racing on TRACK, its frames stepped by hand. */
async function racingPage(width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    // Hand-stepped frames: requestAnimationFrame callbacks wait for __step().
    const pending = [];
    let t = 0;
    window.requestAnimationFrame = (cb) => pending.push(cb);
    window.__step = (ms) => {
      t += ms;
      const now = pending.splice(0);
      for (const cb of now) cb(t);
    };
    localStorage.setItem('inkcircuit.settings', JSON.stringify({ played: true, graphics: 'full', graphicsChosen: true, muted: true, tower: 'off' }));
  });
  await page.goto(`http://127.0.0.1:${port}/?autopilot`);
  await page.waitForFunction(() => window.__game, null, { polling: 200, timeout: 60000 });
  await page.evaluate(async (id) => {
    const g = window.__game;
    const { builtInTracks } = await import('/src/editor/pipeline.ts');
    g.setTrack(builtInTracks().find((b) => b.def.id === id).track());
    g.start({ mode: 'race', opponents: 7, difficulty: 80, grid: 'pick', startSlot: 6, ghost: false, weather: 'dry', time: 'sunset', tyreWear: false, damage: false, safetyCar: false });
  }, TRACK);
  // Clean shots: no HUD, no cursor.
  await page.addStyleTag({ content: '#ui { display: none !important; } * { cursor: none !important; } .cover-title { position: fixed; left: 0; right: 0; top: 6%; text-align: center; font: 900 clamp(2.4rem, 8.5vmin, 7rem)/1 system-ui, sans-serif; color: #ffd34d; letter-spacing: 0.01em; -webkit-text-stroke: 0.035em #14182a; paint-order: stroke fill; text-shadow: 0 0.06em 0 #14182a, 0 0.12em 0.3em rgba(0,0,0,0.45); z-index: 10; pointer-events: none; }' });
  return page;
}

/** Runs the game on `seconds` of frames (1/60 s each). `each` is called every 1/FPS s. */
async function run(page, seconds, each) {
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) {
    await page.evaluate(() => window.__step(1000 / 60));
    if (each && i % (60 / FPS) === 1) await each(Math.floor(i / (60 / FPS)));
  }
}

const setTitle = (page, on, opacity = 1) =>
  page.evaluate(([text, show, o]) => {
    let el = document.querySelector('.cover-title');
    if (!el) {
      el = Object.assign(document.createElement('div'), { className: 'cover-title', textContent: text });
      document.body.append(el);
    }
    el.style.display = show ? '' : 'none';
    el.style.opacity = String(o);
  }, [TITLE, on, opacity]);

try {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ executablePath, args: ['--enable-unsafe-swiftshader', '--no-sandbox'] });
  // Into the race: the start, then a few seconds in the pack.
  const LEAD = 9;
  if (what === 'covers' || what === 'all') {
    for (const [name, w, h] of [['cover-landscape-1920x1080', 1920, 1080], ['cover-portrait-800x1200', 800, 1200], ['cover-square-800x800', 800, 800]]) {
      const page = await racingPage(w, h);
      await run(page, LEAD);
      await setTitle(page, true);
      await page.screenshot({ path: join(out, `${name}.png`) });
      console.log('cover', name);
      await page.close();
    }
  }
  if (what === 'videos' || what === 'all') {
    for (const [name, w, h] of [['preview-landscape-1920x1080', 1920, 1080], ['preview-portrait-1080x1620', 1080, 1620]]) {
      const page = await racingPage(w, h);
      await run(page, LEAD);
      const dir = join(out, `${name}-frames`);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      // 18 s: it opens on the cover (the title, fading out over the first 1.5 s), then racing.
      await setTitle(page, true);
      await run(page, 18, async (k) => {
        const t = k / FPS;
        if (t < 1.5) await setTitle(page, true, t < 0.8 ? 1 : 1 - (t - 0.8) / 0.7);
        else if (t < 1.6) await setTitle(page, false);
        await page.screenshot({ path: join(dir, `${String(k).padStart(4, '0')}.png`) });
      });
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, '%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-an', '-movflags', '+faststart', join(out, `${name}.mp4`)]);
      rmSync(dir, { recursive: true, force: true });
      console.log('video', name);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  server.kill();
}
