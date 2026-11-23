import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin='http://127.0.0.1:5295';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--mode','web','--host','127.0.0.1','--port','5295','--strictPort'],{stdio:'ignore'});
let browser;
try {
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
  browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{if(!localStorage.getItem('inkcircuit.settings'))localStorage.setItem('inkcircuit.settings',JSON.stringify({played:true,graphics:'fast',graphicsChosen:true}));});
  await page.goto(`${origin}/?autopilot`);await page.waitForFunction(()=>window.__game);
  const run=await page.evaluate(()=>{
    const g=window.__game;g.start({mode:'practice',opponents:0,ghost:true,weather:'dry',time:'day',tyreWear:false});
    // Run the real player physics, session, event handling and record writes without waiting for wall-clock laps.
    g.frame=()=>{};const r=g.screens.race;let ticks=0;
    while(ticks++<60000&&(r.session.laps.length<2||r.car.state.s<g.track.center.length*.45))r.tick();
    r.hud.clearFlash();r.frame(0);
    return{ticks,laps:r.session.laps,valid:r.session.lapValid,reference:r.session.best?.reference,optimal:r.lapTiming.optimal,kind:r.lapTiming.referenceKind};
  });
  assert.ok(run.ticks<60000,'autopilot completes real practice laps');assert.ok(run.valid.length>=2&&run.valid.every(Boolean));
  assert.equal(run.reference.samples.length,257);assert.ok(run.optimal>0);assert.equal(run.kind,'personal');
  assert.equal(await page.locator('.lap-timing').isVisible(),true);assert.match(await page.locator('.timing-delta').innerText(),/[+−]\d+\.\d{2}/);
  assert.equal(await page.locator('.timing-sector').count(),3);
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/practice-timing-desktop.png'});
  await page.setViewportSize({width:844,height:390});await page.evaluate(()=>window.__game.screens.race.frame(0));
  const panel=await page.locator('.lap-timing').boundingBox();assert.ok(panel&&panel.x>=0&&panel.x+panel.width<=844&&panel.y+panel.height<195);
  await page.screenshot({path:'test-results/practice-timing-phone.png'});
  await page.keyboard.press('r');await page.evaluate(()=>window.__game.screens.race.updateHud(1));
  assert.equal(await page.locator('.timing-label').innerText(),'LAP INVALID');assert.equal(await page.locator('.timing-delta').innerText(),'—');
  const retry=await page.evaluate(()=>{const r=window.__game.screens.race,optimal=r.lapTiming.optimal;r.restart();for(let i=0;i<3000&&r.session.lapStart===null;i++)r.tick();r.updateHud(1);return{optimal:r.lapTiming.optimal,old:optimal,reason:r.lapTiming.reason};});
  assert.equal(retry.optimal,retry.old);assert.equal(retry.reason,'');
  await page.evaluate(()=>window.__game.screens.race.assistsPanel.open(window.__game.ui));
  await page.getByRole('group',{name:'Live practice timing',exact:true}).getByRole('button',{name:'Off',exact:true}).click();
  await page.evaluate(()=>window.__game.screens.race.updateHud(1));assert.equal(await page.locator('.lap-timing').isVisible(),false);
  await page.reload();await page.waitForFunction(()=>window.__game);
  const saved=await page.evaluate(async()=>{const g=window.__game,{settings}=await import('/src/core/settings.ts');return{on:settings().practiceTiming,reference:g.records.get(g.track.def.id).best?.reference};});
  assert.equal(saved.on,false);assert.deepEqual(saved.reference,run.reference);
  const qualifying=await page.evaluate(async()=>{
    const {updateSettings}=await import('/src/core/settings.ts');updateSettings({practiceTiming:true});
    const g=window.__game;g.start({mode:'race',opponents:1,grid:'qualifying',weather:'dry',time:'day'});g.frame=()=>{};const r=g.screens.race;
    const {RacingDriver}=await import('/src/race/driver.ts'),{aiPace}=await import('/src/race/ai.ts');r.autopilot=new RacingDriver(g.track,aiPace(.8,g.track));
    for(let i=0;i<12000&&(r.session.lapStart===null||r.car.state.s<g.track.center.length*.2);i++)r.tick();
    r.updateHud(1);return{stage:r.stage,visible:!r.hud.timing.root.hidden,kind:r.lapTiming.referenceKind};
  });assert.deepEqual(qualifying,{stage:'qualifying',visible:true,kind:'personal'});
  const final=await page.evaluate(()=>{const r=window.__game.screens.race;for(let i=0;i<60000&&r.session.phase!=='finished';i++)r.tick();r.updateHud(1);return{phase:r.session.phase,delta:r.hud.timing.root.querySelector('.timing-delta').textContent,valid:r.session.lapValid};});
  assert.equal(final.phase,'finished');assert.ok(final.valid.every(Boolean));assert.ok(Math.abs(Number(final.delta.replace('−','-')))<5,'finished qualifying delta uses the finish distance');
  await page.evaluate(()=>{const g=window.__game;g.go('menu');g.start({mode:'race',players:1,opponents:0,grid:'pick',ghost:false});g.frame=()=>{};g.screens.race.updateHud(1);});
  assert.equal(await page.locator('.lap-timing').isVisible(),false);
  assert.deepEqual(errors,[]);console.log('Practice timing browser checks passed: real clean laps, saved reference and reload, live sectors/delta/optimal, reset invalidation, retry, qualifying, phone layout and preference.');
} finally {await browser?.close();server.kill();}
