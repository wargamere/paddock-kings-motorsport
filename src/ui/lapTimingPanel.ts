import { STR } from '../config/strings.ts';
import type { LapTiming } from '../race/lapTiming.ts';
import { formatDelta, formatTime } from '../race/session.ts';
import { h } from './dom.ts';

/** Compact practice feedback; strings are only changed when their displayed value changes. */
export class LapTimingPanel {
  readonly root: HTMLElement;
  private readonly label=h('span',{class:'timing-label'});
  private readonly delta=h('strong',{class:'timing-delta'});
  private readonly values=STR.lapTiming.sectors.map(()=>h('strong'));
  private readonly cells=STR.lapTiming.sectors.map((name,i)=>h('div',{class:'timing-sector'},h('span',{text:name}),this.values[i]));
  private readonly optimal=h('strong');
  private key='';

  constructor() {
    this.root=h('div',{class:'lap-timing'},h('div',{class:'timing-live'},this.label,this.delta),
      h('div',{class:'timing-sectors'},...this.cells),
      h('div',{class:'timing-optimal',title:STR.lapTiming.optimalHint},h('span',{text:STR.lapTiming.optimal}),this.optimal));
    this.root.hidden=true;
  }

  update(t:LapTiming|null,distance:number,time:number):void {
    this.root.hidden=!t;
    if (!t) return;
    const S=STR.lapTiming,delta=t.delta(distance,time);
    const label=t.reason==='invalid'?S.invalid:t.reason==='pit'?S.pit:t.backwards?S.back:t.referenceKind==='personal'?S.personal:t.referenceKind==='session'?S.session:S.first;
    const displayed=delta===null?'—':formatDelta(Math.abs(delta)<.005?0:delta);
    const values=t.sectors.map((v,i)=>v??t.lastSectors[i]);
    const colors=t.sectors.map((v,i)=>t.reason||t.backwards?null:v!==null?t.sectorDeltas[i]:(t.lastValid?t.lastDeltas[i]:null));
    const key=[label,displayed,...values.map(formatTime),...colors.map(v=>v===null?'':v<-.005?'ahead':v>.005?'behind':''),formatTime(t.optimal)].join('|');
    if (key===this.key) return;
    this.key=key;this.label.textContent=label;this.delta.textContent=displayed;
    this.delta.className=`timing-delta${delta===null||Math.abs(delta)<.005?'':delta<0?' ahead':' behind'}`;
    values.forEach((v,i)=>{
      this.values[i].textContent=formatTime(v);
      this.cells[i].className=`timing-sector${t.sectors[i]===null?' previous':''}${colors[i]===null||Math.abs(colors[i]!)<.005?'':colors[i]!<0?' ahead':' behind'}`;
    });
    this.optimal.textContent=formatTime(t.optimal);
  }
}
