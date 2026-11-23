import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanLapReference, LapTiming, referenceTime } from '../src/race/lapTiming.ts';
import { RaceSession, type Progress, type RaceEvent } from '../src/race/session.ts';
import { RecordBook } from '../src/race/records.ts';
import { saveJSON, storage } from '../src/platform/storage.ts';

const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<.001,`${a} vs ${b}`);
/** Uneven tick distances deliberately cross both sector and sample boundaries. */
function lap(t:LapTiming,sectors:[number,number,number],valid=true) {
  const points=[300,600];for(let s=2.7;s<900;s+=2.7)points.push(s);
  for(const s of points.sort((a,b)=>a-b)){const i=Math.min(2,Math.floor(s/300));t.advance(s,sectors.slice(0,i).reduce((a,b)=>a+b,0)+(s-i*300)/300*sectors[i]);}
  return t.finish(sectors.reduce((a,b)=>a+b,0),valid);
}

test('live delta compares equal distances and interpolates sub-tick sector crossings',()=>{
  const t=new LapTiming(900);t.begin(null);const ref=lap(t,[10,12,11]);assert.ok(ref);
  assert.equal(ref.samples.length,257);assert.ok(Math.abs(referenceTime(ref,300)-10)<.01); // compact sample grid straddles a speed change
  ref.sectors.forEach((s,i)=>close(s,[10,12,11][i]));
  t.begin(ref);t.advance(150,6);close(t.delta(150,6)!,1);
  t.advance(300,11);close(t.sectorDeltas[0]!,1);
  assert.equal(t.referenceKind,'personal');
});

test('session optimal combines completed clean sectors; invalid and pit laps never improve it',()=>{
  const t=new LapTiming(900);t.begin(null);const first=lap(t,[10,12,11]);assert.ok(first);
  t.begin(null);assert.equal(t.referenceKind,'session');lap(t,[11,10,12]);close(t.optimal!,31);
  t.begin(first);t.invalidate();assert.equal(lap(t,[8,8,8]),null);close(t.optimal!,31);assert.equal(t.lastValid,false);
  t.begin(first);t.invalidate('pit');assert.equal(lap(t,[9,9,9]),null);close(t.optimal!,31);
  t.begin(first);t.advance(450,10);t.cancel();assert.equal(t.finish(20,true),null);close(t.optimal!,31);
});

test('reversing suppresses delta until regaining progress and includes the time lost',()=>{
  const t=new LapTiming(900);t.begin(null);const ref=lap(t,[10,10,10]);assert.ok(ref);
  t.begin(ref);t.advance(100,4);t.advance(80,5);assert.equal(t.delta(80,5),null);
  t.advance(100,6);close(t.delta(100,6)!,6-referenceTime(ref,100));
  t.advance(300,14);close(t.sectors[0]!,14);
});

test('teleports cannot become a reference and a clean following lap recovers normally',()=>{
  const t=new LapTiming(900);t.begin(null);t.advance(700,.1);assert.equal(t.reason,'invalid');
  assert.equal(t.finish(5,true),null);assert.equal(t.optimal,null);
  t.begin(null);assert.ok(lap(t,[10,10,10]));
});

test('a finished lap compares at the finish, and invalid final laps have no delta',()=>{
  const t=new LapTiming(900);t.begin(null);const ref=lap(t,[10,10,10]);assert.ok(ref);
  t.begin(ref);lap(t,[11,11,11]);close(t.delta(900,33)!,3);
  t.begin(ref);lap(t,[9,9,9],false);assert.equal(t.reason,'invalid');assert.equal(t.delta(900,27),null);
});

test('saved reference validation rejects malformed profiles without mislabelling the session fallback',()=>{
  const t=new LapTiming(900);t.begin(null);const ref=lap(t,[10,10,10]);assert.ok(ref);
  assert.deepEqual(cleanLapReference(ref,30,900),ref);
  for(const bad of [{...ref,length:901},{...ref,time:31},{...ref,samples:[0]},{...ref,samples:ref.samples.map((n,i)=>i===10?-1:n)},{...ref,sectors:[10,10,9]}]) assert.equal(cleanLapReference(bad,30,900),null);
  t.begin({...ref,samples:[]});assert.equal(t.referenceKind,'session');
  assert.equal(new LapTiming(901).reference,null);
  const other=new LapTiming(901);other.begin(ref);assert.equal(other.referenceKind,null);
});

test('records preserve old times, round-trip timing profiles, and discard only damaged telemetry',()=>{
  const id='lap-timing-test';storage.removeItem(`records.${id}`);
  saveJSON(`records.${id}`,{best:{time:35,splits:[10,20]},bestScore:0,ghost:null});
  const old=new RecordBook();assert.deepEqual(old.get(id).best,{time:35,splits:[10,20]});
  const t=new LapTiming(900);t.begin(null);const reference=lap(t,[10,10,10]);assert.ok(reference);
  old.get(id).best={time:30,splits:[10,20],reference};old.save(id);
  assert.deepEqual(new RecordBook().get(id).best?.reference,reference);
  saveJSON(`records.${id}`,{best:{time:30,splits:[10,20],reference:{...reference,samples:[]}}});
  assert.deepEqual(new RecordBook().get(id).best,{time:30,splits:[10,20]});
  assert.deepEqual(new RecordBook().summary(id).best,{time:30,splits:[10,20]});
  new RecordBook().forget(id);
});

test('manual reset invalidates only the active lap, including its PB, then clears on the next lap',()=>{
  const s=new RaceSession(900,null,3,12,0),events:RaceEvent[]=[];
  assert.equal(s.invalidateLap(),false);
  let pos=899,reset=false;
  for(let n=0;n<2401;n++){
    const prev:Progress={s:pos,lateral:0,along:120};pos=(pos+1)%900;
    s.step(prev,{s:pos,lateral:0,along:120},events);
    if(!reset&&s.lapStart!==null&&pos>100){assert.equal(s.invalidateLap(),true);assert.equal(s.invalidateLap(),false);reset=true;}
  }
  assert.deepEqual(s.lapValid,[false,true]);assert.ok(s.best);assert.equal(s.lapSpoilt,false);
});
