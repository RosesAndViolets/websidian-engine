/** The events, newest first, on the same timeline the project milestones use —
 *  a dated thing with a note under it is the same shape whether it is a release
 *  or a company trip.
 *
 *  Anything still ahead is marked rather than sorted into its own section: two
 *  events a year make a "coming up" heading that is empty eleven months of the
 *  twelve, and the top of a newest-first list is where the future already sits.
 */
/** How far back the page is looking, in days, and blank for all of it. Lives
 *  out here because changing it redraws the whole block — map, list and count
 *  together, so the pins and the entries under them can never disagree about
 *  which events exist. Nothing in the future is ever hidden: a window is a
 *  floor, not a range, and an event still to come is not old. */
const EV_SPANS = [['', 'All time'], ['0', 'Today'], ['7', 'Past week'],
                  ['30', 'Past month'], ['90', 'Past 3 months'],
                  ['365', 'Past year']];

/** The window is a setting, not a view state, so it outlives the page.
 *
 *  It decides what the map opens on as well as what the list holds — set it to
 *  a week and the map frames wherever that week was — and a default that resets
 *  to All time on every reload is one you have to set again before the page can
 *  answer the question you keep asking it. `index.html` is rewritten on every
 *  build, so this has to live somewhere the build cannot reach: localStorage,
 *  the same place the Global Home keeps its board.
 *
 *  Validated on the way in, because localStorage outlives the code that wrote
 *  it — a span dropped from EV_SPANS would otherwise leave the select with
 *  nothing selected and the list filtered by a number nothing offers.
 */
let evDays = (() => {
  try {
    const saved = localStorage.getItem('evDays');
    return EV_SPANS.some(([v]) => v === saved) ? saved : '';
  } catch { return ''; }
})();

/** The date an event has to reach to be inside a window of `days`, and the
 *  empty string for all of it — which every date is already >=, so the filter
 *  needs no branch of its own.
 *
 *  Parsed as UTC and printed back as UTC, because toISOString is UTC either
 *  way: reading the day in JST and writing it in UTC lands nine hours earlier,
 *  which is the previous date, and every window came out a day too wide.
 */
const evCut = (now, days) => days === '' ? ''
  : new Date(Date.parse(now + 'T00:00:00Z') - +days * 864e5).toISOString().slice(0, 10);

document.addEventListener('change', e => {
  const s = e.target.closest('[data-ev-days]');
  if (!s) return;
  evDays = s.value;
  try { localStorage.setItem('evDays', evDays); } catch { /* private mode */ }
  const host = s.closest('[data-slice="events"]');
  if (host) host.innerHTML = eventsBlock();
});

function eventsBlock() {
  const all = META.events || [];
  if (!all.length) return `<p class="hint">Nothing in <code>Data/events.csv</code> yet —
    the columns are <code>start,end,title,place,people,note</code>, <code>end</code> blank
    for a single day and people separated by <code>;</code>.</p>`;
  const now = today();

  // A trip is judged by the day it ended, so a week away does not fall out of
  // "past week" on the day it started.
  const span = `<label class="ev-span">Showing <select data-ev-days>${
    EV_SPANS.map(([v, l]) => `<option value="${v}"${
      v === evDays ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
  const cut = evCut(now, evDays);
  const rows = all.filter(e => (e.end || e.start) >= cut);
  if (!rows.length) return span + `<p class="hint">Nothing that recent. ${all.length}
    event${all.length === 1 ? '' : 's'} in all — widen the window above.</p>`;

  // "16–18 June 2026", and one date when there is only one. The month and year
  // are printed once for a range that stays inside them.
  const day = d => new Date(d + 'T00:00:00');
  const fmt = (d, opts) => day(d).toLocaleDateString('en-GB', opts);
  const when = e => {
    if (!e.end || e.end === e.start) return fmt(e.start, {day: 'numeric', month: 'long',
                                                          year: 'numeric'});
    const sameMonth = e.start.slice(0, 7) === e.end.slice(0, 7);
    return (sameMonth ? fmt(e.start, {day: 'numeric'})
                      : fmt(e.start, {day: 'numeric', month: 'long'}))
      + '–' + fmt(e.end, {day: 'numeric', month: 'long', year: 'numeric'});
  };

  // An event is pickable only when it is on the map, and `pick` is the index of
  // its *pin* — which is a place, so two events at one address point at the
  // same one. Grouped by the map's own function rather than counted here, or
  // the two would drift apart the first time either changed.
  const placed = new Map();
  evGroup(rows).forEach((g, i) => g.forEach(e => placed.set(e.row, i)));
  const mapped = placed.size;

  return span + eventsMap(rows.map(e => ({...e, when: when(e)})))
    + timeline(rows.map((e, i) => ({
      when: when(e) + (e.place ? ' · ' + e.place : ''),
      title: e.title, note: e.note, tags: e.people, pick: placed.get(i),
      now: e.start > now, gap: e.start > now ? 'upcoming' : ''})))
    + `    <div class="hint">${rows.length} event${rows.length === 1 ? '' : 's'} ·
      ${mapped} on the map · newest first${evOpened.events && evOpened.events < evOpened.of
        ? ` · opened on the ${evOpened.events} of them${
            evOpened.place ? ' around ' + esc(evOpened.place) : ' in one place'},
          which is where most of this window happened — <b>Show all</b> for the rest`
        : ''} · the window above is remembered · add rows to
      <code>Data/events.csv</code></div>`;
}
