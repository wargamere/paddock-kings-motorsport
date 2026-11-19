import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root=process.argv[2]?resolve(process.argv[2]):fileURLToPath(new URL('..',import.meta.url));
const {CarPhysics}=await import(pathToFileURL(resolve(root,'src/car/physics.ts')).href);
const {AiDriver}=await import(pathToFileURL(resolve(root,'src/race/ai.ts')).href);
const {builtInTracks}=await import(pathToFileURL(resolve(root,'src/editor/pipeline.ts')).href);
const results=[];
for(const id of ['world-au-1953','world-gb-1948','world-us-2023']) {
  const track=builtInTracks().find((t:{def:{id:string}})=>t.def.id===id)!.track();
  // Isolate contact physics from tactical planning and rendering.
  const cars=Array.from({length:24},()=>new CarPhysics(track));
  const pedal={throttle:.6,brake:0,steer:.1,handbrake:false};
  let physics=0;
  for(let tick=0;tick<1200;tick++) {
    for(const c of cars){c.placeAt(track.center.length*.3);const s=c.state;s.vx=30*Math.cos(s.heading);s.vz=30*Math.sin(s.heading);s.speed=30;}
    const start=performance.now();for(const c of cars)c.step(pedal);if(tick>=200)physics+=performance.now()-start;
  }
  const field=Array.from({length:24},(_,slot)=>new AiDriver(track,{name:String(slot),paint:0,difficulty:1,laps:3,slot,wet:true,fuel:true}));
  for(const d of field)d.session.phase='racing';
  const states=field.map(d=>d.car.state),times=[];
  for(let tick=0;tick<1200;tick++) {
    const start=performance.now();for(const d of field)d.car.step(d.drive(states,1/120));
    if(tick>=200)times.push(performance.now()-start);
  }
  times.sort((a,b)=>a-b);
  results.push({track:id,grid:24,physicsMsPerTick:physics/1000,physicsAndAiMsPerTick:times.reduce((a,b)=>a+b,0)/times.length,p95:times[Math.floor(times.length*.95)]});
}
console.log(JSON.stringify({checkout:root,results},null,2));
