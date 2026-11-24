import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:5297';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'web', '--host', '127.0.0.1', '--port', '5297', '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready);
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('inkcircuit.settings', JSON.stringify({ played: true, graphics: 'fast', graphicsChosen: true, units: 'kmh' })));
  await page.goto(`${origin}/?autopilot`);
  await page.waitForFunction(() => window.__game);
  const run = await page.evaluate(async () => {
    const { builtInTrack } = await import('/src/editor/pipeline.ts');
    const { RacingDriver } = await import('/src/race/driver.ts');
    const { aiPace } = await import('/src/race/ai.ts');
    const { carPace } = await import('/src/race/racingLine.ts');
    const { suggestedSetup } = await import('/src/race/strategy.ts');
    const { updateSettings } = await import('/src/core/settings.ts');
    const g = window.__game, t = builtInTrack('world-it-1922'), setup = suggestedSetup(t);
    updateSettings({ carSetup: setup });
    g.setTrack(t);
    g.start({ mode: 'practice', opponents: 0, ghost: false, weather: 'dry', time: 'day', tyreWear: false });
    g.frame = () => {};
    const r = g.screens.race;
    r.autopilot = new RacingDriver(t, carPace(aiPace(1, t), setup));
    let peak = 0, off = 0, ticks = 0;
    while (ticks++ < 35000) {
      r.tick();
      peak = Math.max(peak, r.car.state.speed * 3.6);
      if (r.car.state.offTrack) off++;
      if (r.session.laps.length && r.car.state.speed * 3.6 > 320) break;
    }
    r.car.prev.copyFrom(r.car.state); r.rig.snap(r.car.state); r.hud.clearFlash(); r.frame(0);
    return { ticks, peak, off, speed: r.car.state.speed * 3.6, gear: r.car.state.gear, length: t.center.length, laps: r.session.laps, valid: r.session.lapValid };
  });
  assert.ok(run.ticks < 35000 && run.laps.length > 0);
  assert.ok(run.peak > 330 && run.peak < 365, JSON.stringify(run));
  assert.equal(run.off, 0); assert.ok(run.valid.every(Boolean)); assert.equal(run.gear, 8);
  assert.equal(Number(await page.locator('.hud .speed-value').innerText()), Math.round(run.speed));
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/full-size-monza-speed.png' });
  await page.evaluate(() => { const g = window.__game; g.go('editor'); g.screens.editor.frame(0, 0); });
  const checkEditor = () => page.evaluate(() => {
    const g = window.__game, e = g.screens.editor; e.frame(0, 0);
    const v = e.view, points = e.dots.map(p => ({ x: v.ox + p.x * v.scale, y: v.oy + p.y * v.scale }));
    return { width: g.surface.w, height: g.surface.h, inside: points.every(p => p.x >= 0 && p.x <= g.surface.w && p.y >= 0 && p.y <= g.surface.h), paper: e.paper, count: points.length };
  });
  assert.equal((await checkEditor()).inside, true);
  await page.screenshot({ path: 'test-results/full-size-monza-editor.png' });
  const edited = await page.evaluate(async () => {
    const g = window.__game, e = g.screens.editor;
    const before = JSON.stringify(e.dots);
    e.cornerRunoff('all', 2); e.frame(0, 0); e.flushDraft();
    const { readDraft } = await import('/src/editor/draft.ts');
    const draft = readDraft(), painted = JSON.stringify(e.extras.paint), frame = JSON.stringify(e.extras.paintFrame);
    e.undo(); e.frame(0, 0); const undone = !e.extras.paint;
    e.redo(); e.frame(0, 0);
    return { unchanged: before === JSON.stringify(e.dots), same: JSON.stringify(draft.dots) === before, frame: draft.extras?.paintFrame, painted: draft.extras?.paint?.length > 0, undone, redone: JSON.stringify(e.extras.paint) === painted && JSON.stringify(e.extras.paintFrame) === frame };
  });
  assert.ok(edited.unchanged && edited.same && edited.frame && edited.painted && edited.undone && edited.redone, JSON.stringify(edited));
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => window.__game.surface.w === 844 && window.__game.surface.h === 390);
  const phone = await checkEditor();
  assert.equal(phone.inside, true); assert.equal(phone.width, 844); assert.equal(phone.height, 390);
  await page.screenshot({ path: 'test-results/full-size-monza-editor-phone.png' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ run, editor: edited, errors }));
} finally { await browser?.close(); server.kill(); }
