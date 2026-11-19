import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin='http://127.0.0.1:5290';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--mode','web','--host','127.0.0.1','--port','5290','--strictPort'],{stdio:'ignore'});
let browser;
try {
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
  browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('inkcircuit.settings',JSON.stringify({played:true,graphics:'fast',graphicsChosen:true})));
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
  assert.deepEqual(errors,[]);
  console.log('Physics browser checks passed: real keyboard braking, raw contact slip, four loaded patches, thermal state, and switching to full aids.');
}finally{await browser?.close();server.kill();}
