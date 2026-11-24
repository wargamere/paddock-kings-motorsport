import { HANDLING as H } from '../config/handling.ts';

/** Full-load wheel acceleration before tyre traction, gearing/revs, surface and fuel mass. */
export function engineAcceleration(speed:number,pull=1,top=1,extraPower=0):number {
  const v=Math.max(0,speed);
  const limit=Math.max(0,Math.min(1,(H.maxSpeed*top-v)/H.limiterBand));
  // Constant wheel power at speed, torque-limited at low speed. No early linear
  // fade that removes most engine power while still far below the rev ceiling.
  return Math.min(H.engineAccel*pull,(H.enginePower*pull+extraPower)/Math.max(1,v))*limit;
}

/** Flat-road equilibrium shared with the racing-line and passing forecasts. */
export function terminalSpeed(drag=1,pull=1,top=1):number {
  let lo=0,hi=H.maxSpeed*top;
  for(let i=0;i<28;i++){
    const v=(lo+hi)/2;
    if(engineAcceleration(v,pull,top)>H.rollingDrag+H.aeroDrag*drag*v*v)lo=v;else hi=v;
  }
  return (lo+hi)/2;
}
