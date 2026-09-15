// A page is static HTML, but some of what belongs on one is generated — the
// workout history is read from a CSV at build time. Drop
// `<div data-slice="workout">` into any page and the block lands there. Add a
// slice by adding a line here.
//
// Each is handed the page record it landed on, so a slice can be about *this*
// page — the project cards read their row by the page's own slug.
const SLICES = {projects: () => projectsBlock(),
                weight: () => weightBlock(), people: () => peopleBlock(),
                events: () => eventsBlock(),
                workout: () => workoutBlock(), worklog: () => workBlock(),
                workthread: (n, el) => workThread(n, el),
                related: n => relatedBlock(n),
                record: () => onRecord(), intakebox: () => intakeComposer(),
                quicklog: () => quickLogBlock(),
                recipes: () => recipesBlock(),
                rate: () => rateGauge(), cycle: () => cycleBlock(),
                measurements: () => measurementsBlock(),
                dietcal: () => intakeCalendar(), projectmeta: n => projectMeta(n),
                milestones: n => milestonesBlock(n),
                challenges: n => challengesBlock(n),
                todocal: () => todoCalendar(),
                supplements: () => supplementsBlock(),
                sleep: () => sleepBlock(),
                finance: () => financeBlock(),
                necessity: () => financeNecessity(),
                luxury: () => financeLuxury(),
                goals: () => financeGoals(),
                finreview: () => financeReview()};

/** Everything a page actually shows, for search to read.
 *
 *  `n.text` is only the HTML you wrote. A page that hosts a slice shows a great
 *  deal more — the blood markers, the noticed changes, the recipes — and none of
 *  that exists until a browser renders it, which is why searching for ALT or for
 *  a bruise used to come back empty. So the slices are rendered here too, once
 *  each, and their words folded in.
 *
 *  Rendered through a detached element rather than a tag-stripping regular
 *  expression: the browser's parser is already correct, and `.hint` and `.stats`
 *  can then be dropped by class. Those two are where the site explains itself —
 *  "add rows to Data/…", "click a day to open it" — and a search of your own
 *  vault should not turn up a page because of a sentence the site wrote.
 */
const shownText = {};
function pageText(n) {
  if (n.slug in shownText) return shownText[n.slug];
  const box = document.createElement('div');
  let out = n.text;
  (n.html.match(/data-slice="[^"]+"/g) || []).forEach(tag => {
    const make = SLICES[tag.slice(12, -1)];
    if (!make) return;
    // A slice that throws costs its own words, never the whole search.
    try { box.innerHTML = make(n); } catch { return; }
    box.querySelectorAll('.hint,.stats').forEach(el => el.remove());
    out += ' ' + box.textContent;
  });
  return shownText[n.slug] = out.replace(/\s+/g, ' ').toLowerCase();
}

let shownSlug = null;   // what main is currently displaying

function show(slug) {
  const n = BY[slug];
  if (!n) return home();
  // No sibling list: the panel beside this page already shows every page in
  // the section, so printing them again was the same set twice. Sub-pages do
  // get cards — they are folded away in the panel until asked for.
  const kids = NOTES.filter(o => o.parent === slug);
  const card = o => `<a class="card" href="#/n/${encodeURIComponent(o.slug)}">
    <h3>${esc(o.title)}</h3><p>${esc(o.summary)}</p>
    <span class="hint">Edited ${esc(ageOf(o.edited))}</span></a>`;
  const hosts = /data-slice="/.test(n.html);
  main.innerHTML = `<div class="wrap${hosts ? ' wide' : ''}">
    <h1>${esc(n.title)}</h1>
    <div class="meta">${n.category ? `<span class="badge">${esc(n.category)}</span>` : ''}
      <span class="hint" style="margin:0">Edited ${esc(ageOf(n.edited))}</span></div>
    <article>${n.html}</article>
    <div class="row" style="margin-top:34px">
      ${online ? `<a class="btn" href="#/edit/${encodeURIComponent(n.slug)}">✎ Edit this page</a>
        <button class="btn" data-new>+ ${n.home ? 'New page here' : 'New sub-page'}</button>` : ''}
      <span class="hint" style="margin:0">${esc(n.path)}</span></div>
    ${kids.length ? `<div class="foot"><h2>Inside this page</h2>
      <div class="cards">${kids.map(card).join('')}</div></div>` : ''}
  </div>`;
  // The host element goes in too, so a slice can be configured by the page that
  // placed it rather than by a table in JS — `data-topics` on a work thread is
  // the whole reason a second thread page needs no code.
  main.querySelectorAll('[data-slice]').forEach(el => {
    const make = SLICES[el.dataset.slice];
    el.innerHTML = make ? make(n, el) : `<p class="hint">No slice called
      <code>${esc(el.dataset.slice)}</code>.</p>`;
  });
  const nb = main.querySelector('[data-new]');
  if (nb) nb.onclick = () => newPage(slug);
  bindCaptures();        // no-op unless a slice put a capture box on this page
  bindIntake();          // ...and the same for the record's own controls
  bindFinance();         // ...and the month a spending column was clicked
  // Only a real navigation scrolls to the top. Picking a day in On record
  // re-renders this same page, and resetting the scroll there threw you back up
  // to the heading every time you clicked a bar.
  if (slug !== shownSlug) main.scrollTop = 0;
  shownSlug = slug;
}
