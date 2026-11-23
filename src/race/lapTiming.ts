/** A compact time-at-distance reference. Samples are integer milliseconds at 256 equal distances. */
export interface LapReference { length: number; time: number; samples: number[]; sectors: [number, number, number] }
export const LAP_SAMPLES = 256;

/** Old saves need no reference; corrupt or incompatible profiles never produce a live delta. */
export function cleanLapReference(raw: unknown, time?: number, length?: number): LapReference | null {
  if (!raw || typeof raw !== 'object') return null;
  const r=raw as LapReference;
  if (!Number.isFinite(r.length)||r.length<10||r.length>100_000||!Number.isFinite(r.time)||r.time<=0||r.time>86400) return null;
  if (time!==undefined && Math.abs(r.time-time)>.000001) return null;
  if (length!==undefined && Math.abs(r.length-length)>.01) return null;
  if (!Array.isArray(r.samples)||r.samples.length!==LAP_SAMPLES+1||r.samples[0]!==0||r.samples.at(-1)!==Math.round(r.time*1000)) return null;
  let previous=0;
  for (const n of r.samples) { if (!Number.isInteger(n)||n<previous||n>86_400_000) return null; previous=n; }
  if (!Array.isArray(r.sectors)||r.sectors.length!==3||r.sectors.some(t=>!Number.isFinite(t)||t<=0)||Math.abs(r.sectors.reduce((a,b)=>a+b,0)-r.time)>.005) return null;
  return { length:r.length,time:r.time,samples:[...r.samples],sectors:[...r.sectors] };
}

/** Reference time at the same distance, rather than comparing two cars at the same instant. */
export function referenceTime(ref: LapReference, distance: number): number {
  const f=Math.max(0,Math.min(LAP_SAMPLES,distance/ref.length*LAP_SAMPLES)),i=Math.min(LAP_SAMPLES-1,Math.floor(f)),u=f-i;
  return (ref.samples[i]*(1-u)+ref.samples[i+1]*u)/1000;
}

export class LapTiming {
  readonly sectors: (number|null)[]=[null,null,null];
  readonly sectorDeltas: (number|null)[]=[null,null,null];
  readonly lastSectors: (number|null)[]=[null,null,null];
  readonly lastDeltas: (number|null)[]=[null,null,null];
  readonly bestSectors: (number|null)[]=[null,null,null];
  reference: LapReference|null=null;
  referenceKind: 'personal'|'session'|null=null;
  reason: ''|'invalid'|'pit'='';
  backwards=false;
  lastValid=false;
  private sessionBest: LapReference|null=null;
  private running=false;
  private readonly samples=new Int32Array(LAP_SAMPLES+1);
  private next=1;
  private distance=0;
  private elapsed=0;
  private furthest=0;
  private sector=0;
  private sectorStart=0;

  readonly length:number;
  constructor(length:number) { this.length=length; }

  /** Stop sampling on a restart; session best sectors can survive a practice retry. */
  cancel():void { this.running=false; }

  begin(personal:LapReference|null):void {
    const saved=cleanLapReference(personal,undefined,this.length);
    this.reference=saved??this.sessionBest;
    this.referenceKind=saved?'personal':this.sessionBest?'session':null;
    this.sectors.fill(null);this.sectorDeltas.fill(null);this.samples.fill(-1);this.samples[0]=0;
    this.next=1;this.distance=this.elapsed=this.furthest=this.sector=this.sectorStart=0;
    this.reason='';this.backwards=false;this.running=true;
  }

  invalidate(reason:'invalid'|'pit'='invalid'):void { if (this.running && (this.reason===''||reason==='invalid')) this.reason=reason; }

  advance(distance:number,time:number):void {
    if (!this.running||!Number.isFinite(distance)||!Number.isFinite(time)||time<this.elapsed||distance<0||distance>this.length+.01) return;
    distance=Math.min(this.length,distance);
    const step=distance-this.distance,dt=time-this.elapsed;
    if (step>Math.max(3,dt*150)+.001) this.invalidate();
    this.backwards=distance<this.furthest-.05;
    if (step>0) {
      const at=(mark:number)=>this.elapsed+(time-this.elapsed)*(mark-this.distance)/step;
      while (this.next<=LAP_SAMPLES && this.length*this.next/LAP_SAMPLES<=distance+1e-9) {
        const mark=this.length*this.next/LAP_SAMPLES;
        if (mark>=this.distance-1e-9) this.samples[this.next]=Math.round(at(mark)*1000);
        this.next++;
      }
      while (this.sector<2 && this.length*(this.sector+1)/3<=distance+1e-9) {
        const cumulative=at(this.length*(this.sector+1)/3),value=cumulative-this.sectorStart;
        this.sectors[this.sector]=value;
        this.sectorDeltas[this.sector]=this.reference?value-this.reference.sectors[this.sector]:null;
        this.sectorStart=cumulative;this.sector++;
      }
    }
    this.furthest=Math.max(this.furthest,distance);this.distance=distance;this.elapsed=time;
  }

  finish(time:number,valid:boolean):LapReference|null {
    if (!this.running) return null;
    if (!valid) this.invalidate();
    this.advance(this.length,time);this.running=false;
    if (this.sector===2) { this.sectors[2]=time-this.sectorStart;this.sectorDeltas[2]=this.reference?this.sectors[2]!-this.reference.sectors[2]:null; }
    const ref=valid&&!this.reason&&this.next===LAP_SAMPLES+1?cleanLapReference({length:this.length,time,samples:Array.from(this.samples),sectors:this.sectors}):null;
    this.lastValid=ref!==null;
    if (!ref && !this.reason) this.reason='invalid';
    for(let i=0;i<3;i++){this.lastSectors[i]=this.sectors[i];this.lastDeltas[i]=this.lastValid?this.sectorDeltas[i]:null;}
    if (!ref) return null;
    for(let i=0;i<3;i++)this.bestSectors[i]=Math.min(this.bestSectors[i]??Infinity,ref.sectors[i]);
    if (!this.sessionBest||time<this.sessionBest.time)this.sessionBest=ref;
    return ref;
  }

  delta(distance:number,time:number):number|null {
    return this.reference&&!this.reason&&!this.backwards&&Number.isFinite(distance)&&Number.isFinite(time)&&distance>=0&&distance<=this.length?time-referenceTime(this.reference,distance):null;
  }

  get optimal():number|null { return this.bestSectors.every(t=>t!==null)?this.bestSectors.reduce<number>((sum,t)=>sum+(t??0),0):null; }
}
