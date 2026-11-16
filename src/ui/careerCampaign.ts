import type { CareerSave } from '../career/career.ts';
import { ACHIEVEMENTS, answerPress, currentDecision, currentPress, DECISIONS, departmentCost, DEPARTMENTS, driverProgress, driverRating, dynasty, failureChance, hireStaff, managementOpen, NEWS_KINDS, operatingCosts, releaseStaff, resolveDecision, STAFF, staffMember, trainDriver, TRAINING, upgradeDepartment, type TeamNews } from '../career/dynasty.ts';
import { effectChips, MEDIA, principalOf } from '../career/media.ts';
import { money } from '../career/owner.ts';
import { driverDef, teamsFor } from '../career/roster.ts';
import { button, h } from './dom.ts';

type Changed = () => void;
const label = (text: string) => h('div', { class: 'owner-label', text });
const stat = (name: string, value: string) => h('div', { class: 'campaign-stat' }, label(name), h('strong', { text: value }));
const action = (text: string, fn: () => void, disabled = false, css = '') => { const b = button(text, fn, { class: css }); b.tabIndex = 0; b.disabled = disabled; return b; };
const heading = (tag: string, title: string, copy: string) => h('div', { class: 'owner-section-intro' }, label(tag), h('h1', { text: title }), h('p', { class: 'owner-muted', text: copy }));
const mood = (n: number) => n >= 80 ? 'THRIVING' : n >= 60 ? 'SETTLED' : n >= 40 ? 'UNDER PRESSURE' : 'NEEDS ATTENTION';
const number = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}m` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
function meter(value: number): HTMLElement { const bar = h('div', { class: 'campaign-meter' }, h('i')); (bar.firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(100, value))}%`; return bar; }

/** Original vector portrait: a racing helmet in the team's own colours. */
function helmet(paint: number, accent: number, code: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 100 110'); svg.setAttribute('class', 'campaign-helmet'); svg.setAttribute('aria-hidden', 'true');
  const add = (kind: string, attributes: Record<string, string>) => { const el = document.createElementNS(ns, kind); for (const [k, v] of Object.entries(attributes)) el.setAttribute(k, v); svg.append(el); return el; };
  const colour = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  add('path', { d: 'M8 108 Q12 84 33 82 H67 Q88 84 92 108', fill: '#242e42' });
  add('path', { d: 'M20 45 Q19 12 50 10 Q82 12 82 45 L77 78 Q64 91 43 89 L22 73Z', fill: colour(paint), stroke: '#ffffff55', 'stroke-width': '1.5' });
  add('path', { d: 'M45 11 H57 L67 37 H52Z M24 73 L77 62 L75 74 L42 84Z', fill: colour(accent) });
  add('path', { d: 'M22 41 Q48 33 82 41 L80 57 Q49 51 25 59Z', fill: '#080d18', stroke: '#a3c7e4', 'stroke-width': '2' });
  add('path', { d: 'M31 44 Q46 41 63 43', fill: 'none', stroke: '#c8f0ff44', 'stroke-width': '3' });
  add('path', { d: 'M30 66 H47 M31 71 H43', stroke: '#0a1025aa', 'stroke-width': '3' });
  const text = add('text', { x: '50', y: '105', 'text-anchor': 'middle', fill: '#f1f4ff', 'font-size': '13', 'font-weight': '800', 'font-family': 'system-ui' }); text.textContent = code;
  return svg;
}

/** The inbox filter in use (kept while the hub is open). */
let inboxFilter: 'all' | TeamNews['kind'] = 'all';
const KIND_NAMES: Record<TeamNews['kind'], string> = { team: 'Team', board: 'Board', rival: 'Rivals', press: 'Press', milestone: 'Milestones' };
const roundLabel = (season: number, round: number) => `S${season} · ${round ? `AFTER R${round}` : 'PRE-SEASON'}`;
const chipRow = (chips: readonly string[]) => h('span', { class: 'campaign-chips' }, ...chips.map((c) => h('i', { class: c.endsWith('rivalry') ? 'heat' : c.startsWith('−') ? 'down' : c.startsWith('+') ? 'up' : '', text: c })));

/** How many things in the inbox need an answer (a decision, a press conference). */
export function inboxPending(save: CareerSave): number {
  return (managementOpen(save) && currentDecision(save) ? 1 : 0) + (currentPress(save) ? 1 : 0);
}
/** News the inbox hasn't shown yet. */
export function inboxUnread(save: CareerSave): number {
  const w = save.owner?.world;
  if (!w) return 0;
  const seen = w.news.findIndex((n) => n.id === w.seen);
  return seen < 0 ? w.news.length : seen;
}

function decisionDesk(save: CareerSave, changed: Changed): HTMLElement {
  const w = dynasty(save), decision = currentDecision(save), desk = h('section', { class: 'campaign-decision' });
  if (decision) {
    const fallback = decision.options[DECISIONS[decision.id].fallback];
    desk.append(h('div', { class: 'campaign-desk-top' }, label(`${decision.from} / PRINCIPAL’S DESK`), h('span', { class: 'campaign-deadline', text: managementOpen(save) ? `Answer before qualifying · default: ${fallback.label}` : 'Window closed' })),
      h('h2', { text: decision.title }), h('p', { text: decision.body }));
    for (const [i, option] of decision.options.entries()) {
      const short = save.owner!.cash < option.cost, disabled = !managementOpen(save) || short;
      const b = action('', () => { if (resolveDecision(save, decision.key, i)) changed(); }, disabled, 'campaign-decision-option'); b.setAttribute('aria-label', option.label);
      b.append(h('span', { class: 'campaign-option-index', text: `0${i + 1}` }), h('span', {}, h('strong', { text: option.label }), h('small', { text: short ? `${option.note} Not enough money.` : option.note }), chipRow(option.chips)), h('b', { text: option.followUp ? '↻' : '↗' }));
      if (option.followUp) b.title = 'This leads to a follow-up decision later in the season.';
      desk.append(b);
    }
    if (!managementOpen(save)) desk.append(h('p', { class: 'campaign-notice', text: 'The decision window closed when qualifying set the grid. If you race without answering, the default goes through.' }));
  } else {
    const last = w.decisions[0];
    const t = last && DECISIONS[last.template as keyof typeof DECISIONS];
    desk.append(label('PRINCIPAL’S DESK'), h('h2', { text: last && last.season === save.season && last.round === save.done.length ? 'Decision recorded.' : 'No decisions pending' }),
      h('p', { text: t ? `Last: ${t.title.replaceAll('{driver}', 'Driver').replaceAll('{principal}', 'Rival principal').replaceAll('{rival}', 'Rival')} — ${t.options[last.choice].label}${last.auto ? ' (default, no reply)' : ''}. New decisions arrive between races.` : 'Team decisions, news and milestones are recorded here.' }));
  }
  return desk;
}

function pressDesk(save: CareerSave, changed: Changed): HTMLElement | null {
  const press = currentPress(save);
  if (!press) return null;
  const left = press.answers.filter((a) => a < 0).length;
  const card = h('section', { class: 'campaign-press' }, h('div', { class: 'campaign-desk-top' }, label(`PRESS CONFERENCE / AFTER ROUND ${press.round}`), h('span', { class: 'campaign-deadline', text: `${left} of ${press.questions.length} to answer · skipped questions cost reputation` })),
    h('h2', { text: 'The press want a word.' }), h('p', { text: 'What you say reaches the factory, your drivers, the board and your rivals.' }));
  press.asked.forEach((q, i) => {
    const asked = press.questions[i], answered = press.answers[i];
    const box = h('div', { class: `campaign-question${answered >= 0 ? ' answered' : ''}` }, h('div', { class: 'campaign-asker' }, label(q.outlet.toUpperCase())), h('h3', { text: `“${q.text}”` }));
    if (answered >= 0) box.append(h('p', { class: 'campaign-said', text: `You: “${q.answers[answered].label}”` }));
    else for (const [k, a] of q.answers.entries()) {
      const b = action('', () => { if (answerPress(save, i, k)) changed(); }, false, 'campaign-press-answer');
      b.setAttribute('aria-label', a.label);
      b.append(h('span', { class: 'campaign-tone', text: a.tone }), h('strong', { text: `“${a.label}”` }), chipRow(effectChips(a.effects, asked.driver, asked.other)));
      box.append(b);
    }
    card.append(box);
  });
  return card;
}

export function inboxView(save: CareerSave, changed: Changed): HTMLElement {
  const w = dynasty(save), unread = inboxUnread(save), feed = h('ol', { class: 'campaign-news' });
  const items: { el: HTMLElement; kind: TeamNews['kind'] }[] = [];
  w.news.forEach((item, i) => {
    const link = (item.kind === 'rival' || item.kind === 'milestone') && !item.body.includes('→') ? 'Career record' : null;
    const el = h('li', { class: `news-${item.kind}${i < unread ? ' unread' : ''}` }, h('div', { class: 'campaign-news-meta' }, label(`${i < unread ? '● NEW · ' : ''}${KIND_NAMES[item.kind].toUpperCase()}`), h('span', { text: roundLabel(item.season, item.round) })), h('h3', { text: item.title }), h('p', { text: item.body }), link ? h('small', { class: 'campaign-news-link', text: `More in Championship → ${link}` }) : null);
    items.push({ el, kind: item.kind });
    feed.append(el);
  });
  const apply = () => { for (const it of items) it.el.hidden = inboxFilter !== 'all' && it.kind !== inboxFilter; empty.hidden = items.some((it) => !it.el.hidden); };
  const empty = h('p', { class: 'owner-muted', text: 'Nothing here yet.' });
  const filters = h('div', { class: 'segmented campaign-filters' });
  filters.setAttribute('aria-label', 'Show news');
  for (const kind of ['all', ...NEWS_KINDS] as const) {
    const count = kind === 'all' ? w.news.length : w.news.filter((n) => n.kind === kind).length;
    const b = action(`${kind === 'all' ? 'All' : KIND_NAMES[kind]} · ${count}`, () => { inboxFilter = kind; for (const x of Array.from(filters.children)) x.classList.toggle('on', x === b); apply(); }, false, inboxFilter === kind ? 'on' : '');
    filters.append(b);
  }
  apply();
  // Everything shown has now been seen.
  if (w.news[0]) w.seen = w.news[0].id;
  const pending = inboxPending(save);
  const history = h('details', { class: 'campaign-history' }, h('summary', { text: `Decision history · ${w.decisions.filter((d) => d.season === save.season).length} this season` }));
  for (const d of w.decisions.slice(0, 12)) {
    const t = DECISIONS[d.template as keyof typeof DECISIONS];
    if (!t) continue;
    const o = t.options[d.choice];
    history.append(h('div', { class: 'campaign-history-row' }, h('span', { text: roundLabel(d.season, d.round) }), h('strong', { text: t.title.replace(/\{(driver|principal|rival)\}/g, (_, k: string) => ({ driver: 'Driver', principal: 'Rival principal', rival: 'Rival' })[k]!) }), h('span', { text: `${o.label}${d.auto ? ' · default (no reply)' : ''}` }), chipRow(effectChips(o))));
  }
  if (!w.decisions.length) history.append(h('p', { class: 'owner-muted', text: 'No decisions made yet.' }));
  const pressLog = h('details', { class: 'campaign-history' }, h('summary', { text: `Press conferences · ${w.pressLog.length}` }));
  for (const p of w.pressLog.slice(0, 8)) pressLog.append(h('div', { class: 'campaign-history-row press' }, h('span', { text: roundLabel(p.season, p.round) }), ...p.lines.map((l) => h('p', { text: l }))));
  if (!w.pressLog.length) pressLog.append(h('p', { class: 'owner-muted', text: 'After a win, a podium, a retirement or a long run against your rival, the press want a word.' }));
  return h('section', { class: 'owner-card campaign-inbox' }, heading('TEAM', 'Team inbox', 'Decisions and press waiting for you, then the latest from the factory, the board and the paddock.'),
    h('div', { class: 'campaign-feed-heading' }, label(pending ? `ACTION NEEDED · ${pending}` : 'ALL CAUGHT UP'), h('span', { text: pending ? 'Answer before the next race' : 'Nothing waiting for an answer' })),
    pressDesk(save, changed), decisionDesk(save, changed),
    h('div', { class: 'campaign-feed-heading' }, label(`RECENT UPDATES${unread ? ` · ${unread} NEW` : ''}`), h('span', { text: 'Saved career history' })), filters, feed, empty, history, pressLog);
}

export function driverDevelopmentView(save: CareerSave, changed: Changed): HTMLElement {
  const w = dynasty(save), team = teamsFor(save).find((t) => t.id === save.team)!, group = h('div', { class: 'campaign-driver-programmes' });
  for (const id of team.drivers) {
    const d = driverDef(id)!, p = driverProgress(save, id), card = h('article', { class: 'campaign-driver-dossier' });
    card.append(h('div', { class: 'campaign-dossier-heading' }, helmet(team.paint, team.secondary ?? 0xffffff, d.code), h('div', {}, label('DRIVER DEVELOPMENT'), h('h3', { text: `${d.first} ${d.name}` }), h('span', { class: 'campaign-level', text: `LEVEL ${Math.floor(p.xp / 100) + 1} · ${p.xp} CAREER XP` }))),
      h('div', { class: 'campaign-driver-numbers' }, stat('RATING', String(Math.round(driverRating(save, id) * 100))), stat('MORALE', `${Math.round(p.morale)}%`), stat('PROGRAMME', p.training ? 'BOOKED' : 'OPEN')),
      meter(p.xp >= 500 ? 100 : p.xp % 100), h('p', { class: 'owner-muted', text: p.xp >= 500 ? 'Maximum career level reached.' : `${100 - p.xp % 100} XP to the next development level. Race experience is earned by both drivers.` }));
    const training = h('div', { class: 'campaign-training-options' });
    for (const spec of TRAINING) {
      const b = action(`${spec.name} · ${p[spec.id]}/8`, () => { if (trainDriver(save, id, spec.id)) changed(); }, !managementOpen(save) || !!p.training || p[spec.id] >= 8 || save.owner!.cash < spec.cost);
      b.setAttribute('aria-label', `Train ${d.name}: ${spec.name}`); b.title = `${spec.detail} ${money(spec.cost)}. Delivered after the next completed race.`; training.append(b);
    }
    card.append(training, h('small', { class: 'campaign-training-note', text: p.training ? `${TRAINING.find((t) => t.id === p.training!.focus)!.name} booked · delivered after this race` : `${money(TRAINING[0].cost)} per programme · +${24 + (staffMember(save, 'coach')?.level ?? 0) * 10 + w.departments.simulator * 5} training XP · one per driver per weekend` }));
    group.append(card);
  }
  return h('section', { class: 'campaign-driver-development' }, h('div', { class: 'owner-section-heading' }, label('BUILD YOUR NEXT ADVANTAGE'), h('span', { text: 'Development carries into future seasons.' })), group);
}

export function personnelView(save: CareerSave, changed: Changed): HTMLElement {
  const w = dynasty(save), cards = h('div', { class: 'campaign-staff-grid' });
  for (const role of ['technical', 'coach', 'engineer'] as const) {
    const current = staffMember(save, role), column = h('section', { class: 'campaign-staff-role' });
    column.append(label({ technical: 'TECHNICAL LEADERSHIP', coach: 'DRIVER DEVELOPMENT', engineer: 'RACE OPERATIONS' }[role]), h('h2', { text: current?.name ?? 'Vacant role' }), h('p', { class: 'owner-muted', text: current ? `${current.title} · ${money(current.salary)} per race` : 'No specialist appointed. Compare the candidates below.' }));
    for (const person of STAFF.filter((p) => p.role === role)) {
      const hired = current?.id === person.id, locked = w.reputation < person.reputation;
      const b = action(hired ? `Release ${person.name}` : locked ? `Requires ${person.reputation} reputation` : `Hire ${person.name}`, () => { if (hired ? releaseStaff(save, role) : hireStaff(save, person.id)) changed(); }, !managementOpen(save) || (!hired && (locked || save.owner!.cash < person.fee + person.salary)), hired ? '' : 'primary');
      column.append(h('article', { class: `campaign-staff-card${hired ? ' signed' : ''}` }, h('div', { class: 'campaign-staff-heading' }, h('span', { class: 'campaign-initials', text: person.name.split(' ').map((s) => s[0]).join('') }), h('span', {}, label(person.level === 2 ? 'ELITE SPECIALIST' : 'ESTABLISHED SPECIALIST'), h('strong', { text: person.name }))), h('p', { text: person.detail }), h('div', { class: 'campaign-contract-price' }, stat('SIGNING FEE', money(person.fee)), stat('PER RACE', money(person.salary))), b));
    }
    cards.append(column);
  }
  return h('section', { class: 'owner-card campaign-personnel' }, heading('DRIVERS & STAFF', 'Personnel', 'One specialist per role. Pay a signing fee now and a salary after each race. Keep one salary in reserve when hiring. Signing fees are not refunded on replacement.'),
    h('div', { class: 'campaign-pulse' }, stat('APPOINTED', `${Object.keys(w.staff).length} / 3`), stat('OPERATIONS / RACE', money(operatingCosts(save))), stat('REPUTATION', `${w.reputation} / 100`)), cards);
}

export function departmentsView(save: CareerSave, changed: Changed): HTMLElement {
  const w = dynasty(save), cards = h('div', { class: 'campaign-departments' });
  for (const spec of DEPARTMENTS) {
    const level = w.departments[spec.id], cost = departmentCost(save, spec.id);
    const b = action(level >= 3 ? 'Fully developed' : `Expand ${spec.name} · ${money(cost)}`, () => { if (upgradeDepartment(save, spec.id)) changed(); }, !managementOpen(save) || level >= 3 || save.owner!.cash < cost, 'primary');
    cards.append(h('article', { class: 'campaign-department' }, h('span', { class: 'campaign-department-icon', text: spec.icon }), label(`LEVEL ${level} / 3`), h('h3', { text: spec.name }), h('p', { text: spec.detail }), h('div', { class: 'campaign-building-levels' }, ...[1, 2, 3].map((i) => h('i', { class: level >= i ? 'built' : '' }))), h('small', { text: `${money(level * 25_000)} operating cost / race` }), b));
  }
  return h('section', { class: 'campaign-department-section' }, h('h2', { text: 'A factory built for your ambition.' }), h('p', { class: 'owner-muted', text: 'Specialist departments carry over between seasons. Build what your team needs; every level adds $25k to race operating costs.' }), cards);
}

export function legacyView(save: CareerSave): HTMLElement {
  const w = dynasty(save), rival = teamsFor(save).find((t) => t.id === w.rival.id), trophies = h('div', { class: 'campaign-achievements' });
  const seasons = h('section', { class: 'career-season-archive' }, h('h2', { text: 'Your seasons' }));
  for (const record of [...save.history].reverse()) {
    const r = record.report;
    seasons.append(h('article', {}, label(`SEASON ${record.season} · CONSTRUCTORS P${record.teamPosition}`), h('h3', { text: r?.teamName ?? teamsFor(save).find(t => t.id === record.team)?.name ?? record.team }), h('p', { text: r ? `${r.teamPoints} team points · ${r.teamWins} wins · ${r.teamPodiums} podiums · ${r.endIndex} PI` : `${record.points} driver points · ${record.wins} wins` }), r ? h('small', { text: `${r.drivers.map(d => `${d.name}: P${d.position}, ${d.points} points`).join(' · ')} · ${money(r.prize)} championship prize` }) : null));
  }
  if (!save.history.length) seasons.append(h('p', { class: 'owner-muted', text: 'Complete your first season to begin the archive.' }));
  for (const [id, name, detail] of ACHIEVEMENTS) trophies.append(h('article', { class: w.achievements.includes(id) ? 'earned' : '' }, h('span', { class: 'campaign-trophy', text: w.achievements.includes(id) ? '◆' : '◇' }), label(w.achievements.includes(id) ? 'ACHIEVED' : 'THE NEXT CHAPTER'), h('h3', { text: name }), h('p', { text: detail })));
  return h('section', { class: 'owner-card campaign-legacy' }, heading('CHAMPIONSHIP', 'Career record', 'Season records, team rivalry and career milestones.'),
    h('div', { class: 'campaign-pulse' }, stat('SEASONS COMPLETED', String(save.history.length)), stat('SUPPORTERS', number(w.fans)), stat('MILESTONES', `${w.achievements.length} / ${ACHIEVEMENTS.length}`)),
    rivalCard(save, rival?.name), trophies, seasons);
}

function rivalCard(save: CareerSave, name: string | undefined): HTMLElement {
  const w = dynasty(save), r = w.rival, n = Math.abs(r.streak);
  const run = n >= 2 ? (r.streak > 0 ? `You’ve beaten them ${n} races in a row.` : `They’ve beaten you ${n} races in a row.`) : r.won + r.lost + r.tied ? 'No run either way right now.' : 'The season hasn’t started yet.';
  const heat = r.tension >= 80 ? 'BITTER' : r.tension >= MEDIA.heated ? 'HEATED' : r.tension >= 35 ? 'SIMMERING' : 'CORDIAL';
  const duels = h('div', { class: 'campaign-duels' });
  for (const [id, d] of Object.entries(w.duels)) {
    const k = Math.abs(d.streak);
    duels.append(h('div', { class: 'campaign-duel' }, h('strong', { text: `${driverDef(id)?.name ?? id} vs ${driverDef(d.rival)?.name ?? d.rival}` }), h('span', { text: `${d.won}–${d.lost}${k >= 2 ? ` · ${d.streak > 0 ? 'ahead' : 'behind'} ${k} in a row` : ''}` })));
  }
  return h('div', { class: 'campaign-rival-card' }, label('THIS SEASON’S RIVAL'), h('h2', { text: name ?? 'The next challenger' }), h('p', { class: 'campaign-principal', text: `Team principal: ${principalOf(r.id)}` }),
    h('strong', { text: `${r.won} WINS · ${r.lost} LOSSES · ${r.tied} DRAWS` }), h('p', { text: run }),
    h('div', { class: 'campaign-tension' }, label(`RIVALRY · ${heat}`), meter(r.tension)), duels,
    h('p', { text: 'Each race compares both teams’ points, and each of your drivers against the rival driver in the same seat. Close fights, long runs and what you say to the press heat it up; when it’s heated, wins lift the team more and defeats hurt more. Finish the season ahead to earn the rivalry milestone.' }));
}

export function campaignDebrief(save: CareerSave): HTMLElement {
  const w = dynasty(save), updates = w.news.filter((n) => n.season === save.season && n.round === save.done.length && n.kind !== 'press').slice(0, 3);
  return h('section', { class: 'campaign-debrief' }, label('THE TEAM AFTER THE CHEQUERED FLAG'), h('div', { class: 'campaign-pulse' }, stat('BOARD CONFIDENCE', `${Math.round(w.confidence)}%`), stat('TEAM MORALE', mood(w.morale)), stat('SUPPORTERS', number(w.fans))),
    ...updates.map((n) => h('div', { class: 'campaign-debrief-line' }, h('strong', { text: n.title }), h('p', { text: n.body }))),
    w.press ? h('p', { class: 'campaign-notice', text: 'The press want a word: answer them in the Inbox before the next race.' }) : null);
}

export function campaignSeasonReview(save: CareerSave): HTMLElement {
  const w = dynasty(save), cost = operatingCosts(save);
  return h('section', { class: 'campaign-review' }, label('THE OWNER’S SEASON REVIEW'), h('h2', { text: 'Team progress' }),
    h('div', { class: 'campaign-pulse' }, stat('BOARD CONFIDENCE', `${Math.round(w.confidence)}%`), stat('REPUTATION', `${w.reputation} / 100`), stat('FANS', number(w.fans))),
    h('p', { text: `${w.rival.won}–${w.rival.lost} in your rivalry. ${w.achievements.length} career milestones. Your staff, department levels, driver development and remaining funds carry into next season.` }),
    h('small', { text: `Current team operations: ${money(cost)} per race. Your completed board objective bonus, when earned, is already in the finance ledger.` }));
}

export function reliabilityLabel(save: CareerSave): string { const team = teamsFor(save).find((t) => t.id === save.team)!, id = team.drivers.find((d) => d !== save.owner?.selected) ?? team.drivers[0]; return `${driverDef(id)!.name} · ${(failureChance(save, id) * 100).toFixed(1)}% failure risk`; }
