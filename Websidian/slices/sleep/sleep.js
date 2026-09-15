/** The night, drawn on a clock rather than as a length.
 *
 *  A bar chart of hours slept would say last night was 7.8 and stop there — but
 *  7.8 hours in one piece and 7.8 hours cut into three are not the same night,
 *  and the second is the one worth noticing. So the axis is the clock, each
 *  night is the arc between lights-out and getting up, and every time you
 *  surfaced is a gap cut out of it. Sleeping the same total in fewer pieces
 *  shows up as the bars getting solid, which nothing about a total can show.
 */
const SLEEP_AXIS_FROM = 20 * 60;      // 20:00 — the earliest bedtime the chart draws
const SLEEP_AXIS_SPAN = 16 * 60;      // through to 12:00 the next day

/** Minutes past midnight as a position on that axis, 0..1. Anything outside the
 *  window clamps to its end rather than drawing off the chart. */
const sleepPos = m => Math.max(0, Math.min(1, ((m - SLEEP_AXIS_FROM + 1440) % 1440)
                                              / SLEEP_AXIS_SPAN));
const clock = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${
  String(m % 60).padStart(2, '0')}`;
const hoursText = h => `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`;

/** Mean of a numeric list, or null when there is nothing to average. Kept
 *  separate so every tile below reports "—" for an empty window instead of the
 *  NaN a bare divide would put on the page. */
const sleepMean = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;

function sleepChart(rows) {
  const W = 680, H = 30 + rows.length * 22, L = 62, R = 16, T = 22, B = 20;
  const x = m => L + sleepPos(m) * (W - L - R);
  const bandH = Math.min(14, (H - T - B) / Math.max(rows.length, 1) - 4);
  const y = i => T + i * ((H - T - B) / Math.max(rows.length, 1));

  // One tick every two hours across the window, so the reader can find 03:00
  // without counting.
  const ticks = [];
  for (let m = SLEEP_AXIS_FROM; m <= SLEEP_AXIS_FROM + SLEEP_AXIS_SPAN; m += 120) {
    ticks.push(m % 1440);
  }

  return `<svg class="slchart" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Each night as the arc between going to bed and getting up,
                  with the times you woke cut out of it">
    ${ticks.map(m => `<line class="slgrid" x1="${x(m).toFixed(1)}" x2="${x(m).toFixed(1)}"
      y1="${T - 6}" y2="${H - B}"/>
      <text class="slaxis" x="${x(m).toFixed(1)}" y="${T - 10}"
        text-anchor="middle">${clock(m)}</text>`).join('')}
    ${rows.map((r, i) => {
      const x0 = x(r.bed), x1 = x(r.up);
      // Each interruption is a notch in the bar. Drawn as a cut rather than a
      // mark on top because that is what it is — the sleep stopped there.
      const cuts = r.wokeAt.map(m => `<rect class="slcut" x="${(x(m) - 2).toFixed(1)}"
        y="${y(i).toFixed(1)}" width="4" height="${bandH.toFixed(1)}"/>`).join('');
      return `<text class="slaxis sldate" x="${L - 8}" y="${(y(i) + bandH - 3).toFixed(1)}"
          text-anchor="end">${monthDay(r.date)}</text>
        <rect class="slbar" x="${x0.toFixed(1)}" y="${y(i).toFixed(1)}"
          width="${Math.max(x1 - x0, 1).toFixed(1)}" height="${bandH.toFixed(1)}"
          rx="2"><title>${esc(r.date)} — ${clock(r.bed)} to ${clock(r.up)}, ${
            hoursText(r.hours)}${r.wokeAt.length
              ? `, woke at ${r.wokeAt.map(clock).join(' and ')}` : ' unbroken'}${
            r.note ? ` · ${esc(r.note)}` : ''}</title></rect>
        ${cuts}`;
    }).join('')}
  </svg>`;
}

function sleepBlock() {
  const all = META.sleep || [];
  const bad = META.sleepUnknown || [];
  const rows = all.slice(-21);
  const last = rows[rows.length - 1];
  const week = rows.slice(-7);
  const meanH = sleepMean(week.map(r => r.hours));
  const meanW = sleepMean(week.map(r => r.wokeAt.length));
  const unbroken = week.filter(r => !r.wokeAt.length).length;

  return `<div class="bento">
    <div class="box s4"><h3>Last seven nights</h3>
      <div class="tiles">
        <div class="tile"><b>${meanH == null ? '—' : hoursText(meanH)}</b>
          <span>slept, mean</span></div>
        <div class="tile ${meanW > 0.5 ? 'warn' : ''}"><b>${
          meanW == null ? '—' : meanW.toFixed(1)}</b><span>wake-ups a night</span></div>
        <div class="tile"><b>${week.length ? unbroken : '—'}</b>
          <span>of ${week.length || 7} unbroken</span></div>
      </div>
      ${last ? `<div class="hint">Last night: ${clock(last.bed)} to ${clock(last.up)},
        ${hoursText(last.hours)}${last.wokeAt.length
          ? ` — up at ${last.wokeAt.map(clock).join(' and ')}` : ' straight through'}.</div>` : ''}
    </div>
    <div class="box s8"><h3>Nights<em>bed to up, on the clock</em></h3>
      ${rows.length ? sleepChart(rows) : ''}
      ${rows.length ? '' : `<div class="hint">Nothing logged yet — add rows to
        <code>Data/sleep.csv</code>: <code>date,to_bed,woke,woke_at,note</code>,
        dated by the morning you got up, wake-up times separated by <code>;</code>.</div>`}
      ${rows.length && rows.length < 3 ? `<div class="hint">${rows.length} night${
        rows.length === 1 ? '' : 's'} on record. The tiles will mean something at
        about a week.</div>` : ''}
      ${bad.length ? `<div class="log">These rows have a time this page could not
        read, so they are not drawn: ${bad.map(esc).join(', ')}</div>` : ''}
    </div>
  </div>`;
}
