import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { CarState } from '../src/car/physics.ts';
import { CarModel } from '../src/car/model.ts';
import { GripFeedback, proximity } from '../src/race/awareness.ts';
import { Hud } from '../src/ui/hud.ts';

const car=(x=0,z=0,y=0)=>Object.assign(new CarState(),{x,z,y,speed:30,vx:30});
const alerts=()=>({left:0 as 0|1|2,right:0 as 0|1|2});

test('proximity is driver-relative and reports both sides with tighter-space severity',()=>{
  const me=car(),left=car(0,-2),right=car(1,4);
  assert.deepEqual(proximity(me,[me,left,right],alerts()),{left:2,right:1});
  me.heading=Math.PI/2;left.x=2;left.z=0;right.x=-4;right.z=1;
  assert.deepEqual(proximity(me,[me,left,right],alerts()),{left:2,right:1});
});

test('proximity anticipates a closing car beside you but clears one moving away',()=>{
  const me=car(),behind=car(-10,-3);behind.vx=45;
  assert.equal(proximity(me,[behind],alerts()).left,1);
  behind.vx=15;assert.equal(proximity(me,[behind],alerts()).left,0);
});

test('proximity excludes cars on another level or across the pit wall, distant cars and the driver itself',()=>{
  const me=car(),bridge=car(0,2,3),pit=car(0,-2);pit.inPits=true;
  assert.deepEqual(proximity(me,[me,bridge,pit,car(40,2),car(1,10)],alerts()),{left:0,right:0});
  const near=car(0,-2),out=alerts();proximity(me,[near],out);proximity(me,[],out);assert.deepEqual(out,{left:0,right:0});
});

test('tyre feedback ignores isolated spikes, holds a correction briefly and resets at low speed',()=>{
  const f=new GripFeedback();assert.equal(f.update(1,0,0,0,30,1/120),'');
  for(let i=0;i<20;i++)f.update(0,0,0,0,30,1/120);assert.equal(f.warning,'');
  for(let i=0;i<20;i++)f.update(1,0,0,0,30,1/120);assert.equal(f.warning,'lock');
  for(let i=0;i<10;i++)f.update(0,0,0,0,30,1/120);assert.equal(f.warning,'lock');
  for(let i=0;i<50;i++)f.update(0,0,0,0,30,1/120);assert.equal(f.warning,'');
  for(let i=0;i<20;i++)f.update(0,1,0,0,30,1/120);assert.equal(f.warning,'spin');
  assert.equal(f.update(1,1,.2,.1,1,1/60),'');
});

test('front grip feedback distinguishes front saturation from the whole car sliding',()=>{
  const f=new GripFeedback();for(let i=0;i<20;i++)f.update(0,0,.2,.05,30,1/120);assert.equal(f.warning,'front');
  f.reset();for(let i=0;i<30;i++)f.update(0,0,.2,.3,30,1/120);assert.equal(f.warning,'');
});

test('cockpit pillar visibility preserves damage and restores the full exterior geometry',t=>{
  const win=new Window(),original=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{value:win.document,configurable:true});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else Reflect.deleteProperty(globalThis,'document');});
  const model=new CarModel(),trim=Reflect.get(model,'trim'),intact=trim.geometry;
  model.setCockpitView(true);assert.ok(trim.geometry.getAttribute('position').count<intact.getAttribute('position').count);
  model.setDamage(1,0);const damagedClear=trim.geometry;model.setCockpitView(false);const damaged=trim.geometry;
  assert.notEqual(damaged,damagedClear);assert.notEqual(damaged,intact);
  model.setCockpitView(true);assert.equal(trim.geometry,damagedClear,'uses cached geometry without rebuilding each frame');
});

test('fuel readout updates tenths below 10 kg even while its rounded integer stays the same',t=>{
  const win=new Window(),original=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{value:win.document,configurable:true});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else Reflect.deleteProperty(globalThis,'document');});
  const hud=new Hud({drawTrack(){},pause(){},startRace(){}});
  hud.setCar([100,100,100,100],[90,112],9.8);assert.match(hud.root.querySelector('.fuel-value')!.textContent!,/9\.8/);
  hud.setCar([100,100,100,100],[90,112],9.6);assert.match(hud.root.querySelector('.fuel-value')!.textContent!,/9\.6/);
});
