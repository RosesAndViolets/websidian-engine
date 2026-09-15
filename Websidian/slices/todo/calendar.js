/** The to-do list as a month, Monday first.
 *
 *  The list answers "what is late"; this answers "what is that week going to
 *  look like", which is the question you cannot get from a column of cards
 *  ordered by urgency — two things landing on the same Thursday only read as a
 *  collision once they are drawn on the same Thursday.
 *
 *  **Cells carry the sentence, not a dot.** A dot means "open the day to find
 *  out", and a calendar you have to click through one day at a time is slower
 *  than the list it is meant to complement. Rows are truncated by CSS and carry
 *  the whole text as a `title`, so nothing is hidden, only folded.
 *
 *  **Nothing on the to-do list is invisible here.** Two of the seven groups have
 *  no place on a grid — `Open` has no date at all, and anything overdue sits on
 *  a day you have already navigated past — so both are drawn beneath the month
 *  as their own strips. A calendar that quietly dropped eight of twelve items
 *  would be the exact class of fault this vault refuses everywhere else: wrong,
 *  and looking entirely ordinary.
 */
let todoCalMonth = null;

/** Monday-first offset for a JS day index. `getDay()` is Sunday-based, and the
 *  week here starts on Monday, so Sunday has to become 6 rather than 0. */
const mondayIndex = d => (d.getDay() + 6) % 7;

/** One item as a row inside a day cell. */
function todoCalRow(it) {
  const cls = it.kind === 'dated' ? 'fyi' : it.rail === 'Workout' ? 'aside'
    : it.due < today() ? 'late' : '';
  return `<li class="tdc-row${cls ? ' tdc-' + cls : ''}"
    title="${esc(it.rail || '—')} · ${esc(it.text)}${
      it.tag ? ' · ' + esc(it.tag) : ''}">${esc(it.text)}</li>`;
}

/** A strip of items that the grid cannot place, or would place out of view.
 *
 *  `late` is a class rather than a position, for the same reason `td-late` is in
 *  the list: with nothing overdue the Late strip is not drawn at all, and a rule
 *  keyed on being first would then paint Undated crimson.
 */
const todoCalStrip = (name, note, items, late) => !items.length ? '' :
  `<div class="tdc-strip${late ? ' tdc-striplate' : ''}"
    ><h4>${name}<em>${items.length}</em></h4>
    <div class="tdc-stripitems">${items.map(it =>
      `<span class="tdc-chip" title="${esc(it.text)}"><i>${esc(it.rail || '—')}</i>
        ${esc(it.text)}${it.due ? ` <b>${esc(whenAway(it.due))}</b>` : ''}</span>`).join('')}
    </div><div class="hint">${note}</div></div>`;

function todoCalendar() {
  const items = todoItems();
  if (!items.length) {
    return `<p class="hint">Nothing outstanding — no open questions, nothing
      queued, and every cadence in <code>Data/cadence.csv</code> is up to date.</p>`;
  }
  const groups = todoGroups(items);
  const now = today();
  const month = todoCalMonth || now.slice(0, 7);

  const byDay = {};
  items.forEach(it => it.due && (byDay[it.due] || (byDay[it.due] = [])).push(it));

  const first = new Date(month + '-01T00:00:00');
  const len = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = mondayIndex(first);
  const weeks = Math.ceil((lead + len) / 7);
  const at = i => today(new Date(first.getFullYear(), first.getMonth(), 1 - lead + i));

  const cell = d => {
    const on = byDay[d] || [];
    const out = d.slice(0, 7) !== month;
    return `<div class="tdc-day${out ? ' out' : ''}${d === now ? ' now' : ''}">
      <div class="tdc-date">${+d.slice(8)}</div>
      ${on.length ? `<ul class="tdc-rows">${on.map(todoCalRow).join('')}</ul>` : ''}
    </div>`;
  };

  // Only what this month actually holds — a count of the whole list would say
  // the same number on every month and answer nothing about the one on screen.
  const mine = items.filter(it => (it.due || '').startsWith(month));

  return `<div class="calbar">
      <button class="btn" data-tdcal="-1" title="Previous month">‹</button>
      <b>${first.toLocaleDateString('en-US', {month: 'long', year: 'numeric'})}</b>
      <button class="btn" data-tdcal="1" title="Next month">›</button>
      ${month === now.slice(0, 7) ? ''
        : '<button class="btn" data-tdcal="0">This month</button>'}
      <span class="hint">${mine.length
        ? `${mine.length} dated thing${mine.length === 1 ? '' : 's'} this month`
        : 'nothing dated this month'}</span>
    </div>
    <div class="tdc-month">
      ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        .map(h => `<div class="tdc-head">${h}</div>`).join('')}
      ${[...Array(weeks)].map((_, i) =>
        [...Array(7)].map((_, j) => cell(at(i * 7 + j))).join('')).join('')}
    </div>
    ${todoCalStrip('Late', 'Sitting on a day already gone, so the grid above '
      + 'would only show them if you navigated back to the month they were due.',
      groups.Overdue, true)}
    ${todoCalStrip('Undated', 'Open questions and anything queued with no day '
      + 'named. Nothing to place them on until a date exists.', groups.Open)}
    <div class="hint">Crimson is late · dashed is FYI, a fact with a date rather
      than a thing you owe · hover a row for its rail and topic. The week starts
      on Monday.</div>`;
}

// Delegated at the document, like every other block the router redraws. The
// attribute is `data-tdcal` and not `data-cal` on purpose: the diet calendar
// already owns `data-cal` document-wide, and sharing it would make each
// calendar's arrows step the other one's month.
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-tdcal]');
  if (!nav) return;
  const step = +nav.dataset.tdcal;
  if (step) {
    const d = new Date((todoCalMonth || today().slice(0, 7)) + '-01T00:00:00');
    d.setMonth(d.getMonth() + step);
    todoCalMonth = today(d).slice(0, 7);
  } else {
    todoCalMonth = null;
  }
  // Redrawn in place: route() would rebuild and re-scroll the whole page for a
  // change nothing outside this block cares about.
  const host = document.querySelector('[data-slice="todocal"]');
  if (host) host.innerHTML = todoCalendar();
});
