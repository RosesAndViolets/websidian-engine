/** Everything outstanding, from every rail, in one list.
 *
 *  **Ordered by when, not by where.** Grouping under rail headings was the
 *  obvious first shape and it is the wrong one: a list read in the morning is
 *  being asked "what is late", and rail grouping answers "what is filed under
 *  Work" — which buries a three-days-overdue thing under a heading you have
 *  already scrolled past. So urgency is the spine and the rail is a chip on
 *  every row, with per-rail counts in the header. Flipping it is swapping which
 *  key `todoGroups()` sorts on.
 *
 *  Two kinds of row arrive here and they are not the same fact:
 *
 *    written   a row somebody typed — a work-log `open` or `next`, a project
 *              with a due date. It exists whether or not it is late
 *    cadence   an absence, computed. Nothing anywhere says "no intake logged
 *              today"; it is true because `intake.csv` has no row for today and
 *              `cadence.csv` says there should be one every day
 *
 *  The second kind cannot be ticked off, only satisfied by the record changing,
 *  which is deliberate: a checkbox would let the list disagree with the data,
 *  and every number on this site is derived rather than stored for that reason.
 */
/* Both of these anchor to UTC — the `Z` is the whole point, not decoration.
   Parsed as local time, `addDays` then reads the result back with
   `toISOString()`, which converts to UTC and in JST lands nine hours earlier:
   one day added to 2026-08-08 came back as 2026-08-08, and every cadence sat
   permanently one day overdue. Parse and format in the same zone and the offset
   cancels wherever the machine happens to be. */
const daysBetween = (a, b) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5)
  .toISOString().slice(0, 10);

/** The last date each cadence record was added to, off META that is already here.
 *
 *  Dates only — `intake.csv` and `workout.csv` carry a time too, and comparing
 *  "2026-08-09 07:30" against a day boundary would make a breakfast logged this
 *  morning read as yesterday's.
 */
function todoLastSeen(what) {
  const last = rows => rows && rows.length
    ? rows[rows.length - 1].slice(0, 10) : null;
  if (what === 'intake') return last((META.intake || []).map(r => r.when));
  if (what === 'weight') return last((META.weight || []).map(r => r.date));
  // The job's own rail only. A Websidian session lands in the same file, and
  // counting it would say the work log was written on a day it was not.
  if (what === 'work') {
    return last((META.work || []).filter(r => r.rail === 'Work').map(r => r.date));
  }
  if (what === 'finance') return (META.finance || {}).last || null;
  // The reviews are newest first and named by their date, so the newest one's
  // filename is the last time this was done — there is nothing else to read.
  if (what === 'finance-review') {
    return (((META.finance || {}).reviews || [])[0] || {}).date || null;
  }
  if (what.startsWith('muscle:')) {
    const m = what.slice(7);
    const hit = (META.workout || []).filter(r => (r.muscles || []).includes(m));
    return last(hit.map(r => r.when));
  }
  return null;
}

/** Every outstanding thing, as one flat list of comparable rows. */
function todoItems() {
  const now = today();
  const out = [];

  // --- written: the work log's own boards -------------------------------
  // One file, several rails. The log's own reader decides which — a question
  // left open on the vault is not a work question and filing it as one is what
  // made the Work rail look busier than the job ever was.
  (META.work || []).forEach(e => {
    if (e.closed) return;
    if (e.kind === 'open') {
      out.push({rail: e.rail, text: e.text, due: '', kind: 'question',
                tag: e.topic, date: e.date});
    } else if (e.kind === 'next') {
      out.push({rail: e.rail, text: e.text, due: e.due, kind: 'next',
                tag: e.topic, date: e.date});
    } else if (e.kind === 'dated' && e.due && e.due >= now) {
      out.push({rail: e.rail, text: e.text, due: e.due, kind: 'dated',
                tag: e.topic});
    }
  });

  // The session log's own loose ends. It left work-log.csv for its own file, and
  // an open question about a project is still something outstanding — it just
  // belongs to the project rather than to the job.
  Object.entries(META.projectlog || {}).forEach(([slug, days]) => {
    const tag = slug.split('/').pop();
    Object.entries(days).forEach(([date, bullets]) => bullets.forEach(b => {
      if (b.closed) return;
      if (b.kind === 'open') {
        out.push({rail: 'Personal Projects', text: b.text, due: '',
                  kind: 'question', tag, date});
      } else if (b.kind === 'next') {
        out.push({rail: 'Personal Projects', text: b.text, due: b.due,
                  kind: 'next', tag, date});
      }
    }));
  });

  // --- written: a project that named a date ------------------------------
  Object.entries(META.projectmeta || {}).forEach(([slug, meta]) => {
    if (!meta.due) return;
    const name = slug.split('/').pop().replace(/-/g, ' ');
    out.push({rail: 'Personal Projects', text: `${name} — ${meta.status || 'due'}`,
              due: meta.due, kind: 'next', tag: meta.urgency,
              href: `#/n/${encodeURIComponent(slug)}`});
  });

  // --- cadence: true because of a date that did not happen ---------------
  (META.cadence || []).forEach(c => {
    const seen = todoLastSeen(c.what);
    // Never recorded at all is due now rather than never — a cadence pointing
    // at an empty log is exactly the case it was written for.
    const since = seen == null ? c.every : daysBetween(seen, now);
    if (since < c.every) return;
    out.push({rail: c.rail, text: c.label, kind: 'cadence', what: c.what,
              due: seen == null ? now : addDays(seen, c.every),
              tag: seen == null ? 'never logged'
                : since === 0 ? 'due today' : `${since}d since last`});
  });

  // One index across every group, not per group — it is what ties a row's
  // button to its item, and a per-group counter would collide between them.
  out.forEach((it, i) => (it.i = i));
  return out;
}

/** The two groups that are not about urgency, because their rows are not about
 *  doing anything on a date.
 *
 *  **FYI is `kind=dated`, and that kind already meant this.** `work/data.py`
 *  defines `dated` as "a fact with a date attached: hardware arriving, a
 *  release, a review" — a thing that will happen *to* you, not a thing you owe
 *  anyone. Ranking those by urgency was the mistake: a release on Monday that
 *  needs nothing from you outranked a question three days late, because the
 *  only thing being compared was the date. So no new column in the CSV and no
 *  new word for the capture skill to learn — the distinction was already
 *  written down, this list just was not reading it.
 *
 *  **Workout is a rail, because workout cadences are satisfied in a batch.**
 *  You do not train glutes on Tuesday because a list said Tuesday; you train
 *  them when you next train, alongside everything else. Two days over is the
 *  normal resting state of that row rather than a failure, so it does not
 *  belong in Overdue crying wolf beside a real one. The lateness is not lost —
 *  each row still carries its own "4d since last".
 */
const TODO_ASIDE = {Workout: it => it.rail === 'Workout',
                    FYI: it => it.kind === 'dated'};

/** Seven buckets, in the order they make a claim on you. */
function todoGroups(items) {
  const now = today();
  const groups = {Overdue: [], Today: [], 'This week': [], Later: [],
                  Workout: [], Open: [], FYI: []};
  items.forEach(it => {
    const aside = Object.keys(TODO_ASIDE).find(k => TODO_ASIDE[k](it));
    if (aside) return void groups[aside].push(it);
    // Undated and dated-but-distant are different things. A question with no
    // date belongs in Open forever; a laptop arriving in ten days is simply not
    // this week's problem, and filing it under Open buries a real date.
    if (!it.due) groups.Open.push(it);
    else if (it.due < now) groups.Overdue.push(it);
    else if (it.due === now) groups.Today.push(it);
    else if (daysBetween(now, it.due) <= 7) groups['This week'].push(it);
    else groups.Later.push(it);
  });
  ['Overdue', 'This week', 'Later', 'Workout', 'FYI'].forEach(k =>
    groups[k].sort((a, b) => (a.due || '').localeCompare(b.due || '')));
  // Questions last inside Open: a `next` is a thing to do, a question is a
  // thing to find out, and the first is what an open-ended list is scanned for.
  groups.Open.sort((a, b) => (a.kind === 'question') - (b.kind === 'question'));
  return groups;
}

/** Where a note answering this todo has to land, or null if nowhere yet.
 *
 *  A folder is only offered when something on the other end can read what is
 *  written into it — `Inbox/Work/` has `/vault-work`, `Inbox/Intake/` has
 *  `/vault-intake`. A workout todo shows on the list and deliberately carries
 *  no button: filing text nothing can turn into a `workout.csv` row would be a
 *  control that looks like it closes the loop and does not.
 */
function todoFolder(it) {
  // Rail as well as kind: a project with a due date is also `next`, and it has
  // no ingestion path at all — routing it to Inbox/Work/ would file a personal
  // project's note where a work session will read it as the job.
  if (it.rail === 'Work' && (it.kind === 'question' || it.kind === 'next')) {
    return 'Work';
  }
  if (it.kind === 'cadence' && it.what === 'intake') return 'Intake';
  return null;
}

/** The first line of the capture: what this note is answering.
 *
 *  One line, no frontmatter, no parser — the same call the pages make. It
 *  identifies a work-log row by the fields that actually name it rather than by
 *  a row number, because the file is re-sorted on read and an index would go
 *  stale the moment anything was inserted above it.
 */
const todoMarker = it => ['TODO', it.rail || '—',
  it.kind === 'cadence' ? it.what
    : `work-log ${it.date || ''} ${it.kind === 'question' ? 'open' : 'next'}`
      + (it.tag ? ' ' + it.tag : ''),
  it.text].join(' · ');

// Tolerates a missing rail: `cadence.csv` may leave the column blank, and a
// chip that threw would take the whole card with it.
const todoSlug = s => (s || 'unfiled').toLowerCase().replace(/[^a-z0-9]+/g, '-');

const todoRow = it => {
  const i = it.i;
  const folder = online ? todoFolder(it) : null;
  // Rail, timing and tag on one quiet run after the sentence. Three separate
  // cells was what made a row two lines tall, and the row is now the unit the
  // card's height is fourteen of.
  const meta = [it.rail, it.due && it.kind !== 'cadence' ? whenAway(it.due) : '', it.tag]
    .filter(Boolean).join(' · ');
  return `<div class="td-item s-${todoSlug(it.status || 'open')}">
    <div class="td k-${esc(it.kind)}">
      <b title="${esc(it.text)}">${esc(it.text)}</b>
      <span>${esc(meta)}</span>
      ${folder ? `<button class="td-update" data-todo="${i}"
        >${it.kind === 'cadence' ? 'Log it' : 'Update'}</button>` : ''}
    </div>
    ${folder ? `<div class="td-reply" data-reply="${i}" hidden>
      <textarea class="compose" placeholder="${esc(it.kind === 'question'
        ? 'What the answer turned out to be.'
        : it.kind === 'cadence' ? 'What you ate.'
        : 'Where this stands now — finished, moved, or still going.')}\n\n⌘⏎ to save."></textarea>
      <div class="row"><button class="btn" data-send="${i}">Save to Inbox</button>
        <span class="hint" data-msg="${i}"></span></div>
    </div>` : ''}
  </div>`;
};

/** Reveal, then post. Bound per item rather than per folder, because several
 *  Work todos share one folder and `bindCaptures()` keys on the folder alone. */
function bindTodoUpdate(items) {
  main.querySelectorAll('[data-todo]').forEach(b => {
    const reply = main.querySelector(`[data-reply="${b.dataset.todo}"]`);
    b.onclick = () => {
      reply.hidden = !reply.hidden;
      if (!reply.hidden) reply.querySelector('textarea').focus();
    };
  });
  main.querySelectorAll('[data-send]').forEach(b => {
    const i = b.dataset.send, it = items[i];
    const box = main.querySelector(`[data-reply="${i}"] textarea`);
    const msg = main.querySelector(`[data-msg="${i}"]`);
    const send = async () => {
      if (!box.value.trim()) {
        return void (msg.textContent = 'Write something first.');
      }
      msg.textContent = 'Saving…';
      const r = await api('/api/note', {method: 'POST', body: JSON.stringify({
        text: todoMarker(it) + '\n\n' + box.value.trim(),
        folder: todoFolder(it), name: 'TODO ' + it.text, ext: 'md'})})
        .catch(e => ({error: String(e)}));
      if (r.error) return void (msg.textContent = 'Could not save — ' + r.error);
      // It stays on the list until the record itself changes, which is the same
      // rule as everywhere else here: the page draws the data, never a flag set
      // beside it. Saying so beats looking broken.
      msg.textContent = 'Saved — stays here until the next ingestion.';
      box.disabled = b.disabled = true;
      pollInbox();
    };
    box.onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); };
    b.onclick = send;
  });
}

// What the card last drew. The bindings run after `main.innerHTML` is set, by
// which time the items are gone unless something kept them. Always the whole
// list, never the filtered one — `it.i` indexes into it, and a filtered array
// would point every Update button at the wrong row.
let todoShown = [];

const bindTodo = () => bindTodoUpdate(todoShown);

/** Which chip is pressed, per dimension. Null is "everything".
 *
 *  Two dimensions rather than one list of chips, because they answer different
 *  questions and are worth crossing: "what is late" and "what is Work" narrow
 *  to "what Work is late" when both are pressed.
 */
let todoFilter = {status: null, rail: null};

/** The card.
 *
 *  **One list, not one column per bucket.** The columns were the right shape
 *  for a card read at a glance and the wrong one for the card actually here:
 *  eleven of sixteen rows are Open, so six near-empty columns sat beside one
 *  long one and the card ran 1379px — most of a screen, on the page every
 *  other thing is below. Flat, the ordering the buckets encoded survives in
 *  the row order, the bucket survives as the colour of a row's left edge, and
 *  the card is a third as tall.
 *
 *  **The buckets became filters rather than disappearing.** A column heading
 *  was already the only way to ask "just the overdue ones" — clicking it now
 *  does what looking at it used to.
 */
function todoCard() {
  const items = todoShown = todoItems();
  const groups = todoGroups(items);
  const unknown = META.cadenceUnknown || [];

  if (!items.length) {
    return `<div class="box"><h3>To do<em>nothing outstanding</em></h3>
      <div class="hint">No open questions, nothing queued, and every cadence in
      <code>Data/cadence.csv</code> is up to date.</div></div>`;
  }

  // Flattened in bucket order, each row keeping the bucket it landed in. The
  // sort that made the columns readable is the sort that makes the list one.
  const all = [];
  Object.entries(groups).forEach(([status, rows]) =>
    rows.forEach(it => all.push({...it, status})));

  const keep = it => (!todoFilter.status || it.status === todoFilter.status)
    && (!todoFilter.rail || it.rail === todoFilter.rail);
  const shown = all.filter(keep);

  // Counts stay off the unfiltered list: a chip that reported zero the moment
  // you pressed its neighbour could not be used to get back.
  const byRail = {};
  all.forEach(it => (byRail[it.rail] = (byRail[it.rail] || 0) + 1));
  const late = groups.Overdue.length;
  // FYI rows are not outstanding — nothing is owed on them — so counting them
  // in the total would inflate the one number the header exists to give.
  const fyi = groups.FYI.length;

  const chip = (dim, val, n) => `<button class="pill td-chip s-${todoSlug(val)}${
    todoFilter[dim] === val ? ' val' : ''}" data-tdf="${esc(dim)}|${esc(val)}"
    aria-pressed="${todoFilter[dim] === val}">${esc(val || 'unfiled')} <b>${n}</b></button>`;

  const filtered = todoFilter.status || todoFilter.rail;

  return `<div class="box"><h3>To do<em>${items.length - fyi} outstanding${
      late ? `, ${late} late` : ''}${fyi ? ` · ${fyi} to know` : ''}</em></h3>
    <div class="td-filters">
      <div class="row td-chips"><span class="hint">Status</span>${
        Object.entries(groups).filter(([, v]) => v.length)
          .map(([name, v]) => chip('status', name, v.length)).join('')}</div>
      <div class="row td-chips td-typechips"><span class="hint">Type</span>${
        Object.entries(byRail).sort((a, b) => b[1] - a[1])
          .map(([r, n]) => chip('rail', r, n)).join('')}</div>
      ${filtered ? `<button class="td-clear" data-tdf="clear|">Clear${
        shown.length !== all.length ? ` · showing ${shown.length} of ${all.length}` : ''
      }</button>` : ''}
    </div>
    <div class="td-list">${shown.length ? shown.map(todoRow).join('')
      : '<div class="hint">Nothing matches both of those.</div>'}</div>
    ${unknown.length ? `<div class="hint" style="margin-top:10px">
      Cadence rows nothing can date, so they will never come due:
      ${unknown.map(esc).join(', ')}</div>` : ''}
  </div>`;
}

/** Delegated, and it redraws only the card — the Global Home is rebuilt by
 *  home(), which would reset the page's scroll to press a chip halfway down it. */
document.addEventListener('click', e => {
  const chip = e.target.closest('[data-tdf]');
  if (!chip) return;
  const [dim, val] = chip.dataset.tdf.split('|');
  if (dim === 'clear') todoFilter = {status: null, rail: null};
  else todoFilter[dim] = todoFilter[dim] === val ? null : val;
  const host = document.querySelector('[data-todo-host]');
  if (!host) return;
  host.innerHTML = todoCard();
  bindTodo();
});
