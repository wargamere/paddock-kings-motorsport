import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin='http://127.0.0.1:5290';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--mode','web','--host','127.0.0.1','--port','5290','--strictPort'],{stdio:'ignore'});
let browser;
try {
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
  browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{if(!localStorage.getItem('inkcircuit.settings'))localStorage.setItem('inkcircuit.settings',JSON.stringify({played:true,graphics:'fast',graphicsChosen:true}));});
  await page.goto(origin);await page.waitForFunction(()=>window.__game);
  await page.evaluate(async()=>{
    const {updateSettings,ASSIST_PRESETS}=await import('/src/core/settings.ts');
    updateSettings({assists:ASSIST_PRESETS.expert});
    const g=window.__game;g.start({mode:'practice',opponents:0,ghost:false,weather:'dry',time:'day',tyreWear:true,tyres:'medium'});
    const c=g.screens.race.car;c.placeAt(100);c.setup={...c.setup,brakeBias:70};
    const s=c.state;s.vx=20*Math.cos(s.heading);s.vz=20*Math.sin(s.heading);s.speed=20;
  });
  await page.keyboard.down('s');
  await page.waitForFunction(()=>window.__game.screens.race.car.state.lockup>.05);
  const raw=await page.evaluate(()=>{
    const c=window.__game.screens.race.car;
    return {aids:[c.abs,c.tc,c.stability,c.steerHelp],patches:c.contacts.map(w=>({load:w.load,fx:w.fx,slip:w.slipRatio})),cores:c.tyreCore};
  });
  await page.keyboard.up('s');
  assert.deepEqual(raw.aids,[false,false,false,false]);assert.equal(raw.patches.length,4);
  assert.ok(raw.patches.every(w=>Number.isFinite(w.load+w.fx+w.slip)&&w.load>0));
  assert.ok(raw.patches.some(w=>w.slip<-.12));assert.equal(raw.cores.length,4);
  await page.evaluate(async()=>{
    const {updateSettings,ASSIST_PRESETS}=await import('/src/core/settings.ts');updateSettings({assists:ASSIST_PRESETS.beginner});
    window.__game.start({mode:'practice',opponents:0,ghost:false,weather:'dry',time:'day',tyreWear:true,tyres:'wet'});
  });
  await page.waitForFunction(()=>{const c=window.__game.screens.race.car;return c.abs&&c.tc&&c.tcFull&&c.stability&&c.steerHelp;});
  const aided=await page.evaluate(()=>{const c=window.__game.screens.race.car;return {patches:c.contacts.length,temperatures:c.tyreTemp,cores:c.tyreCore};});
  assert.equal(aided.patches,4);assert.ok(aided.temperatures.every(t=>t<60)&&aided.cores.every(t=>t<60));
  // Controlled close-racing scene: exercise the actual HUD and camera wiring without AI motion.
  await page.evaluate(async()=>{
    const {updateSettings}=await import('/src/core/settings.ts');
    updateSettings({cockpitPillar:false,raceRadar:true,drivingFeedback:true});
    const g=window.__game;g.start({mode:'race',players:2,opponents:0,difficulty:100,grid:'pick',startSlot:1,ghost:false,weather:'dry',time:'day',laps:3});
    const r=g.screens.race;r.tick=()=>{};r.stage='run';r.session.phase='racing';r.p2.ai.session.phase='racing';
    r.rig.mode='cockpit';r.rig2.mode='cockpit';
    const a=r.car.state,b=r.p2.ai.car.state;
    Object.assign(b,{x:a.x+Math.sin(a.heading)*2.2,z:a.z-Math.cos(a.heading)*2.2,y:a.y,heading:a.heading,vx:a.vx,vz:a.vz});
    r.car.prev.copyFrom(a);r.p2.ai.car.prev.copyFrom(b);
  });
  await page.waitForFunction(()=>{const r=window.__game.screens.race;return !r.hud.driving.root.hidden&&!r.hud2.driving.root.hidden;});
  const cameras=await page.evaluate(()=>{
    const r=window.__game.screens.race,v=window.__game.view3d;
    r.prepareCockpitView(v.camera);const top=[r.model.clearCockpit,r.p2.model.clearCockpit];
    r.prepareCockpitView(r.cam2);const bottom=[r.model.clearCockpit,r.p2.model.clearCockpit];
    return{top,bottom};
  });
  assert.deepEqual(cameras,{top:[true,false],bottom:[false,true]});
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/driving-feedback-split.png'});
  await page.evaluate(()=>{const g=window.__game;g.go('menu');g.start({mode:'race',players:1,opponents:1,difficulty:100,grid:'pick',startSlot:1,ghost:false,weather:'dry',time:'day',laps:3});const r=g.screens.race;r.tick=()=>{};r.stage='run';r.session.phase='racing';r.rig.mode='cockpit';const a=r.car.state,b=r.opponents[0].ai.car.state;Object.assign(b,{x:a.x+Math.sin(a.heading)*2.2,z:a.z-Math.cos(a.heading)*2.2,y:a.y,heading:a.heading,vx:a.vx,vz:a.vz});r.car.prev.copyFrom(a);r.opponents[0].ai.car.prev.copyFrom(b);});
  await page.waitForFunction(()=>!window.__game.screens.race.hud.driving.root.hidden);
  await page.evaluate(()=>{const r=window.__game.screens.race;r.car.state.lockup=.7;r.car.state.speed=25;r.car.prev.copyFrom(r.car.state);});
  await page.getByText('BRAKE LOCKUP',{exact:true}).waitFor();
  await page.screenshot({path:'test-results/driving-feedback-cockpit.png'});
  await page.setViewportSize({width:844,height:390});
  const bounds=await page.locator('.hud .driving-indicators').boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=844);
  await page.screenshot({path:'test-results/driving-feedback-phone.png'});
  await page.evaluate(()=>{const r=window.__game.screens.race;r.assistsPanel.open(window.__game.ui);});
  await page.getByRole('group',{name:'Cockpit centre pillar',exact:true}).getByRole('button',{name:'On',exact:true}).click();
  await page.getByRole('group',{name:'Proximity warnings',exact:true}).getByRole('button',{name:'Off',exact:true}).click();
  await page.waitForFunction(()=>!window.__game.screens.race.model.clearCockpit&&[...document.querySelectorAll('.hud .proximity-side')].every(e=>e.hidden));
  assert.equal(await page.getByText('BRAKE LOCKUP',{exact:true}).isVisible(),true,'tyre feedback is independent of proximity warnings');
  await page.getByRole('group',{name:'Tyre feedback',exact:true}).getByRole('button',{name:'Off',exact:true}).click();
  await page.waitForFunction(()=>window.__game.screens.race.hud.driving.root.hidden);
  const reflection=await page.evaluate(()=>{
    const v=window.__game.view3d;v.setConditions({time:'day',rain:.5,wet:.2});
    const first=v.envTarget,roughness=v.mats.road.roughness;v.setConditions({time:'day',rain:.5,wet:.7});
    const wetOnlyCached=first===v.envTarget,roadChanged=roughness!==v.mats.road.roughness;
    v.setConditions({time:'day',rain:.8,wet:.7});const rainUpdated=first!==v.envTarget;
    return{wetOnlyCached,roadChanged,rainUpdated};
  });assert.deepEqual(reflection,{wetOnlyCached:true,roadChanged:true,rainUpdated:true});
  await page.reload();await page.waitForFunction(()=>window.__game);
  const saved=await page.evaluate(async()=>{const {settings}=await import('/src/core/settings.ts');return{pillar:settings().cockpitPillar,radar:settings().raceRadar,feedback:settings().drivingFeedback};});assert.deepEqual(saved,{pillar:true,radar:false,feedback:false});
  // The actual race HUD must distinguish a surface spike from heat stored in the carcass.
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>{
    const g=window.__game;g.start({mode:'practice',opponents:0,weather:'dry',time:'day',tyreWear:true,tyres:'medium'});
    const r=g.screens.race;r.tick=()=>{};r.car.tyreTemp.splice(0,4,90,124,102,141);r.car.tyreCore.splice(0,4,88,96,98,127);r.frame(0);
  });
  await page.getByText('SURFACE / CORE',{exact:true}).waitFor();
  assert.deepEqual(await page.locator('.tyre-surface').allTextContents(),['90°','124°','102°','141°']);
  assert.deepEqual(await page.locator('.tyre-core').allTextContents(),['88°','96°','98°','127°']);
  assert.equal(await page.locator('.tyre-surface').nth(1).getAttribute('data-state'),'warm');
  assert.equal(await page.locator('.tyre-core').nth(1).getAttribute('data-state'),'ok');
  await page.screenshot({path:'test-results/tyre-thermal-desktop.png'});
  await page.setViewportSize({width:844,height:390});
  const thermalBounds=await page.locator('.tyre-thermal').boundingBox(),speedBounds=await page.locator('.hud-speed').boundingBox();
  assert.ok(thermalBounds&&speedBounds&&thermalBounds.x>=speedBounds.x&&thermalBounds.x+thermalBounds.width<=speedBounds.x+speedBounds.width&&speedBounds.x+speedBounds.width<=844&&speedBounds.y+speedBounds.height<=390);
  const hintBounds=await page.locator('.hud-hint').boundingBox();assert.ok(hintBounds&&hintBounds.x+hintBounds.width<=speedBounds.x,'keyboard hint leaves tyre telemetry unobstructed');
  await page.screenshot({path:'test-results/tyre-thermal-phone.png'});
  await page.evaluate(()=>{window.__game.screens.race.car.tyreCore[1]=97;});
  await page.waitForFunction(()=>document.querySelectorAll('.tyre-core')[1].textContent==='97°');
  assert.deepEqual(errors,[]);
  console.log('Driving browser checks passed: raw braking and aids, per-camera cockpit visibility, both-player proximity warnings, phone layout, saved preferences, wetness reflection reuse and separate surface/core tyre telemetry.');
}finally{await browser?.close();server.kill();}
