/** The work log: what is unanswered, what is next, what threads are running, and
 *  then the days themselves.
 *
 *  The boards come first on purpose. A chronological log answers "what did I do
 *  on Tuesday", which is the question you ask twice a year; the questions you
 *  have not answered and the things you said you would do next are the ones you
 *  ask every morning, and they are what a log usually buries.
 */
const WORK_KIND = {did: 'did', learned: 'learned', open: 'open', next: 'next',
                   dated: 'dated', milestone: 'milestone'};

// A bullet, as it reads inside a day.
const workBullet = e => `<div class="wk k-${esc(e.kind)}${e.closed ? ' done' : ''}">
  <i>${esc(WORK_KIND[e.kind] || e.kind)}</i>
  <b>${esc(e.text)}</b>
  <span>${e.topic ? `#${esc(e.topic)}` : ''}${
    e.people.length ? ' @' + e.people.map(esc).join(' @') : ''}${
    e.due ? ' · ' + esc(e.due) : ''}${e.closed ? ' · closed ' + esc(e.closed) : ''}</span>
</div>`;

// "in 13 days", "tomorrow", "3 days ago" — a date is only useful once you know
// how far away it is.
function whenAway(date) {
  const d = Math.round((Date.parse(date + 'T00:00:00')
                        - Date.parse(today() + 'T00:00:00')) / 864e5);
  return d === 0 ? 'today' : d === 1 ? 'tomorrow' : d === -1 ? 'yesterday'
    : d > 0 ? `in ${d} days` : `${-d} days ago`;
}

/** Topics that have a page of their own, as {topic: the page}.
 *
 *  Read out of the pages themselves rather than kept in a list here. A page
 *  hosting `<div data-slice="workthread" data-topics="rag;mcp">` is claiming
 *  those threads, and Work Home stops drawing them in the same move — so a
 *  third project page is one HTML file and no edit to this one. A table in JS
 *  would have had to be kept in step with the pages by hand, and the failure
 *  when it drifted would be a thread shown twice or shown nowhere.
 */
function claimedTopics() {
  const out = {};
  (NOTES || []).forEach(n => {
    const m = /data-slice="workthread"[^>]*data-topics="([^"]*)"/.exec(n.html || '');
    if (!m) return;
    m[1].split(';').map(t => t.trim().toLowerCase()).filter(Boolean)
      .forEach(t => (out[t] = n));
  });
  return out;
}

const pageLink = n => `<a href="#/n/${encodeURIComponent(n.slug)}">${esc(n.title)}</a>`;

/** One project's threads: the same bullets Work Home draws, narrowed to the
 *  topics the page asked for. The boards come first here for the same reason
 *  they do there — what is unanswered outranks what happened on Tuesday. */
function workThread(n, el) {
  const want = new Set((el && el.dataset.topics || '').split(';')
    .map(t => t.trim().toLowerCase()).filter(Boolean));
  const rows = (META.work || []).filter(e => want.has(e.topic));
  const open = rows.filter(e => e.kind === 'open' && !e.closed).reverse();
  const next = rows.filter(e => e.kind === 'next' && !e.closed)
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const coming = rows.filter(e => e.kind === 'dated' && !e.closed && e.due >= today())
    .sort((a, b) => a.due.localeCompare(b.due));
  const done = rows.filter(e => (e.kind === 'open' || e.kind === 'next') && e.closed);

  const days = {};
  rows.forEach(e => (days[e.date] || (days[e.date] = [])).push(e));
  const byDay = Object.entries(days).sort((a, b) => b[0].localeCompare(a[0]));

  const board = (title, items, empty) => `<h3>${title}<em>${items.length || ''}</em></h3>
    ${items.length ? items.map(workBullet).join('') : `<div class="hint">${empty}</div>`}`;

  if (!want.size) {
    return `<div class="hint">This block needs the threads it is about:
      <code>&lt;div data-slice="workthread" data-topics="rag;mcp"&gt;</code>, the
      slugs written in <code>work-log.csv</code>'s <code>topic</code> column.</div>`;
  }

  return `<div class="bento">
    <div class="box s4">
      <h3>Threads<em>on this page</em></h3>
      ${[...want].map(t => {
        const n = rows.filter(e => e.topic === t).length;
        return `<div class="rest"><b>#${esc(t)}</b>
          <span>${n} ${n === 1 ? 'entry' : 'entries'}</span></div>`;
      }).join('')}
    </div>
    <div class="box s8">
      ${board('Open questions', open, 'Nothing unanswered on these threads.')}
      <div style="margin-top:16px">${board('Next up', next, 'Nothing queued.')}</div>
      ${coming.length ? `<div style="margin-top:16px"><h3>Coming up</h3>
        ${coming.map(e => `<div class="wk k-dated"><i>${esc(whenAway(e.due))}</i>
          <b>${esc(e.text)}</b><span>${esc(e.due)}</span></div>`).join('')}</div>` : ''}
      ${done.length ? `<div style="margin-top:16px">${
        board('Settled', done, '')}</div>` : ''}
    </div>
  </div>
  <div class="bento"><div class="box">
    <h3>The log<em>newest first</em></h3>
    ${byDay.length ? byDay.map(([date, items]) => `<div class="act">
      <div class="act-h"><b>${esc(date)}</b><span class="when">${whenAway(date)}</span></div>
      ${items.map(workBullet).join('')}
    </div>`).join('')
    : `<div class="hint">Nothing logged against ${[...want].map(t =>
        '#' + esc(t)).join(', ')} yet. Write the day on
        <a href="#/n/work%2Findex">Work</a> and run <code>/vault-work</code>.</div>`}
  </div></div>`;
}

function workBlock() {
  // The job, and nothing else. `work-log.csv` is written by two skills and only
  // one of them is about the job — /vault-log files a coding session into the
  // same columns, and a run of engine-project rows under a heading that says
  // Work is a page that answers the wrong question every time it is opened.
  // The rows are not lost: `rail` says where each one actually belongs and the
  // to-do list reads it, so an engine-project question still stands, under
  // Personal Projects.
  // ...and nothing a project page has already claimed. A thread with a page of
  // its own is followed there, and repeating it here would make the boards a
  // superset that is never the thing you actually open them for.
  const claimed = claimedTopics();
  const rows = (META.work || []).filter(e => e.rail === 'Work' && !claimed[e.topic]);
  const elsewhere = (META.work || []).filter(e => e.rail !== 'Work').length;
  const onPages = (META.work || []).filter(e => e.rail === 'Work' && claimed[e.topic]).length;
  const pages = [...new Set(Object.values(claimed))];
  const unknown = META.workUnknown || [];
  const open = rows.filter(e => e.kind === 'open' && !e.closed).reverse();
  const next = rows.filter(e => e.kind === 'next' && !e.closed)
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  // Dated facts only. A `next` with a due date is already standing in Next up,
  // and listing it twice makes the board look busier than the week is.
  const coming = rows.filter(e => e.kind === 'dated' && !e.closed && e.due >= today())
    .sort((a, b) => a.due.localeCompare(b.due));

  // A thread is a topic across every day it appears in — the whole point of
  // tagging a bullet rather than filing it under a date and losing it.
  const threads = {};
  rows.forEach(e => {
    if (!e.topic) return;
    const t = threads[e.topic] || (threads[e.topic] = {n: 0, last: '', open: 0});
    t.n++;
    if (e.date > t.last) t.last = e.date;
    if (e.kind === 'open' && !e.closed) t.open++;
  });
  const byTopic = Object.entries(threads).sort((a, b) => b[1].last.localeCompare(a[1].last));

  // Milestones are the CV-shaped ones, and they get the spine of their own —
  // a career reads as a line, not as a board of things still outstanding.
  const marks = rows.filter(e => e.kind === 'milestone');

  const days = {};
  rows.forEach(e => (days[e.date] || (days[e.date] = [])).push(e));
  const recent = Object.entries(days).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);

  const board = (title, items, empty) => `<h3>${title}<em>${items.length || ''}</em></h3>
    ${items.length ? items.map(workBullet).join('') : `<div class="hint">${empty}</div>`}`;

  return `<div class="bento">
    ${captureBox({folder: 'Work', title: 'Work log', cls: 'box s5',
      blurb: `Write the day as it comes out — what you did, what you learned, what you
        are unsure of, what is next. Saved to <code>Inbox/Work/</code>; run
        <code>/vault-work</code> in a Claude session to turn it into the bullets below.`,
      placeholder: 'Researched X. Not sure whether we should Y — 田中さん said no but I '
        + 'forget why. Tomorrow: Z.\n\n⌘⏎ to save.'})}
    <div class="box s7">
      ${board('Open questions', open, 'Nothing unanswered.')}
      <div style="margin-top:16px">${board('Next up', next, 'Nothing queued.')}</div>
      ${coming.length ? `<div style="margin-top:16px"><h3>Coming up</h3>
        ${coming.map(e => `<div class="wk k-dated"><i>${esc(whenAway(e.due))}</i>
          <b>${esc(e.text)}</b><span>${esc(e.due)}</span></div>`).join('')}</div>` : ''}
      ${unknown.length ? `<div class="log">Rows with a kind the page cannot draw:
        ${unknown.map(esc).join(', ')}</div>` : ''}
      ${onPages ? `<div class="log">${onPages} more bullets are the job but have a
        page of their own: ${pages.map(pageLink).join(', ')}. Their open questions
        and their next steps are followed there.</div>` : ''}
      ${elsewhere ? `<div class="log">${elsewhere} more bullets in
        <code>work-log.csv</code> belong to another rail and are not the job.
        They are on the to-do list under the rail they came from.</div>` : ''}
    </div>
  </div>
  ${marks.length ? `<div class="bento"><div class="box">
    <h3>Milestones<em>the line so far</em></h3>
    ${timeline(marks.map((m, i) => {
      const since = i ? apartDays(marks[i - 1].date, m.date) : 0;
      return {when: m.date, title: m.text, note: m.topic ? '#' + m.topic : '',
              now: i === marks.length - 1,
              gap: since ? gapLabel(since) : '',
              gapTitle: since ? `${since} days after the one before` : ''};
    }))}
  </div></div>` : ''}
  <div class="bento">
    <div class="box s4"><h3>Threads<em>by last touched</em></h3>
      ${byTopic.length ? byTopic.map(([t, s]) => `<div class="rest">
        <b>#${esc(t)}</b>
        <span>${s.n} ${s.n === 1 ? 'entry' : 'entries'} · ${whenAway(s.last)}${
          s.open ? ` · ${s.open} open` : ''}</span></div>`).join('')
        : '<div class="hint">No topics yet.</div>'}
    </div>
    <div class="box s8"><h3>The log<em>newest first</em></h3>
      ${recent.length ? recent.map(([date, items]) => `<div class="act">
        <div class="act-h"><b>${esc(date)}</b>
          <span class="when">${whenAway(date)}</span></div>
        ${items.map(workBullet).join('')}
      </div>`).join('')
      : `<div class="stats" style="margin:0">Nothing logged yet. Write a day above, then
         run <code>/vault-work</code> to file it.</div>`}
    </div>
  </div>`;
}
