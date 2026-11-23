import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { TyreThermal } from '../src/car/tyreThermal.ts';
import { CarPhysics } from '../src/car/physics.ts';
import { TYRE_TEMP, type Compound } from '../src/config/race.ts';
import { builtInTracks, getSampleTrack } from '../src/editor/pipeline.ts';
import { AiDriver } from '../src/race/ai.ts';
import { Hud } from '../src/ui/hud.ts';

const patches=[{load:3},{load:3},{load:3},{load:3}],zero=[0,0,0,0],normal=[6,6,6,6];
function run(t:TyreThermal,seconds:number,work:readonly number[]=normal,speed=35,wet=0,compound:Compound='medium',dt=1/120) {
  for(let i=0;i<Math.round(seconds/dt);i++)t.step(work,patches,speed,wet,compound,1,dt);
  return t;
}
const warm=()=>{const t=new TyreThermal();t.surface.fill(95);t.core.fill(92);return t;};

test('a short slide heats the tread without cooking the core or destroying grip, then recovers on a straight',()=>{
  const t=run(warm(),8,[60,60,120,120]);
  assert.ok(t.surface[2]>t.surface[0]&&t.surface[2]<130);assert.ok(t.core.every(c=>c<100));
  assert.ok(t.grip(2,'medium')>.97);const peak=t.surface[2];
  run(t,20,zero,50);assert.ok(t.surface[2]<peak-15);assert.equal(t.grip(2,'medium'),1);
});

test('sustained abuse still heat-soaks a tyre; easing off cannot instantly reset a hot carcass',()=>{
  const t=run(warm(),180,[120,120,120,120]);
  assert.ok(t.core.every(c=>c>TYRE_TEMP.window.medium[1]+10));assert.ok(t.grip(0,'medium')<.95);assert.ok(t.overheat('medium')>10);
  const core=t.core[0];run(t,1,zero,50);assert.ok(t.core[0]>core-1);assert.ok(t.grip(0,'medium')<.96);
  t.reset('medium');assert.deepEqual(t.surface,[80,80,80,80]);assert.deepEqual(t.core,t.surface);
});

test('normal work reaches a stable operating temperature instead of creeping upwards forever',()=>{
  const t=run(new TyreThermal(),180);const earlier=t.surface[0];run(t,180);
  assert.ok(t.surface.every(v=>v>90&&v<112));assert.ok(Math.abs(t.surface[0]-earlier)<5);assert.equal(t.grip(0,'medium'),1);
});

test('surface spikes cost less grip and thermal wear than sustained overheating at the same tread temperature',()=>{
  const flash=warm(),soaked=warm();flash.surface.fill(135);soaked.surface.fill(135);soaked.core.fill(130);
  assert.ok(flash.grip(0,'medium')>soaked.grip(0,'medium')+.04);
  assert.ok(soaked.overheat('medium')>flash.overheat('medium')*5);
});

test('warming the tread restores normal grip without several laps of cold-core understeer',()=>{
  const t=new TyreThermal();assert.ok(t.grip(0,'medium')<.95);
  t.surface.fill(96);assert.equal(t.grip(0,'medium'),1);assert.deepEqual(t.core,[80,80,80,80]);
});

test('stopping cools tyres, airflow helps recovery and water adds cooling',()=>{
  const stopped=run(warm(),60,zero,0);assert.ok(stopped.surface[0]<80);assert.ok(stopped.core[0]>stopped.surface[0]);
  const slow=warm(),fast=warm(),wet=warm();for(const t of [slow,fast,wet]){t.surface.fill(140);t.core.fill(120);}
  run(slow,20,zero,0);run(fast,20,zero,60);run(wet,20,zero,60,1);
  assert.ok(fast.surface[0]<slow.surface[0]);assert.ok(wet.surface[0]<fast.surface[0]-8);
});

test('soft tyres respond faster than hards; grooved tyres need water to manage their heat',()=>{
  const soft=run(new TyreThermal(),15,normal,35,0,'soft'),hard=run(new TyreThermal(),15,normal,35,0,'hard');
  assert.ok(soft.surface[0]>hard.surface[0]+1);
  const dry=new TyreThermal(),wet=new TyreThermal();dry.reset('wet');wet.reset('wet');
  run(dry,180,normal,35,0,'wet');run(wet,180,normal,35,1,'wet');
  assert.ok(dry.surface[0]>TYRE_TEMP.window.wet[1]+20);assert.ok(dry.grip(0,'wet')<.9);
  assert.ok(wet.surface[0]>45&&wet.surface[0]<75);assert.equal(wet.grip(0,'wet'),1);
});

test('heat remains per tyre, mirrors correctly, and integrates consistently at different time steps',()=>{
  const a=warm(),b=warm();for(let i=0;i<1200;i++){
    a.step([5,20,10,40],[{load:2},{load:4},{load:2},{load:4}],35,.2,'medium',1,1/120);
    b.step([20,5,40,10],[{load:4},{load:2},{load:4},{load:2}],35,.2,'medium',1,1/120);
  }
  assert.deepEqual(a.surface,[b.surface[1],b.surface[0],b.surface[3],b.surface[2]]);
  assert.ok(a.surface[3]>a.surface[2]);
  const fine=run(warm(),60,normal,35,0,'medium',1/120),coarse=run(warm(),60,normal,35,0,'medium',1/60);
  assert.ok(Math.abs(fine.surface[0]-coarse.surface[0])<.02);assert.ok(Math.abs(fine.core[0]-coarse.core[0])<.02);
});

test('a road reset retains heat; fitting another compound resets both layers to its blankets',()=>{
  const c=new CarPhysics(getSampleTrack(0));c.tyreTemp.fill(145);c.tyreCore.fill(120);c.resetToRoad();
  assert.deepEqual(c.tyreTemp,[145,145,145,145]);assert.deepEqual(c.tyreCore,[120,120,120,120]);
  c.newTyres('inter');assert.deepEqual(c.tyreTemp,Array(4).fill(TYRE_TEMP.blanket.inter));assert.deepEqual(c.tyreCore,c.tyreTemp);
});

test('normal real-track stints stay clean and sustainable at 100% AI in dry and wet conditions',()=>{
  for(const name of ['Monza','Shanghai','Las Vegas'])for(const wet of [false,true]){
    const track=builtInTracks().find(t=>t.def.name===name)!.track();
    const ai=new AiDriver(track,{name:'Thermal regression',paint:0,difficulty:1,laps:10,slot:0,wet});ai.session.phase='racing';
    const c=ai.car;c.wear=true;c.wearRate=0;c.newTyres(wet?'wet':'medium');const states=[c.state];let peak=0,off=0;
    for(let k=0;k<120*180;k++){c.step(ai.drive(states,1/120));off+=Number(c.state.offTrack);peak=Math.max(peak,...c.tyreTemp);}
    const hi=TYRE_TEMP.window[c.compound][1];assert.ok(peak<hi+8,`${name} ${c.compound}: ${peak}`);
    assert.ok(c.tempGrip()>.98,`${name}: ${c.tempGrip()}`);assert.equal(off,0,`${name}: track limits`);
  }
});

test('HUD distinguishes surface heat from stored core heat and updates at a window crossing',t=>{
  const win=new Window(),original=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{value:win.document,configurable:true});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else Reflect.deleteProperty(globalThis,'document');});
  const hud=new Hud({drawTrack(){},pause(){},startRace(){}});hud.setCar([125,100,100,100],[90,112],10,[95,95,95,95]);
  assert.equal(hud.root.querySelector('.tyre-surface')!.textContent,'125°');assert.equal(hud.root.querySelector('.tyre-core')!.textContent,'95°');
  assert.equal(hud.root.querySelector('.tyre-surface')!.getAttribute('data-state'),'hot');assert.equal(hud.root.querySelector('.tyre-core')!.getAttribute('data-state'),'ok');
  assert.match(hud.root.querySelector('.tyre-temp')!.getAttribute('aria-label')!,/Front left.*surface 125.*core 95/);
  hud.setCar([111.9,100,100,100],[90,112],10,[95,95,95,95]);hud.setCar([112.1,100,100,100],[90,112],10,[95,95,95,95]);
  assert.equal(hud.root.querySelector('.tyre-surface')!.getAttribute('data-state'),'warm');
});
