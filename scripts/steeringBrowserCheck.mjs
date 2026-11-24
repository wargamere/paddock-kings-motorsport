import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:5298';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'web', '--host', '127.0.0.1', '--port', '5298', '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready);
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('inkcircuit.settings')) localStorage.setItem('inkcircuit.settings', JSON.stringify({ played: true, graphics: 'fast', graphicsChosen: true }));
  });
  await page.goto(origin); await page.waitForFunction(() => window.__game);
  await page.evaluate(async () => {
    const { builtInTrack } = await import('/src/editor/pipeline.ts');
    const g = window.__game; g.setTrack(builtInTrack('world-it-1922'));
    g.start({ mode: 'practice', opponents: 0, ghost: false, weather: 'dry', time: 'day' }); g.frame = () => {};
    const r = g.screens.race; r.session.phase = 'racing'; r.stage = 'run';
    r.car.placeAt(100);
    const s = r.car.state; Object.assign(s, { vx: Math.cos(s.heading) * 300 / 3.6, vz: Math.sin(s.heading) * 300 / 3.6, speed: 300 / 3.6 });
    window.steeringStart = { x: s.x, z: s.z };
  });
  await page.keyboard.down('d');
  const turn = await page.evaluate(() => {
    const r = window.__game.screens.race;
    let peak = 0;
    for (let i = 0; i < 12; i++) { r.tick(); peak = Math.max(peak, Math.abs(r.car.state.yawRate)); }
    return { input: r.tickInput.steer, peak };
  });
  await page.keyboard.up('d');
  const settled = await page.evaluate(() => {
    const r = window.__game.screens.race;
    for (let i = 0; i < 60; i++) r.tick();
    r.car.prev.copyFrom(r.car.state); r.rig.snap(r.car.state); r.frame(0);
    return { input: r.tickInput.steer, lateral: r.car.state.lateral, off: r.car.state.offTrack, speed: r.car.state.speed * 3.6 };
  });
  assert.ok(turn.input > .08 && turn.input < .18, JSON.stringify(turn));
  assert.equal(settled.input, 0); assert.equal(settled.off, false); assert.ok(Math.abs(settled.lateral) < 2);
  await page.evaluate(() => { const g = window.__game; g.screens.race.controlsPanel.open(g.ui); });
  const slider = page.getByRole('slider', { name: 'Steering sensitivity', exact: true });
  await slider.focus(); await page.keyboard.press('Home');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  assert.equal(await slider.inputValue(), '75');
  const preference = await page.evaluate(async () => (await import('/src/core/settings.ts')).settings().steeringSensitivity);
  assert.equal(preference, 75);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/steering-controls-desktop.png' });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => window.__game.surface.w === 844);
  await page.evaluate(() => window.__game.screens.race.frame(0));
  assert.equal(await slider.isVisible(), true);
  await slider.scrollIntoViewIfNeeded();
  const bounds = await slider.boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 844);
  await page.screenshot({ path: 'test-results/steering-controls-phone.png' });
  await page.keyboard.press('Escape');
  assert.equal(await slider.count(), 0);
  await page.reload(); await page.waitForFunction(() => window.__game);
  assert.equal(await page.evaluate(async () => (await import('/src/core/settings.ts')).settings().steeringSensitivity), 75);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ turn, settled, preference, errors }));
} finally { await browser?.close(); server.kill(); }
