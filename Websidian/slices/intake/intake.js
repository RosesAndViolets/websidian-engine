/** One food under two names scores twice off two sets of numbers, and nothing
 *  else on the page would ever say so — which is the whole risk of writing meals
 *  in Korean one week and English the next. Surfaced here rather than left to be
 *  noticed. */
function dupeNotice() {
  const d = META.dupes || {}, hit = (d.collision || []).length + (d.twin || []).length;
  if (!hit) return '';
  const pair = ns => ns.map(n => `<b>${esc(n)}</b>`).join(' = ');
  return `<div class="log" style="margin:12px 0">
    ${(d.collision || []).map(([name, owner]) =>
      `<div><b>${esc(name)}</b> is its own row and also an alias of
       <b>${esc(owner)}</b> — one of them has to go.</div>`).join('')}
    ${(d.twin || []).length ? `<div>Same numbers, different rows — alias them together
      in <code>Data/ingredients.csv</code> if they are the same food:</div>
      <div style="margin-top:5px">${d.twin.map(pair).join('<br>')}</div>` : ''}
  </div>`;
}

let intakeDay = null;   // the day On record is showing; null means today

/** Nutrient naming and units, shared by every block below. Names come from the
 *  columns of ingredients.csv, so a new column needs no code here. */
const MACROS = ['carbs', 'protein', 'fat'];
const UNIT = n => n === 'kcal' ? ' kcal' : /sodium|salt/.test(n) ? ' mg' : ' g';
const NUTRIENT_NAME = {kcal: 'Calories', carbs: 'Carbs', protein: 'Protein', fat: 'Fat',
                       fiber: 'Fibre', fibre: 'Fibre', sugar: 'Sugar', sodium: 'Sodium'};
const nice = n => NUTRIENT_NAME[n] || n.charAt(0).toUpperCase() + n.slice(1).replace(/_/g, ' ');

/** Distance from the target, not a share of it: the notch sits at NOTCH of the
 *  width, so a value short of the target stops before it and one past it runs
 *  over. A bar that clamped at the target could not say by how much you passed.
 *  Shared by On record's meters and the month calendar so both read alike.
 *  ponytail: the scale clamps at 1/NOTCH × target, so two very heavy days look
 *  alike up there. Fine while a bad day is ~1.4×; log-scale it if it stops being. */
const NOTCH = .62;
/* `sim` is the simulator's proposed addition, drawn as a paler run continuing
   from where the eaten part stops. The solid part keeps the colour the logged
   value earns and the pale part takes its own — so a bar that is green up to
   the notch and pale crimson past it says "you are under, and this would put
   you over" in one read, which two figures and a subtraction could not. */
const distBar = (v, t, sim = 0) => {
  if (!t) return '';
  const at = x => Math.min(100, x / t * NOTCH * 100);
  return `<div class="dbar${v > t ? ' over' : ''}">
    <i style="width:${at(v).toFixed(1)}%"></i>
    ${sim > 0 ? `<u class="${v + sim > t ? 'over' : ''}" style="left:${at(v).toFixed(1)}%;
      width:${Math.max(0, at(v + sim) - at(v)).toFixed(1)}%"></u>` : ''}
    <s style="left:${NOTCH * 100}%"></s></div>`;
};

/** Everything that can be priced: every reference food, then every dish.
 *
 *  A food carries per-100 g numbers and is ordered by weight; a dish carries
 *  the totals for one serving and is ordered by servings. Keeping the two in
 *  one list is what lets the box answer "egg" and "순두부" from one field.
 */
function simCatalog() {
  return (META.ingredients || []).map(f => ({
    kind: 'food', key: f.name, portion: f.portion, aka: f.aka || [], per: f}))
    .concat((META.recipes || []).map(d => ({
      kind: 'dish', key: d.dish, portion: 0, aka: [], per: d})));
}

/** What a food is called, in every language it is called it. The name first,
 *  because that is what a pick puts back in the box. */
const simNames = e => [e.kind === 'dish' ? dishName(e.key) : e.key, ...e.aka];

/** Everything matching what has been typed, best first.
 *
 *  Ranked rather than filtered, and the ranks are the point. Typing `e` should
 *  offer every food whose name *starts* with it — that is what makes the box
 *  browsable from one keystroke — and typing `eg` should have narrowed to the
 *  egg before anything containing "eg" in the middle of a word gets a look in.
 *  So a prefix of a name outranks a prefix of a word inside one, which outranks
 *  a match buried anywhere.
 *
 *  Spaces are ignored on the last tier only. Folding them everywhere would let
 *  `eg` reach `계란 후라이 gochujang` through a gap, which is the opposite of
 *  narrowing; keeping them on the prefix tiers is what makes the second letter
 *  cut the list down rather than reshuffle it.
 */
function simMatches(q) {
  const low = s => s.toLowerCase();
  const tight = s => s.replace(/\s+/g, '').toLowerCase();
  const f = low(q.trim());
  if (!f) return [];
  const t = tight(q);
  const rank = e => {
    const names = simNames(e);
    if (names.some(n => low(n) === f)) return 0;
    if (names.some(n => low(n).startsWith(f))) return 1;
    // A word inside the name: `soy` should reach `soy sauce` and also `light soy`.
    if (names.some(n => low(n).split(/[\s(;,·\/-]+/).some(w => w.startsWith(f)))) return 2;
    // Buried matches, but only once there are two characters to bury. One
    // letter would drag in every food with an `e` anywhere — `chicken`,
    // `ice cream` — and the first keystroke is exactly where the list has to be
    // shortest. Two is enough to make `구마` reach `고구마`, which has no word
    // boundary to catch it at.
    if (f.length > 1 && names.some(n => tight(n).includes(t))) return 3;
    return 99;
  };
  return simCatalog().map(e => ({e, r: rank(e)})).filter(x => x.r < 99)
    .sort((a, b) => a.r - b.r || simNames(a.e)[0].localeCompare(simNames(b.e)[0]))
    .map(x => x.e);
}

/** What Enter takes when nothing in the list was highlighted: the same thing
 *  the list would have put at the top. One implementation, so the box can never
 *  add something other than what it was offering. */
const simFind = q => simMatches(q)[0] || null;

/** Everything, alphabetically — what an empty box offers. "Is it even in
 *  there" is a fair question to have about a file you never see, and a list
 *  that opens before you type is the cheapest possible answer to it. */
const simAll = () => simCatalog()
  .sort((a, b) => simNames(a)[0].localeCompare(simNames(b)[0]));

/** One entry's contribution, or a sentence saying why it cannot have one.
 *
 *  A count is only answerable when something says what one of the thing weighs.
 *  57 of the 171 reference rows have no `portion_g`, egg among them, so this
 *  refuses rather than assuming a weight — an invented 50 g would propagate
 *  into every figure on the card looking exactly as solid as a measured one.
 */
function simPrice(e, amount, unit) {
  if (!(amount > 0)) return {error: 'How much?'};
  if (e.kind === 'dish') {
    if (unit !== 'x') return {error: `${dishName(e.key)} is a dish — count servings, not grams.`};
    return {kind: 'dish', key: e.key, label: dishName(e.key), servings: amount,
            amount: `${amount} serving${amount === 1 ? '' : 's'}`,
            per: scaleNutrients(e.per, amount)};
  }
  if (unit === 'x' && !e.portion) {
    return {error: `No portion weight for ${e.key} in ingredients.csv — give it grams,
      or add a portion_g to that row.`};
  }
  const grams = unit === 'x' ? amount * e.portion : amount;
  return {kind: 'food', key: e.key, label: e.key, grams: Math.round(grams * 10) / 10,
          amount: unit === 'x' ? `${amount} × ${e.portion} g` : `${grams} g`,
          per: scaleNutrients(e.per, grams / 100)};
}

/** Every nutrient column, scaled by one factor. Reads the columns off the row
 *  rather than a list here, so a new one in `ingredients.csv` is priced too. */
const scaleNutrients = (per, by) => Object.fromEntries(
  (META.nutrients || []).map(n => [n, Math.round((per[n] || 0) * by * 10) / 10]));

/** The composer. Separate from the record so either can stand alone — the
 *  record is a widget the Global Home board can carry, and a board that showed
 *  a save box you did not ask for would be the wrong kind of helpful. */
function intakeComposer() {
  return captureBox({folder: 'Intake', title: 'Daily intake',
    blurb: `Write what you ate — one meal, a snack, or the whole day. Saved straight to
      <code>Inbox/Intake/</code> as a dated <code>.md</code>, same as Write &amp; drop.`,
    placeholder: 'Lunch — two eggs on sourdough, a flat white, half an apple.\n\n\u2318\u23ce to save.'});
}

/** `quiet` suppresses the card's intro animation. A redraw from the simulator
 *  is the same card with two numbers changed, and replaying the arc, the figure
 *  and the fourteen staggered bars every time a food is tried made adding three
 *  foods look like three page loads. */
function onRecord(quiet) {
  const rows = META.intake || [];
  const day = intakeDay || today();
  const mine = rows.filter(e => (e.when || '').startsWith(day));
  const sum = k => mine.reduce((s, e) => s + (e[k] || 0), 0);
  const T = META.targets || {};

  const byDay = {};
  rows.forEach(e => {
    const d = (e.when || '').slice(0, 10);
    if (d) byDay[d] = (byDay[d] || 0) + (e.kcal || 0);
  });
  const days = [...Array(14)].map((_, i) => {
    const d = today(new Date(Date.now() - (13 - i) * 864e5));
    return {d, kcal: byDay[d] || 0};
  });
  const peak = Math.max(1, ...days.map(x => x.kcal));
  // The fortnight is drawn as distance from the goal, not as raw totals: 1500
  // kcal means nothing until you know it was 90 over. Scale off the widest miss
  // so a fortnight that stayed close still shows its shape.
  const swing = Math.max(1, ...days.filter(x => x.kcal).map(x => Math.abs(x.kcal - (T.kcal || 0))));

  // A column of ingredients.csv gives a nutrient its number, a targets.csv row
  // gives it a meter — neither needs code here.
  const NUTRIENTS = META.nutrients || [];

  // The what-if simulator that used to feed this was removed in favour of
  // Quick log — kept as a standing zero rather than stripped out of gauge()
  // and meter() below, since their "trying this" branches are otherwise
  // untouched and still correct with nothing ever trying anything.
  const simOf = () => 0;

  const meter = (n, cls) => {
    const v = sum(n), s = simOf(n), t = T[n] || 0, over = t && v + s > t;
    return `<div class="meter ${cls}${over ? ' over' : ''}">
      <div class="mrow"><span>${nice(n)}</span>${t ? `<b class="d ${over ? 'over' : 'under'}">${
        over ? '+' : '−'}${Math.abs(Math.round(v + s - t))}</b>` : ''}</div>
      ${t ? distBar(v, t, s) : '<div class="bar"><i style="width:0"></i></div>'}
      <div class="mval"><b>${v}</b>${s ? `<u>+${Math.round(s)}</u>` : ''}${
        t ? `<span> / ${t}${UNIT(n)}</span>` : `<span>${UNIT(n)}</span>`}</div>
    </div>`;
  };

  // Semicircular gauge. pathLength=100 makes the dash array a straight
  // percentage, so no arc trigonometry is needed — including the target notch,
  // which is a 1-unit dash pushed NOTCH of the way along the same arc.
  const gauge = () => {
    const v = sum('kcal'), s = Math.round(simOf('kcal')), t = T.kcal || 0;
    const at = x => Math.min(100, x / t * NOTCH * 100);
    const pct = t ? at(v) : 0;
    // The simulated arc continues the filled one: same dash array trick, pushed
    // along by the offset so it starts exactly where the eaten part stops.
    const simPct = t && s ? Math.max(0, at(v + s) - pct) : 0;
    const left = t - v - s, arc = 'M14,96 A82,82 0 0 1 178,96';
    return `<div class="gaugewrap${t && v + s > t ? ' over' : ''}">
      <svg viewBox="0 0 192 104" class="gauge" role="img"
           aria-label="${v}${s ? ` plus ${s} being tried` : ''} of ${t || '?'} kcal">
        <path class="track" d="${arc}" pathLength="100"/>
        ${simPct ? `<path class="sim" d="${arc}" pathLength="100"
              stroke-dasharray="${simPct.toFixed(1)} 100"
              stroke-dashoffset="${-pct.toFixed(1)}"/>` : ''}
        <path class="fill" d="${arc}" pathLength="100"
              stroke-dasharray="${pct.toFixed(1)} 100"/>
        ${t ? `<path class="notch" d="${arc}" pathLength="100"
              stroke-dasharray="1 100" stroke-dashoffset="${-(NOTCH * 100) + .5}"/>` : ''}
      </svg>
      <div class="gnum"><b>${v}</b>${s ? `<u>+${s}</u>` : ''}${
        t ? `<span>/ ${t} kcal</span>` : '<span>kcal</span>'}</div>
      ${t ? `<div class="gleft">${left >= 0
        ? `<b>${left}</b> kcal left${s ? ' if you eat that' : ' today'}`
        : `<b class="hot">${-left}</b> kcal over${s ? ' if you eat that' : ''}`}</div>` : ''}
    </div>`;
  };

  return `<div class="box s7 record${quiet ? ' quiet' : ''}"><h3>On record${
      day === today() ? '' : ' · ' + day}
      <em><input type="date" id="intakeday" value="${day}" max="${today()}"
        title="Show another day"></em></h3>
    ${gauge()}
    <div class="macros">${MACROS.filter(n => NUTRIENTS.includes(n))
      .map(n => meter(n, 'big')).join('')}</div>
    ${(() => {
      const rest = NUTRIENTS.filter(n => n !== 'kcal' && !MACROS.includes(n))
        .filter(n => sum(n) || T[n]);
      return rest.length ? `<div class="macros extra">${
        rest.map(n => meter(n, 'small')).join('')}</div>` : '';
    })()}
    <div class="hint" style="margin-top:10px">A meter per column in
      <code>Data/ingredients.csv</code>; add a row to <code>Data/targets.csv</code>
      to give one a goal.</div>
    ${(META.intakeUnknown || []).length ? `<details style="margin-top:8px">
      <summary class="hint">${META.intakeUnknown.length} log name${
        META.intakeUnknown.length === 1 ? '' : 's'} with no reference row — scored zero</summary>
      <div class="log">${META.intakeUnknown.map(n => esc(n)).join('\n')}</div></details>` : ''}
    ${dupeNotice()}
    ${!rows.length ? '' : T.kcal
      ? `<div class="spark dev">${days.map((x, i) => {
          const dv = Math.round(x.kcal - T.kcal);
          const sign = `${dv > 0 ? '+' : '−'}${Math.abs(dv)}`;
          // Today's column carries the simulation as the *slice between* where
          // the day stands and where it would land — not a second bar from the
          // line, which would have sat invisibly inside the real one whenever
          // eating shrank the deficit. Taking the segment [dv, sd] and cutting
          // it at zero also handles the crossing case with no special branch:
          // a day 100 under that eats 300 gets a pale piece filling the last of
          // the green *and* a pale piece 200 above the line.
          const sd = x.kcal && x.d === today() ? Math.round(dv + simOf('kcal')) : dv;
          const at = k => Math.abs(k) / swing * 25;
          const lo = Math.min(dv, sd), hi = Math.max(dv, sd);
          // Each side takes the part of [lo, hi] that falls on it, as distances
          // out from the line. An empty intersection collapses to b <= a.
          const piece = (cls, a, b) => b <= a ? '' : `<s class="${cls}"
            style="--s0:${at(a).toFixed(1)}%;--sh:${(at(b) - at(a)).toFixed(1)}%"></s>`;
          return `<i class="${!x.kcal ? 'z' : dv > 0 ? 'over' : 'under'}${
              x.d === day ? ' sel' : ''}" data-day="${x.d}"
            data-d="${x.kcal ? sign : ''}"
            style="--h:${x.kcal ? at(dv).toFixed(1) : 0}%;--n:${i}"
            title="${x.d} — ${x.kcal ? `${x.kcal} kcal · ${sign} kcal against ${T.kcal}`
              : 'nothing logged'}${sd !== dv ? ` · ${sd > 0 ? '+' : '−'}${Math.abs(sd)}
              if you eat what you are trying` : ''}">${sd === dv ? ''
              : piece('under', Math.max(0, -hi), Math.max(0, -lo))
                + piece('over', Math.max(0, lo), hi)}</i>`;
        }).join('')}</div>
      <div class="hint">Last 14 days against the ${T.kcal} kcal goal · dotted line is the
        goal · click a bar for that day</div>`
      : `<div class="spark">${days.map((x, i) =>
          `<i class="${x.kcal ? '' : 'z'}${x.d === day ? ' sel' : ''}" data-day="${x.d}"
            style="height:${Math.max(2, x.kcal / peak * 100)}%;--n:${i}"
            title="${x.d} — ${x.kcal ? x.kcal + ' kcal' : 'nothing logged'}"></i>`).join('')}</div>
        <div class="hint">Last 14 days · peak ${peak} kcal · click a bar for that day</div>`}
    ${mine.length
      ? `<ul class="todo" style="margin-top:16px">${mine.map(e =>
          `<li><span class="when">${esc((e.when || '').slice(11, 16))}</span>
           ${esc(e.meal)}${e.source === 'manual' ? ' <span class="badge">manual</span>' : ''}
           <span class="when">${e.kcal} kcal · ${
             MACROS.filter(n => NUTRIENTS.includes(n))
               .map(n => `${e[n]}${n[0]}`).join(' ')}</span>${online ? `
           <button type="button" class="rowbtn" data-editmeal="${esc(JSON.stringify(
             {when: e.when, meal: e.meal, items: e.items}))}">edit</button>
           <button type="button" class="rowbtn" data-delmeal="${esc(JSON.stringify(
             {when: e.when, meal: e.meal}))}">delete</button>` : ''}
           <div class="hint" style="margin-top:2px">${e.items.map(i =>
             `${esc(i.ingredient)} ${i.grams} g`).join(' · ')}</div></li>`).join('')}</ul>`
      : `<div class="stats" style="margin:16px 0 0">Nothing on record for ${
           day === today() ? 'today' : day}.
         ${rows.length ? rows.length + ' meals in total.' : ''}</div>`}
  </div>`;
}



/** The phase that is running: started, not ended. `null` when none is. */
function livePhase() {
  const live = (META.phases || []).filter(p => p.started && !p.ended);
  return live.length ? live[live.length - 1] : null;
}

const DAY = 864e5;
const asDate = d => Date.parse(d + 'T00:00:00');

/** kg per week over a trailing window, as a least-squares fit rather than a
 *  difference between the last two readings.
 *
 *  The difference is what anyone writes first and it is unusable here: a log
 *  can hold two readings a kilo apart six days out, which differenced reads as
 *  a kilo a week and is really a glass of water. A fit over four weeks uses every
 *  reading in the window, so one heavy morning moves it a little instead of
 *  deciding it.
 *
 *  Needs three readings **and two weeks between the first and the last**, and
 *  the second condition is the one that matters. Three readings say nothing
 *  about how far apart they are: this log's most recent three sit inside eight
 *  days and include a 1 kg overnight swing, which fits to 1.47 kg/week and would
 *  have put the gauge over its ceiling on the day the phase opened. A slope is
 *  only a trend if it is measured across more time than the noise takes to
 *  cancel, so a short window returns nothing rather than a confident number.
 */
const MIN_SPAN_DAYS = 14;

function trendPerWeek(log, days = 28) {
  const cut = Date.now() - days * DAY;
  const pts = log.filter(r => asDate(r.date) >= cut);
  if (pts.length < 3) return null;
  const span = (asDate(pts[pts.length - 1].date) - asDate(pts[0].date)) / DAY;
  if (span < MIN_SPAN_DAYS) return {perWeek: null, n: pts.length, span,
                                    since: pts[0].date};
  const t0 = asDate(pts[0].date);
  const xs = pts.map(r => (asDate(r.date) - t0) / DAY), ys = pts.map(r => r.kg);
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  if (!den) return null;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / den;
  return {perWeek: slope * 7, n, span, since: pts[0].date};
}

/** How a phase is going: the rate it wants, the rate it is getting, and when
 *  that arrives. `dir` is +1 for a phase that gains and -1 for one that loses,
 *  so everything downstream compares magnitudes and never signs. */
function phaseProgress(phase, log) {
  const dir = phase.to_kg > phase.from_kg ? 1 : -1;
  const now = log.length ? log[log.length - 1] : null;
  const trend = trendPerWeek(log);
  // `perWeek` is null when the window is too short to fit — the readings exist
  // and are reported, the slope through them is refused.
  const moving = trend && trend.perWeek !== null ? trend.perWeek * dir : null;
  const left = now ? Math.abs(phase.to_kg - now.kg) : null;
  // Weeks remaining at the corridor's own bounds, not at the observed rate:
  // the plan's arrival date is what the plan can promise. The observed rate is
  // reported beside it and never folded into it.
  const weeks = phase.rate_hi ? [left / phase.rate_hi, left / phase.rate_lo] : null;
  return {dir, now, trend, moving, left, weeks,
          fast: moving !== null && moving > phase.rate_hi,
          slow: moving !== null && moving < phase.rate_lo};
}

// `addDays` comes from slices/todo/todo.js, and is reused rather than rewritten
// for a reason recorded there: it anchors to UTC, and the obvious local-time
// version silently lands a day early in JST.
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthDay = d => `${MONTH[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;

/** Weight, read against the phase it is in.
 *
 *  The card this replaced computed progress as the share of the distance from
 *  the first ever weigh-in to one target, which cannot survive a cycle: gaining
 *  on purpose drained the bar and lit the warn tile, so four months of a
 *  successful bulk would have rendered as four months of failure.
 *
 *  What replaces it is the rate, because the rate is the whole substance of the
 *  plan. Too fast is the dangerous direction and it is invisible on a progress
 *  bar — on a progress bar, too fast looks like ahead of schedule.
 */
function weightBlock() {
  const log = META.weight || [], target = (META.targets || {}).weight;
  if (!log.length || !target) return `<p class="hint">Add a row to
    <code>Data/weight.csv</code> and a <code>weight</code> target to
    <code>Data/targets.csv</code>.</p>`;
  const now = log[log.length - 1];
  const phase = livePhase();
  const stale = Math.round((Date.now() - asDate(now.date)) / DAY);
  const age = stale <= 0 ? 'today' : stale === 1 ? 'yesterday' : `${stale} days ago`;

  if (!phase) {
    const gap = now.kg - target;
    return `<div class="box s7"><h3>Weight<em>toward ${target} kg</em></h3>
      <div class="tiles">
        <div class="tile"><b>${now.kg}</b><span>kg now · ${age}</span></div>
        <div class="tile${gap > 0 ? ' warn' : ''}"><b>${Math.abs(gap).toFixed(1)}</b>
          <span>kg ${gap > 0 ? 'to go' : 'below target'}</span></div>
      </div>
      <div class="hint">No phase is running — add a <code>started</code> to a row in
        <code>Data/phases.csv</code> and this reads as a rate instead of a distance.</div>
      ${weightChart(log, target)}</div>`;
  }

  const p = phaseProgress(phase, log);
  const rate = p.moving === null
    ? `<div class="tile"><b>—</b><span>kg/wk · not enough spread to fit</span></div>`
    : `<div class="tile${p.fast ? ' warn' : ''}"><b>${p.moving >= 0 ? '' : '+'}${
        Math.abs(p.moving).toFixed(2)}</b><span>kg/wk ${p.moving < 0
        ? 'the wrong way' : ''} · corridor ${phase.rate_lo}–${phase.rate_hi}</span></div>`;
  const eta = p.weeks
    ? `<div class="tile"><b>${Math.round(p.weeks[0])}–${Math.round(p.weeks[1])}</b>
        <span>weeks to ${phase.to_kg} kg · ${monthDay(addDays(now.date,
          Math.round(p.weeks[0] * 7)))} – ${monthDay(addDays(now.date,
          Math.round(p.weeks[1] * 7)))}</span></div>`
    : '';

  return `<div class="box s7"><h3>Weight<em>${esc(phase.phase)} · ${
      phase.from_kg} → ${phase.to_kg} kg</em></h3>
    <div class="tiles">
      <div class="tile"><b>${now.kg}</b><span>kg now · ${age}</span></div>
      ${rate}${eta}
    </div>
    ${phaseChart(log, phase)}
    <div class="hint">${p.fast
      ? `Faster than the corridor. Losing quicker than ${phase.rate_hi} kg a week is
         the direction that costs tissue, and it is the one a progress bar reads as
         being ahead.`
      : p.slow && p.moving > 0 ? 'Inside the target but slower than planned — the safe side.'
      : p.moving === null ? 'Three weigh-ins spanning two weeks and the rate appears here.'
      : 'Inside the corridor.'}</div>
    ${weightChart(log, target)}
  </div>`;
}

/** The phase, drawn as a corridor: the safe rate as a band running forward from
 *  where the phase started, and the actual weigh-ins over it.
 *
 *  Its own chart rather than an overlay on the history, because the history
 *  spans six years and eight weeks of corridor inside it would be a sliver. The
 *  two charts answer different questions and the axes prove it — this one is in
 *  weeks and holds four kilos, that one is in years and holds twenty.
 */
function phaseChart(log, phase) {
  const start = phase.started, s0 = asDate(start);
  const pts = log.filter(r => asDate(r.date) >= s0);
  const dir = phase.to_kg > phase.from_kg ? 1 : -1;
  const W = 680, H = 230, L = 34, R = 16, T = 14, B = 26;
  const span = Math.abs(phase.to_kg - phase.from_kg);
  // Both bounds start at the same weight and run at different speeds, so the
  // corridor is a triangle: its apex is the day the phase opened and its base
  // is the target line, between the week the fast bound arrives and the week
  // the slow one does. Clamping both to the right-hand edge instead — the first
  // thing this drew — collapses the band to a single line, because both bounds
  // then end at the target at the same x. The gap between the two arrivals *is*
  // the plan's tolerance, and it is the only thing the shape has to say.
  const wkFast = span / phase.rate_hi, wkSlow = span / phase.rate_lo;
  const kgs = pts.map(r => r.kg).concat([phase.from_kg, phase.to_kg]);
  const lo = Math.floor(Math.min(...kgs)) - 1, hi = Math.ceil(Math.max(...kgs)) + 1;
  const wks = Math.ceil(wkSlow);
  const x = wk => L + Math.min(wk, wks) / wks * (W - L - R);
  const xd = d => x((asDate(d) - s0) / DAY / 7);
  const y = kg => T + (hi - kg) / (hi - lo) * (H - T - B);

  const grid = [];
  for (let kg = Math.ceil(lo); kg <= hi; kg++) grid.push(kg);

  return `<svg class="wchart" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="${esc(phase.phase)}: weigh-ins against a corridor of
                  ${phase.rate_lo} to ${phase.rate_hi} kg per week">
    ${grid.map(kg => `<line class="wgrid" x1="${L}" x2="${W - R}"
      y1="${y(kg).toFixed(1)}" y2="${y(kg).toFixed(1)}"/>
      <text class="waxis" x="${L - 7}" y="${(y(kg) + 3).toFixed(1)}"
        text-anchor="end">${kg}</text>`).join('')}
    <polygon class="wband" points="${L},${y(phase.from_kg).toFixed(1)}
      ${x(wkFast).toFixed(1)},${y(phase.to_kg).toFixed(1)}
      ${x(wkSlow).toFixed(1)},${y(phase.to_kg).toFixed(1)}"/>
    <line class="wbound" x1="${L}" y1="${y(phase.from_kg).toFixed(1)}"
      x2="${x(wkFast).toFixed(1)}" y2="${y(phase.to_kg).toFixed(1)}"/>
    <line class="wbound" x1="${L}" y1="${y(phase.from_kg).toFixed(1)}"
      x2="${x(wkSlow).toFixed(1)}" y2="${y(phase.to_kg).toFixed(1)}"/>
    <line class="wtarget" x1="${L}" x2="${W - R}"
      y1="${y(phase.to_kg).toFixed(1)}" y2="${y(phase.to_kg).toFixed(1)}"/>
    <text class="waxis" x="${L + 4}" y="${(y(phase.to_kg) - 6).toFixed(1)}"
      >target ${phase.to_kg} kg</text>
    <text class="waxis" x="${x(wkFast).toFixed(1)}" y="${(y(phase.to_kg) + 13).toFixed(1)}"
      text-anchor="middle">wk ${Math.round(wkFast)} at ${phase.rate_hi}</text>
    <text class="waxis" x="${x(wkSlow).toFixed(1)}" y="${(y(phase.to_kg) + 24).toFixed(1)}"
      text-anchor="end">wk ${Math.round(wkSlow)} at ${phase.rate_lo}</text>
    ${pts.length > 1 ? `<polyline class="wline" points="${
      pts.map(r => `${xd(r.date).toFixed(1)},${y(r.kg).toFixed(1)}`).join(' ')}"/>` : ''}
    ${pts.map(r => `<circle class="wdot" cx="${xd(r.date).toFixed(1)}"
      cy="${y(r.kg).toFixed(1)}" r="2.6"/>
      <circle class="whit" cx="${xd(r.date).toFixed(1)}" cy="${y(r.kg).toFixed(1)}" r="9">
        <title>${esc(r.date)} · ${r.kg} kg</title></circle>`).join('')}
    <text class="waxis" x="${L}" y="${H - 6}">${monthDay(start)}</text>
    <text class="waxis" x="${W - R}" y="${H - 6}" text-anchor="end">week ${wks}</text>
  </svg>
  ${pts.length ? '' : `<div class="hint">No weigh-in since this phase started on
    ${esc(start)} — the corridor is drawn, nothing is in it yet.</div>`}`;
}

/** The corridor as one number, for a page you open daily.
 *
 *  Everything the chart says, without the chart: where this week's pace sits
 *  against the band. The needle scale runs to twice the corridor's upper bound
 *  so that being wildly over still lands on the scale rather than off the end
 *  of it — a needle pinned to the edge would read the same at 0.9 and at 3.
 */
function rateGauge() {
  const phase = livePhase(), log = META.weight || [];
  if (!phase) return `<div class="box s5"><h3>Rate</h3><p class="hint">No phase is
    running. Add a <code>started</code> to a row in <code>Data/phases.csv</code>.</p></div>`;
  const p = phaseProgress(phase, log);
  const W = 460, H = 80, L = 16, R = 16, mid = 46;
  const full = phase.rate_hi * 2;
  const at = v => L + Math.max(0, Math.min(v, full)) / full * (W - L - R);
  const gauge = `<svg class="rgauge" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Rate ${p.moving === null ? 'unknown' : p.moving.toFixed(2)} kg per week
                  against a corridor of ${phase.rate_lo} to ${phase.rate_hi}">
    <line class="rax" x1="${L}" y1="${mid}" x2="${W - R}" y2="${mid}"/>
    <rect class="rband" x="${at(phase.rate_lo).toFixed(1)}" y="${mid - 12}"
      width="${(at(phase.rate_hi) - at(phase.rate_lo)).toFixed(1)}" height="24" rx="4"/>
    <text class="waxis" x="${((at(phase.rate_lo) + at(phase.rate_hi)) / 2).toFixed(1)}"
      y="${mid - 18}" text-anchor="middle">safe ${phase.rate_lo}–${phase.rate_hi}</text>
    <text class="waxis" x="${L}" y="${mid + 26}">0</text>
    <text class="waxis" x="${W - R}" y="${mid + 26}" text-anchor="end">${
      full.toFixed(2)} kg/wk</text>
    ${p.moving === null ? '' : `<line class="rneedle${p.fast ? ' over' : ''}"
      x1="${at(p.moving).toFixed(1)}" y1="${mid - 16}"
      x2="${at(p.moving).toFixed(1)}" y2="${mid + 16}"/>`}
  </svg>`;
  return `<div class="box s5"><h3>Rate<em>trailing 28 days</em></h3>
    ${gauge}
    <div class="hint">${p.moving === null
      ? (p.trend
        ? `${p.trend.n} weigh-ins, but they span only ${Math.round(p.trend.span)} days and a
           slope needs ${MIN_SPAN_DAYS}. These three include a 1 kg overnight swing, which
           fitted across a week reads as 1.5 kg lost — the noise has not had time to cancel.`
        : `Fewer than three weigh-ins in the last four weeks. Two define a line exactly and
           would report a confident slope through noise.`)
      : p.fast ? `Over the corridor. ${Math.abs(p.moving).toFixed(2)} kg a week against a
        ceiling of ${phase.rate_hi}, fitted across ${p.trend.n} weigh-ins since
        ${esc(p.trend.since)}.`
      : `Fitted across ${p.trend.n} weigh-ins since ${esc(p.trend.since)}, rather than
         differenced — this log holds a 1 kg swing inside six days.`}</div>
  </div>`;
}

/** The cycle itself: every phase, in order, with the running one marked.
 *
 *  Reads `phases.csv` rather than restating it in the page, so the plan cannot
 *  drift from the numbers the corridor and the meters are actually using.
 */
function cycleBlock() {
  const phases = META.phases || [];
  if (!phases.length) return `<p class="hint">No <code>Data/phases.csv</code> yet.</p>`;
  const live = livePhase();
  return `<div class="ptable">${phases.map(p => {
    const on = live && p.phase === live.phase;
    const span = Math.abs(p.to_kg - p.from_kg);
    return `<div class="prow${on ? ' on' : ''}">
      <div class="phead"><b>${esc(p.phase)}</b>
        <span class="pkind">${esc(p.kind)}</span>
        ${on ? '<span class="pnow">running</span>'
             : p.ended ? `<span class="when">ended ${esc(p.ended)}</span>`
             : '<span class="when">not started</span>'}</div>
      <div class="pnums">
        <span><b>${p.from_kg} → ${p.to_kg}</b> kg · ${span.toFixed(1)} kg</span>
        <span><b>${p.rate_lo}–${p.rate_hi}</b> kg/wk</span>
        <span>${p.kcal ? `<b>${p.kcal.toLocaleString()}</b> kcal`
                       : '<i class="pblocked">no daily target</i>'}</span>
        <span>${p.rate_hi ? `${Math.ceil(span / p.rate_hi)}–${
          Math.ceil(span / p.rate_lo)} weeks at that rate` : ''}</span>
      </div>
      ${p.blocked ? `<div class="hint pblocked">${esc(p.blocked)}</div>` : ''}
      ${p.note ? `<div class="hint">${esc(p.note)}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}

/** Waist over hip, and the tape readings behind it.
 *
 *  This is the only thing on the Health rail that can see what the cycle is for.
 *  Five kilos that went to the hips and five that went to the waist are the
 *  same line on a weight chart; they are opposite movements here.
 *
 *  Only dates carrying **both** a waist and a hip get a ratio. Carrying the last
 *  known hip forward to pair with a newer waist would manufacture a data point
 *  out of two different months, and the whole value of this card is that the
 *  ratio it draws was measured rather than assembled.
 */
function measurementsBlock() {
  const measured = META.measured || {}, notes = META.measuredNotes || {};
  const dates = Object.keys(measured).sort();
  if (!dates.length) return `<p class="hint">Add rows to
    <code>Data/measurements.csv</code>.</p>`;
  const goal = (META.targets || {}).whr;
  const ratio = dates.filter(d => measured[d].waist && measured[d].hip)
    .map(d => ({date: d, v: measured[d].waist / measured[d].hip}));
  const last = ratio.length ? ratio[ratio.length - 1] : null;
  const best = ratio.reduce((a, b) => !a || b.v < a.v ? b : a, null);

  const W = 680, H = 210, L = 40, R = 40, T = 16, B = 26;
  const t0 = asDate(dates[0]), t1 = asDate(dates[dates.length - 1]);
  const x = d => L + (asDate(d) - t0) / (t1 - t0 || 1) * (W - L - R);
  // A metric measured once is a dot, not a series, and it is not free to draw:
  // the shoulder was read at 45 cm and the thigh at 49, against a waist and hip
  // in the 70s and 90s. Plotted, those two dots own the bottom third of the
  // scale and squash the two lines the card exists to compare into the top of
  // it. They stay in the CSV and are named under the chart instead.
  const drawn = METRICS_ORDER.map(m => ({
    m, pts: dates.filter(d => measured[d][m]).map(d => ({d, v: measured[d][m]}))}));
  const series = drawn.filter(s => s.pts.length > 1);
  const lone = drawn.filter(s => s.pts.length === 1);
  const all = series.flatMap(s => s.pts.map(p => p.v));
  const lo = Math.floor(Math.min(...all) / 5) * 5 - 2;
  const hi = Math.ceil(Math.max(...all) / 5) * 5 + 2;
  const y = cm => T + (hi - cm) / (hi - lo) * (H - T - B);

  const years = [];
  for (let yr = new Date(t0).getFullYear(); yr <= new Date(t1).getFullYear(); yr++) years.push(yr);

  return `<div class="box s9"><h3>Measurements<em>${dates.length} sittings since ${
      dates[0].slice(0, 7)}</em></h3>
    <div class="tiles">
      <div class="tile"><b>${last ? last.v.toFixed(3) : '—'}</b>
        <span>waist ÷ hip · ${last ? esc(last.date) : 'no paired reading'}</span></div>
      ${goal ? `<div class="tile"><b>${goal}</b><span>the goal${last && last.v <= goal
        ? ' · reached' : last ? ` · ${(last.v - goal).toFixed(3)} away` : ''}</span></div>` : ''}
      ${best ? `<div class="tile"><b>${best.v.toFixed(3)}</b>
        <span>best · ${esc(best.date)}</span></div>` : ''}
    </div>
    <svg class="wchart" viewBox="0 0 ${W} ${H}" role="img"
        aria-label="Tape measurements in cm from ${dates[0]} to ${dates[dates.length - 1]}">
      ${[lo, (lo + hi) / 2, hi].map(cm => `<line class="wgrid" x1="${L}" x2="${W - R}"
        y1="${y(cm).toFixed(1)}" y2="${y(cm).toFixed(1)}"/>
        <text class="waxis" x="${L - 7}" y="${(y(cm) + 3).toFixed(1)}"
          text-anchor="end">${cm}</text>`).join('')}
      ${years.map(yr => `<text class="waxis" x="${x(yr + '-01-01').toFixed(1)}"
        y="${H - 6}" text-anchor="middle">${yr}</text>`).join('')}
      ${series.map(s => `<polyline class="mline m-${s.m}" points="${
        s.pts.map(p => `${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}"/>
        ${s.pts.map(p => `<circle class="mdot m-${s.m}" cx="${x(p.d).toFixed(1)}"
          cy="${y(p.v).toFixed(1)}" r="2.4"/>
          <circle class="whit" cx="${x(p.d).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="9">
            <title>${esc(p.d)} · ${s.m} ${p.v} cm${
              notes[`${p.d}/${s.m}`] ? ` · ${esc(notes[`${p.d}/${s.m}`])}` : ''}</title>
          </circle>`).join('')}
        <text class="waxis m-${s.m}" x="${(x(s.pts[s.pts.length - 1].d) + 5).toFixed(1)}"
          y="${(y(s.pts[s.pts.length - 1].v) + 3).toFixed(1)}">${s.m}</text>`).join('')}
    </svg>
    <div class="hint">${whrRead(ratio, goal)}</div>
    ${lone.length ? `<div class="hint">Measured once and not drawn: ${lone.map(s =>
      `${s.m} ${s.pts[0].v} cm (${esc(s.pts[0].d)})`).join(', ')} — one reading is a dot,
      and on this scale it would decide the axis for the lines beside it.</div>` : ''}
  </div>`;
}

// Drawn in this order so the two that make the ratio are read first.
const METRICS_ORDER = ['waist', 'hip', 'bust', 'underbust', 'shoulder', 'thigh'];

/** What the ratio series actually did, in a sentence.
 *
 *  Specifically: whether the last move was toward the goal or away from it, and
 *  if away, that this is the failure the cycle is built to avoid rather than a
 *  bad month. The record already contains one — the waist held and the hip
 *  fell — and a card that draws it without naming it leaves the reader to spot
 *  a crossing between two faint lines.
 */
function whrRead(ratio, goal) {
  if (ratio.length < 2) return `A ratio needs a waist and a hip measured on the same
    day. ${ratio.length ? 'One sitting has both so far.' : 'No sitting has both yet.'}`;
  const last = ratio[ratio.length - 1], prev = ratio[ratio.length - 2];
  const d = last.v - prev.v;
  if (Math.abs(d) < 0.005) return `Held at ${last.v.toFixed(3)} between
    ${esc(prev.date)} and ${esc(last.date)}.`;
  if (d < 0) return `${prev.v.toFixed(3)} → ${last.v.toFixed(3)} between ${esc(prev.date)}
    and ${esc(last.date)}${goal && last.v <= goal ? ', past the goal' : ', toward the goal'}.`;
  return `${prev.v.toFixed(3)} → ${last.v.toFixed(3)} between ${esc(prev.date)} and
    ${esc(last.date)} — away from the goal. This is the movement the cycle exists to
    avoid: the waist can hold while the hip goes, and the weight falls the whole time.`;
}

/** The whole log as a line.
 *
 *  A real time axis, not one column per weigh-in: the three years between the
 *  2020 reading and the next one are part of what the line has to say, and
 *  evenly spacing the points would draw a steady decline that never happened.
 *
 *  One series, so no legend — the card's heading names it. Only the extremes and
 *  the last reading are labelled; every point carries its own tooltip instead,
 *  which is what the oversized invisible circles are for.
 */
function weightChart(log, target) {
  if (log.length < 2) return '';
  const W = 720, H = 200, L = 34, R = 14, T = 14, B = 20;
  const at = d => Date.parse(d + 'T00:00:00');
  const t0 = at(log[0].date), t1 = at(log[log.length - 1].date);
  const kgs = log.map(r => r.kg).concat(target || []);
  const lo = Math.floor(Math.min(...kgs)) - 1, hi = Math.ceil(Math.max(...kgs)) + 1;
  const x = d => L + (at(d) - t0) / (t1 - t0 || 1) * (W - L - R);
  const y = kg => T + (hi - kg) / (hi - lo) * (H - T - B);

  const grid = [];
  for (let kg = Math.ceil(lo / 5) * 5; kg <= hi; kg += 5) grid.push(kg);
  const years = [];
  for (let yr = new Date(t0).getFullYear() + 1; yr <= new Date(t1).getFullYear(); yr++) {
    years.push(yr);
  }
  // A solid line between two readings claims the weight moved that way. Where
  // months went unweighed it did not claim anything, so the line breaks and a
  // faint dash bridges the gap instead — the 2020 reading is three years from
  // its neighbour and a straight run to it would draw a slow gain that never
  // happened.
  // ponytail: one fixed threshold, no per-series tuning. Six months is far past
  // any real weigh-in interval here.
  const GAP = 180 * 864e5;
  const segs = [[log[0]]], bridges = [];
  log.slice(1).forEach((r, i) => {
    const prev = log[i];
    if (at(r.date) - at(prev.date) > GAP) { bridges.push([prev, r]); segs.push([r]); }
    else segs[segs.length - 1].push(r);
  });

  const min = log.reduce((a, b) => b.kg < a.kg ? b : a);
  const max = log.reduce((a, b) => b.kg > a.kg ? b : a);
  const label = (r, dy) => `<text class="wpt" x="${x(r.date).toFixed(1)}"
    y="${(y(r.kg) + dy).toFixed(1)}">${r.kg}</text>`;

  return `<svg class="wchart" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Weight from ${log[0].date} to ${log[log.length - 1].date},
                  ${min.kg} to ${max.kg} kg">
    ${grid.map(kg => `<line class="wgrid" x1="${L}" x2="${W - R}"
      y1="${y(kg).toFixed(1)}" y2="${y(kg).toFixed(1)}"/>
      <text class="waxis" x="${L - 7}" y="${(y(kg) + 3).toFixed(1)}"
        text-anchor="end">${kg}</text>`).join('')}
    ${years.map(yr => `<text class="waxis" x="${x(yr + '-01-01').toFixed(1)}"
      y="${H - 6}" text-anchor="middle">${yr}</text>`).join('')}
    ${target ? `<line class="wtarget" x1="${L}" x2="${W - R}"
      y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}"/>
      <text class="waxis" x="${W - R}" y="${(y(target) - 5).toFixed(1)}"
        text-anchor="end">target ${target} kg</text>` : ''}
    ${bridges.map(([a, b]) => `<line class="wgap" x1="${x(a.date).toFixed(1)}"
      y1="${y(a.kg).toFixed(1)}" x2="${x(b.date).toFixed(1)}"
      y2="${y(b.kg).toFixed(1)}"/>`).join('')}
    ${segs.filter(s => s.length > 1).map(s => `<polyline class="wline" points="${
      s.map(r => `${x(r.date).toFixed(1)},${y(r.kg).toFixed(1)}`).join(' ')}"/>`).join('')}
    ${log.map(r => `<circle class="wdot" cx="${x(r.date).toFixed(1)}"
      cy="${y(r.kg).toFixed(1)}" r="2.6"/>
      <circle class="whit" cx="${x(r.date).toFixed(1)}" cy="${y(r.kg).toFixed(1)}" r="9">
        <title>${esc(r.date)} · ${r.kg} kg</title></circle>`).join('')}
    ${label(max, -9)}${label(min, 15)}
  </svg>
  ${bridges.length ? `<div class="hint">Dashed where months passed between
    weigh-ins — nothing was measured across those stretches.</div>` : ''}`;
}

/** The portion in a dish name — "고구마 100g", "과자 1봉지" — is what keeps the row
 *  honest, and it is not what the dish is called. Stripped for the card title;
 *  the CSV keeps its name and the detail prints it in full. A name that is only
 *  a portion keeps it, since something has to be shown. */
const dishName = s => (s.replace(
  /\s*\(?\d+(?:\.\d+)?\s*(?:kg|mg|ml|g|l|개|봉지|인분|조각|컵|장|스푼|팩|알)\)?/g, ' ')
  .replace(/\s+/g, ' ').trim() || s);

/** When each dish was eaten, oldest first.
 *
 *  The log records ingredients, never dish names — a meal typed in English can
 *  still be 신라면 — so a meal counts as a recipe when it carries every one of
 *  that recipe's ingredients. One meal can be several recipes at once, which is
 *  what a shake of three logged powders actually is.
 */
function recipeLog() {
  const meals = META.intake || [];
  const out = {};
  (META.recipes || []).forEach(d => {
    const need = d.items.map(i => i.ingredient);
    out[d.dish] = !need.length ? [] : meals.filter(m => {
      const have = new Set(m.items.map(i => i.ingredient));
      return need.every(n => have.has(n));
    }).map(m => (m.when || '').slice(0, 10));
  });
  return out;
}

/** What the Diet section knows that no page's text does: the dishes and the log.
 *
 *  Both are matched on their ingredients as well as their names, because that is
 *  how the vault actually stores a meal — searching 라면 should find the night it
 *  was eaten even though the meal was typed in English.
 */
function dietSearch(q) {
  const hit = s => String(s).toLowerCase().includes(q);
  const named = items => items.some(i => hit(i.ingredient));
  const out = (META.recipes || []).filter(d => hit(d.dish) || named(d.items))
    .map(d => ({title: dishName(d.dish), href: '#/n/diet%2Frecipes',
                sub: `recipe · ${d.kcal} kcal · ${d.items.map(i => i.ingredient).join(', ')}`}));
  // Newest meals first, and capped — the log grows without limit and the panel
  // is a place to start from, not a report.
  (META.intake || []).filter(m => hit(m.meal) || named(m.items)).reverse().slice(0, 12)
    .forEach(m => out.push({title: m.meal, day: (m.when || '').slice(0, 10),
      href: DIET_HOME, sub: `${(m.when || '').slice(0, 16)} · ${m.kcal} kcal · ${
        m.items.map(i => `${i.ingredient} ${i.grams} g`).join(', ')}`}));
  return out;
}

// One window for the page, not one per card: the question is "how often lately",
// and it is only answerable if every card answers it over the same stretch.
const RECIPE_WINDOWS = [[1, 'Today'], [7, '7 days'], [30, '30 days'], [0, 'All time']];
let recipeWin = 30;
let recipeSort = {k: 'logged', desc: true};

function recipesBlock() {
  const dishes = META.recipes || [];
  if (!dishes.length) return '<p class="hint">No dishes in <code>Data/recipes.csv</code>.</p>';
  const NUTRIENTS = META.nutrients || [];
  const macros = MACROS.filter(n => NUTRIENTS.includes(n));
  const log = recipeLog();
  const cut = recipeWin ? today(new Date(Date.now() - (recipeWin - 1) * 864e5)) : '';
  const seen = d => log[d.dish] || [];
  const count = d => seen(d).filter(x => x >= cut).length;
  const last = d => seen(d).slice(-1)[0] || '';

  const SORTS = [['logged', 'Logged'], ['name', 'Name'], ['kcal', 'Calories'],
                 ...macros.map(n => [n, nice(n)])];
  const key = d => recipeSort.k === 'logged' ? count(d)
    : recipeSort.k === 'name' ? dishName(d.dish) : d[recipeSort.k] || 0;
  const sorted = [...dishes].sort((a, b) => {
    const x = key(a), y = key(b);
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return recipeSort.desc ? -c : c;
  });

  const chips = (items, active, attr) => items.map(([v, label]) =>
    `<button class="pill${v === active ? ' val' : ''}" data-${attr}="${v}">${
      esc(label)}</button>`).join('');

  const card = (d, mvp) => {
    const n = count(d), l = last(d);
    return `<div class="card rcard${mvp ? ' mvp' : ''}">
      <h3>${esc(dishName(d.dish))}</h3>
      <div class="rnum"><b>${d.kcal}</b><span>kcal</span>
        <span class="rlog${n ? ' on' : ''}">${n ? `${n}×` : '—'}</span></div>
      <div class="rmac">${macros.map(m =>
        `<span><b>${d[m]}</b>${nice(m).toLowerCase()}</span>`).join('')}</div>
      <div class="hint">${l ? `last eaten ${l}` : 'never logged'}</div>
      <details><summary class="hint">${d.items.length} ingredient${
          d.items.length === 1 ? '' : 's'}</summary>
        ${dishName(d.dish) === d.dish ? '' : `<div class="hint">${esc(d.dish)}</div>`}
        <div class="hint">${d.items.map(i =>
          `${esc(i.ingredient)} ${i.grams} g`).join(' · ')}</div>
        ${d.unknown.length ? `<div class="hint">Not in the reference, scored zero:
          ${d.unknown.map(esc).join(', ')}</div>` : ''}
      </details></div>`;
  };

  // The few dishes actually in rotation, before the full list — what you ate
  // last week is a better starting point than whatever sorts first.
  // Last eaten first, and a tie goes to the one eaten more often — a day's worth
  // of supplements would otherwise crowd out the meal you actually cooked.
  const recent = dishes.filter(d => last(d))
    .sort((a, b) => last(b).localeCompare(last(a)) || seen(b).length - seen(a).length)
    .slice(0, 4);
  const win = (RECIPE_WINDOWS.find(w => w[0] === recipeWin) || [])[1].toLowerCase();

  return `<div class="stats">${dishes.length} dishes, scored off the same per-100 g
      reference as the log — a recipe and a meal made of it cannot disagree. Counted as
      eaten when a logged meal carries every ingredient of the dish.</div>
    ${recent.length ? `<div class="foot" style="margin-top:0"><h2>In rotation</h2>
      <div class="cards">${recent.map(d => card(d, true)).join('')}</div></div>` : ''}
    <div class="foot"><h2>Every dish</h2>
      <div class="row" style="margin:0 0 12px">
        <span class="hint">Counting</span>${chips(RECIPE_WINDOWS, recipeWin, 'rwin')}
        <span class="hint" style="margin-left:8px">Sorted by</span>${
          chips(SORTS, recipeSort.k, 'rsort')}
      </div>
      <div class="cards">${sorted.map(d => card(d)).join('')}</div>
      <div class="hint" style="margin-top:12px">Counts are over ${win}${
        recipeSort.desc ? '' : ' · ascending'}.</div>
    </div>`;
}

// Same trick as the calendar: the page around this block does not know it exists,
// so the controls are delegated and redraw only the block.
document.addEventListener('click', e => {
  const b = e.target.closest('[data-rwin],[data-rsort]');
  if (!b) return;
  if (b.dataset.rwin) recipeWin = +b.dataset.rwin;
  // Clicking the sort you are already on flips it; a new one starts sensibly —
  // biggest first for a number, A→Z for a name.
  else if (b.dataset.rsort === recipeSort.k) recipeSort.desc = !recipeSort.desc;
  else recipeSort = {k: b.dataset.rsort, desc: b.dataset.rsort !== 'name'};
  const host = document.querySelector('[data-slice="recipes"]');
  if (host) host.innerHTML = recipesBlock();
});

let calMonth = null;    // 'YYYY-MM' on show; null means this month

/** What else happened on a day, keyed by date: commits across every linked
 *  repository, milestones, weigh-ins. All of it is already in META for the
 *  project pages and the weight card — this only re-indexes it by day, so a
 *  calendar cell can say what the eating sat next to. */
function dayMarks() {
  const commits = {}, milestones = {}, weighed = {};
  Object.values(META.projects || {}).forEach(a => {
    const start = Date.parse(a.start + 'T00:00:00Z');
    a.counts.forEach((n, i) => {
      if (!n) return;
      const d = new Date(start + i * 864e5).toISOString().slice(0, 10);
      commits[d] = (commits[d] || 0) + n;
    });
  });
  Object.values(META.milestones || {}).forEach(rows =>
    rows.forEach(m => (milestones[m.date] || (milestones[m.date] = [])).push(m.title)));
  (META.weight || []).forEach(w => weighed[w.date] = w.kg);
  return {commits, milestones, weighed};
}

/** A month you can read: every day carries what was eaten, how far it landed
 *  from the target, and what else you did that day — and each row ends with its
 *  week, because 1900 kcal means one thing in a week averaging 1300 and another
 *  in a week averaging 2000. */
function intakeCalendar() {
  const rows = META.intake || [];
  if (!rows.length) return '<p class="hint">Nothing logged yet.</p>';
  const t = (META.targets || {}).kcal || 0;
  const byDay = {};
  rows.forEach(e => {
    const d = (e.when || '').slice(0, 10);
    if (!d) return;
    (byDay[d] || (byDay[d] = {kcal: 0, meals: []})).meals.push(e);
    byDay[d].kcal += e.kcal || 0;
  });
  const {commits, milestones, weighed} = dayMarks();

  const now = today().slice(0, 7);
  const month = calMonth || now;
  const first = new Date(month + '-01T00:00:00');
  const len = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  // Start at the Sunday on or before the 1st, then run whole weeks past the end.
  const weeks = Math.ceil((first.getDay() + len) / 7);
  const at = i => today(new Date(first.getFullYear(), first.getMonth(),
                                 1 - first.getDay() + i));

  // Green under the target, crimson over it, and the number is the size of the
  // miss — no reading two figures and subtracting them in your head.
  const vs = v => !t ? '' : `<span class="d ${v > t ? 'over' : 'under'}">${
    v > t ? '+' : '−'}${Math.abs(Math.round(v - t))}</span>`;

  const bar = v => distBar(v, t);

  // What else the day held. Diet is not lived in isolation — a heavy day next
  // to a milestone reads differently from a heavy day next to nothing.
  const marks = d => {
    const m = [];
    if (commits[d]) m.push(`<span title="${commits[d]} commit${
      commits[d] === 1 ? '' : 's'}">◆ ${commits[d]}</span>`);
    // One star however many landed that day; five in a row was a decoration.
    const ms = milestones[d] || [];
    if (ms.length) m.push(`<span class="ms" title="${esc(ms.join(' · '))}">★${
      ms.length > 1 ? ' ' + ms.length : ''}</span>`);
    if (weighed[d]) m.push(`<span title="weighed in">${weighed[d]} kg</span>`);
    return m.length ? `<div class="cmarks">${m.join('')}</div>` : '';
  };

  const cell = d => {
    const day = byDay[d], k = day ? Math.round(day.kcal) : 0;
    const out = d.slice(0, 7) !== month;
    return `<div class="cday${out ? ' out' : ''}${d === today() ? ' now' : ''}${
        t && k > t ? ' over' : ''}"${out ? '' : ` data-day="${d}"`}>
      <div class="cdate">${+d.slice(8)}</div>
      ${k ? `<div class="ckcal">${k}<i>kcal</i>${vs(k)}</div>
        ${bar(k)}
        <ul class="cmeals">${day.meals.map(m =>
          `<li title="${esc(m.meal)} — ${m.kcal} kcal · ${esc(m.items.map(i =>
            `${i.ingredient} ${i.grams} g`).join(', '))}">${esc(m.meal)}</li>`).join('')}</ul>`
        : ''}
      ${out ? '' : marks(d)}
    </div>`;
  };

  // The week a day sits in is what makes its number mean anything, so every row
  // ends with its own average rather than leaving you to add seven cells up.
  const week = i => {
    const days = [...Array(7)].map((_, j) => byDay[at(i * 7 + j)]).filter(Boolean);
    const built = [...Array(7)].reduce((s, _, j) => s + (commits[at(i * 7 + j)] || 0), 0);
    if (!days.length) return `<div class="cweek">${built
      ? `<span class="cmarks">◆ ${built}</span>` : ''}</div>`;
    const sum = days.reduce((s, x) => s + x.kcal, 0), avg = sum / days.length;
    return `<div class="cweek"><b>${Math.round(avg)}</b>${vs(avg)}
      ${bar(avg)}
      <span>kcal a day · ${days.length} logged</span>
      <span>${Math.round(sum)} in all${built ? ` · ◆ ${built}` : ''}</span></div>`;
  };

  const mine = Object.entries(byDay).filter(([d]) => d.startsWith(month));
  const mAvg = mine.reduce((s, [, x]) => s + x.kcal, 0) / (mine.length || 1);

  return `<div class="calbar">
      <button class="btn" data-cal="-1" title="Previous month">‹</button>
      <b>${first.toLocaleDateString('en-US', {month: 'long', year: 'numeric'})}</b>
      <button class="btn" data-cal="1" title="Next month"${
        month < now ? '' : ' disabled'}>›</button>
      <span class="hint">${mine.length
        ? `${mine.length} day${mine.length === 1 ? '' : 's'} logged · ${Math.round(mAvg)} kcal
           a day${t ? ` ${vs(mAvg)} against ${t}` : ''}`
        : 'nothing logged this month'}</span>
    </div>
    <div class="calwrap"><div class="calmonth">
      ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Week']
        .map(h => `<div class="chead">${h}</div>`).join('')}
      ${[...Array(weeks)].map((_, i) =>
        [...Array(7)].map((_, j) => cell(at(i * 7 + j))).join('') + week(i)).join('')}
    </div></div>
    <div class="hint">Bars run from the notch: short of it is under ${t || 'target'} kcal,
      past it is over. ◆ commits · ★ milestone · kg weigh-in · click a day to open it
      in the record.</div>`;
}

const DIET_HOME = '#/n/diet%2Findex';

// The calendar sits on a page rendered by show(), which knows nothing about
// intake, so this is delegated at the document rather than wired per render.
// Setting a hash that is already current fires no hashchange, hence the branch.
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-cal]');
  if (nav) {
    const d = new Date((calMonth || today().slice(0, 7)) + '-01T00:00:00');
    d.setMonth(d.getMonth() + +nav.dataset.cal);
    calMonth = today(d).slice(0, 7);
    // Redrawn in place: route() would rebuild and re-scroll the whole page for a
    // change nothing outside this block cares about.
    const host = document.querySelector('[data-slice="dietcal"]');
    if (host) host.innerHTML = intakeCalendar();
    return;
  }
  // A calendar cell, or a search hit that found the meal — both mean "show me
  // that day".
  const sq = e.target.closest('.calmonth [data-day], .results [data-day]');
  if (!sq) return;
  intakeDay = sq.dataset.day;
  if (location.hash === DIET_HOME) route(); else location.hash = DIET_HOME;
});
