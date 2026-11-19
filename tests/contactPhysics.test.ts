import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChassisDynamics, ContactPatch, type DynamicsInput } from '../src/car/dynamics.ts';
import { CarPhysics } from '../src/car/physics.ts';
import { HANDLING, SIM } from '../src/config/handling.ts';
import { DEFAULT_SETUP, TYRE_TEMP } from '../src/config/race.ts';
import { getSampleTrack } from '../src/editor/pipeline.ts';

const input = (extra: Partial<DynamicsInput> = {}): DynamicsInput => ({ vf: 35, vr: 0, yaw: 0, steer: 0, drive: 0, coast: 0, body: 0, brake: 0, resist: 0, lat: HANDLING.maxLateralAccel, bite: 1, downforce: 1.2, aeroFront: 0, setup: DEFAULT_SETUP, dt: 1/120, abs: false, tc: false, fullTc: false, stability: false, handbrake: false, heat: [1,1,1,1], surface: [1,1,1,1], ...extra });

test('contact forces stay inside the friction ellipse throughout combined-slip breakaway and recovery', () => {
  const patch = new ContactPatch();
  for (const alpha of [-1,-.2,-.05,0,.05,.2,1]) for (const demand of [-50,-5,0,5,50]) {
    patch.reset();
    for (let tick=0;tick<120;tick++) {
      patch.solve(alpha,30,tick<60?demand:0,10,8,1/240,false,false,false,false);
      assert.ok(Number.isFinite(patch.fx+patch.fy+patch.work+patch.slipRatio));
      assert.ok(Math.hypot(patch.fx/10,patch.fy/8)<=1+1e-12);
      assert.ok(patch.work>=0);
    }
  }
});

test('a tyre builds cornering force over distance, sheds grip progressively under excess throttle and recovers after lifting', () => {
  const p = new ContactPatch();
  p.solve(.06,20,0,10,10,1/240,false,false,false,false); const first=Math.abs(p.fy);
  for(let i=0;i<120;i++)p.solve(.06,20,0,10,10,1/240,false,false,false,false);
  const settled=Math.abs(p.fy); assert.ok(first>0 && first<settled*.6);
  p.solve(.06,20,18,10,10,1/240,false,false,false,false); const early=p.slipRatio;
  for(let i=0;i<30;i++)p.solve(.06,20,18,10,10,1/240,false,false,false,false);
  assert.ok(p.slipRatio>early && Math.abs(p.fy)<settled*.4);
  for(let i=0;i<120;i++)p.solve(.06,20,0,10,10,1/240,false,false,false,false);
  assert.ok(Math.abs(p.fy)>settled*.99);
});

test('brake bias is the requested hydraulic split, independent of axle load transfer before tyre saturation', () => {
  for(const bias of [50,58,70]) {
    const d=new ChassisDynamics(),p=input({brake:3,setup:{...DEFAULT_SETUP,brakeBias:bias}});
    for(let i=0;i<60;i++)d.step(p);
    const front=-(d.wheels[0].fx+d.wheels[1].fx), rear=-(d.wheels[2].fx+d.wheels[3].fx);
    assert.ok(Math.abs(front/(front+rear)-bias/100)<1e-10);
    assert.ok(d.wheels[0].load+d.wheels[1].load>9.81*p.downforce*SIM.frontWeight);
  }
});

test('suspension conserves load and transfers it outward in corners and forward under braking without a one-tick jump', () => {
  const d=new ChassisDynamics(),p=input({steer:.08,brake:4});
  const initial=d.step(p), first=d.wheels.map(w=>w.load); assert.ok(Number.isFinite(initial.yaw));
  for(let i=0;i<120;i++) {
    d.step(p);const loads=d.wheels.map(w=>w.load);
    assert.ok(loads.every(x=>x>0 && Number.isFinite(x)));
    assert.ok(Math.abs(loads.reduce((a,b)=>a+b,0)-9.81*p.downforce)<1e-10);
  }
  assert.ok(d.wheels[0].load>d.wheels[1].load && d.wheels[2].load>d.wheels[3].load,'right corner loads the left tyres');
  assert.ok(d.wheels[0].load>first[0]);
});

test('four patches retain left/right surface differences and the differential biases drive to the tyre with grip', () => {
  const run=(diff:number)=>{
    const d=new ChassisDynamics(),p=input({drive:5,setup:{...DEFAULT_SETUP,diff},surface:[1,1,.25,1],tc:true,fullTc:true});
    for(let i=0;i<60;i++)d.step(p);
    return {weak:d.wheels[2].fx,strong:d.wheels[3].fx};
  };
  const open=run(0),locked=run(100);
  assert.ok(locked.strong>open.strong && locked.strong>locked.weak);
});

test('a freely coasting chassis dissipates kinetic energy and left/right manoeuvres mirror each other', () => {
  const run=(sign:number)=>{
    const d=new ChassisDynamics(),p=input({vr:2*sign,yaw:.15*sign,resist:.5});
    const energy=()=>p.vf*p.vf+p.vr*p.vr+SIM.yawInertia*p.yaw*p.yaw;
    const start=energy();
    for(let i=0;i<120;i++) {
      const r=d.step(p),c=Math.cos(r.heading),s=Math.sin(r.heading);
      p.vf=r.vf*c+r.vr*s;p.vr=-r.vf*s+r.vr*c;p.yaw=r.yaw;
    }
    assert.ok(energy()<start);
    return p;
  };
  const left=run(-1),right=run(1);
  assert.ok(Math.abs(left.vf-right.vf)<1e-10 && Math.abs(left.vr+right.vr)<1e-10 && Math.abs(left.yaw+right.yaw)<1e-10);
});

test('tyre surface/core temperatures and patch memory reset on a new set, including a road reset during a slide', () => {
  const c=new CarPhysics(getSampleTrack(0));c.newTyres('medium');c.placeAt(100);
  c.state.vx=30*Math.cos(c.state.heading);c.state.vz=30*Math.sin(c.state.heading);c.state.speed=30;c.state.heading+=.25;
  c.step({throttle:0,brake:0,steer:0,handbrake:false});
  assert.ok(c.tyreTemp.some((t,i)=>t>c.tyreCore[i]));
  c.newTyres('wet'); assert.deepEqual(c.tyreTemp,Array(4).fill(TYRE_TEMP.blanket.wet));assert.deepEqual(c.tyreCore,c.tyreTemp);
  assert.ok(c.contacts.every(w=>w.alpha===0 && w.slipRatio===0));
  c.placeAt(0);assert.ok(c.contacts.every(w=>w.load===0 && w.fx===0 && w.fy===0));
});

test('worn tyres reduce braking authority and steering help cannot exceed mechanical lock in a large slide', () => {
  const c=new CarPhysics(getSampleTrack(0));c.wear=true;c.tyreUse=0;const fresh=c.brakeScale;
  c.tyreUse=1.3;assert.ok(c.brakeScale<fresh*.7);
  c.wear=false;c.placeAt(100);const s=c.state,heading=s.heading;
  s.vx=25*Math.cos(heading)-30*Math.sin(heading);s.vz=25*Math.sin(heading)+30*Math.cos(heading);s.speed=25;
  c.step({throttle:0,brake:0,steer:1,handbrake:false});
  assert.ok(Math.abs(s.steer)<=HANDLING.maxSteerAngle/(1+25/HANDLING.steerFalloff)+1e-10);
});
