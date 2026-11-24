import { TYRE_TEMP as T, type Compound } from '../config/race.ts';
import { clamp } from '../core/math.ts';

/** Four surface / carcass pairs, FL/FR/RL/RR. Shared by human and AI cars. */
export class TyreThermal {
  readonly surface=[80,80,80,80];
  readonly core=[80,80,80,80];

  reset(compound:Compound):void {
    this.surface.fill(T.blanket[compound]);this.core.fill(T.blanket[compound]);
  }

  step(work:readonly number[],patches:readonly {load:number}[],speed:number,wetness:number,compound:Compound,blend:number,dt:number):void {
    const v=Math.min(160,Math.abs(speed)),wet=clamp(wetness,0,1);
    const air=T.air+(T.wetAir-T.air)*wet;
    const cooling=T.cool*(1+v/T.coolSpeed)*(1+T.wetCool*wet);
    const response=T.response[compound],squirm=1+T.drySquirm[compound]*(1-wet);
    for(let i=0;i<4;i++) {
      const surface=this.surface[i],core=this.core[i];
      // The contact solver already allocates work to the loaded outside tyres.
      // Only rolling/flex heat uses load here, avoiding a second cornering-work multiplier.
      const pressure=clamp(patches[i].load>0?patches[i].load/(9.81/4):1,.1,6);
      const load=.75+.25*Math.sqrt(pressure);
      // At high downforce the contact area also grows. Heat input is a work
      // density, so a loaded tyre does not absorb all extra force into the same area.
      const power=Math.max(0,work[i]*blend)/Math.sqrt(pressure);
      const retained=power/(1+power/T.workSaturation);
      const roll=T.roll*v/(1+v/T.rollSpeed)*load;
      const exchange=(surface-core)*T.coreExchange;
      this.surface[i]=clamp(surface+response*(squirm*(T.heat*retained+roll)-cooling*(surface-air)-exchange)*dt,air,220);
      this.core[i]=clamp(core+response*(T.coreRate*exchange+squirm*T.coreFlex*v*load-T.coreCool*(core-air))*dt,air,180);
    }
  }

  grip(i:number,compound:Compound):number {
    const [lo,hi]=T.window[compound],surface=this.surface[i],core=this.core[i];
    // Grip returns as the tread warms; a still-cool carcass must not keep a
    // normally driven car in an extended cold-grip phase. Stored heat matters
    // more on the hot side, where we distinguish flash heat from a soaked set.
    const cold=T.coldSurfaceShare*surface+(1-T.coldSurfaceShare)*core;
    if(cold<lo)return Math.max(T.coldFloor,1-T.cold*(lo-cold));
    const operating=T.surfaceShare*surface+(1-T.surfaceShare)*core;
    const hot=T.hot*Math.max(0,operating-hi)+T.flashLoss*Math.max(0,surface-hi-T.flashFrom);
    return Math.max(T.hotFloor,1-hot);
  }

  /** A brief hot tread costs much less life than sustained carcass overheating. */
  overheat(compound:Compound):number {
    const hi=T.window[compound][1];let total=0;
    for(let i=0;i<4;i++)total+=Math.max(0,this.core[i]-hi)+.25*Math.max(0,this.surface[i]-hi-T.flashFrom);
    return total/4;
  }
}
