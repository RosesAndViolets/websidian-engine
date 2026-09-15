const NOTES = __DATA__;
const META = __META__;
const BY = Object.fromEntries(NOTES.map(n => [n.slug, n]));
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// Every page row carries its age, so a section's panel is also the answer to
// "what in here has gone stale" — the list you already browse, not a second
// view of the same pages sorted by date.
const link = (n, marker) => `<a href="#/n/${encodeURIComponent(n.slug)}" data-s="${n.slug}">
  ${marker || '<i>·</i>'}<span>${esc(n.title)}</span>
  <em class="age">${esc(ageOf(n.edited))}</em></a>`;

// A page that owns sub-pages carries them beneath it, indented by the same
// `.tree` rule the sections use — one nesting mechanism, however deep it goes.
// They stay folded until asked for, and which parents are open is remembered:
// the panel is redrawn on every inbox poll, and a fold that forgot itself would
// spring shut while you were reading.
const childrenOf = slug => NOTES.filter(n => n.parent === slug);
let expanded = new Set();
try { expanded = new Set(JSON.parse(localStorage.getItem('expanded') || '[]')); } catch {}

const currentSlug = () => {
  // Slugs contain a slash and are percent-encoded in every href, so the hash
  // reads `personal-projects%2Fdebatenode` while data-s holds the raw slug.
  // Comparing them undecoded silently never matched.
  const raw = (location.hash.match(/^#\/(?:n|staged)\/(.+)$/) || [])[1];
  return raw ? decodeURIComponent(raw) : null;
};

// The page you are on is always reachable: its ancestors open whether or not
// you opened them, otherwise a deep link would land you on a page the panel
// refuses to show.
const openFolds = () => {
  const open = new Set(expanded);
  for (let n = BY[currentSlug()]; n && n.parent; n = BY[n.parent]) open.add(n.parent);
  return open;
};

const linkTree = (n, open) => {
  const kids = childrenOf(n.slug);
  if (!kids.length) return link(n);
  const on = open.has(n.slug);
  return link(n, `<i class="tw${on ? ' on' : ''}" data-toggle="${esc(n.slug)}"
      title="${on ? 'Collapse' : 'Expand'} ${kids.length} sub-page${
        kids.length === 1 ? '' : 's'}">▸</i>`)
    + (on ? `<div class="tree">${kids.map(k => linkTree(k, open)).join('')}</div>` : '');
};

// nav's innerHTML is replaced on every render, but nav itself is not, so one
// delegated listener outlives them all.
nav.addEventListener('click', e => {
  const t = e.target.closest('[data-toggle]');
  if (!t) return;
  e.preventDefault();     // the caret sits inside the link; do not navigate
  e.stopPropagation();
  const slug = t.dataset.toggle;
  expanded.delete(slug) || expanded.add(slug);
  localStorage.setItem('expanded', JSON.stringify([...expanded]));
  sidebar(q.value);
});

// The rail is core/pages.py's SECTIONS list, in that order. A section is either
// a folder under pages/ — whose index.html is its home page — or a route the
// site renders itself, like the dashboard and the diet log.
const SECTIONS = META.sections;
const under = c => NOTES.filter(n => n.category === c);
// `|| ''` is what makes the Global Home a section like the rest: it is the one
// entry with no `folder`, and matching on the raw key left `secOf('')` undefined
// so every branch keyed on it needed a special case.
const secOf = c => SECTIONS.find(s => (s.folder || '') === c);
const homeOf = c => NOTES.find(n => n.category === c && n.home);
// Categories are folders, so they come and go as you reorganise. A remembered
// one that no longer exists would leave the panel showing an empty folder with
// no way back, so fall through to "everything".
let cat = localStorage.getItem('cat') || '';
if (cat && !secOf(cat)) { cat = ''; localStorage.removeItem('cat'); }

const initials = t => t.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/)
  .filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase().slice(0, 2);

// Rail glyphs, keyed by folder — '' is the Global Home. Stroked paths on a
// 24-grid, drawn with currentColor so the lit button inverts for free. A
// section with no icon here falls back to its initials rather than a blank
// button, which is what makes adding a folder to SECTIONS still a one-liner.
const ICONS = {
  '': '<path d="M3 9.6 12 3l9 6.6"/><path d="M5.2 10.4V20a1 1 0 0 0 1 1h11.6a1 1 0 0 0 1-1v-9.6"/>'
      + '<path d="M9.8 21v-5.4h4.4V21"/>',
  'personal-projects':
      '<path d="M4 19.2V4.6A2.6 2.6 0 0 1 6.6 2H19a1 1 0 0 1 1 1v14.4"/>'
      + '<path d="M6.6 17.4H20v3.6H6.6a2.6 2.6 0 0 1 0-3.6"/><path d="M8.4 6.6h7.4"/>',
  knowledge:
      '<path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>'
      + '<path d="M9.6 19.2h4.8"/><path d="M10.6 21.6h2.8"/>',
  transition:
      '<path d="m16.6 2.4 3.6 3.6-3.6 3.6"/><path d="M3.8 11.4v-1.2a4 4 0 0 1 4-4h12.4"/>'
      + '<path d="m7.4 21.6-3.6-3.6 3.6-3.6"/><path d="M20.2 12.6v1.2a4 4 0 0 1-4 4H3.8"/>',
  work: '<rect x="2.6" y="6.6" width="18.8" height="14" rx="2.4"/>'
      + '<path d="M8.4 6.6V4.8A2.2 2.2 0 0 1 10.6 2.6h2.8a2.2 2.2 0 0 1 2.2 2.2v1.8"/>'
      + '<path d="M2.6 12.4h18.8"/>',
  diet: '<path d="M4 2.4v6.4a2.4 2.4 0 0 0 4.8 0V2.4"/><path d="M6.4 11.2v10.4"/>'
      + '<path d="M18.4 21.6V2.8c-1.9 1-3 3.4-3 6.2 0 2.4.9 3.8 3 4.2"/>',
  workout: '<path d="M6.6 8.4v7.2"/><path d="M3.4 10v4"/><path d="M17.4 8.4v7.2"/>'
      + '<path d="M20.6 10v4"/><path d="M6.6 12h10.8"/>',
  'social-life':
      '<path d="M15.4 20.6v-1.8a3.8 3.8 0 0 0-3.8-3.8H6.2a3.8 3.8 0 0 0-3.8 3.8v1.8"/>'
      + '<circle cx="8.9" cy="7.4" r="3.8"/>'
      + '<path d="M21.6 20.6v-1.8a3.8 3.8 0 0 0-2.9-3.7"/>'
      + '<path d="M15.4 3.8a3.8 3.8 0 0 1 0 7.4"/>',
  finance:
      '<path d="M18.6 7.4V4.6a1 1 0 0 0-1-1H5.4a2 2 0 0 0 0 4h14.2a1 1 0 0 1 1 1v3.4h-2.8'
      + 'a2 2 0 0 0 0 4h2.8a1 1 0 0 0 1-1"/>'
      + '<path d="M3.4 5.6v13a2 2 0 0 0 2 2h14.2a1 1 0 0 0 1-1v-3.4"/>',
};
const glyph = key => ICONS[key]
  ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
       stroke-linecap="round" stroke-linejoin="round">${ICONS[key]}</svg>`
  : null;

function drawRail() {
  rail.innerHTML = SECTIONS.map(s => {
    const key = s.folder || '';
    return `<button data-cat="${esc(key)}" class="${key === cat ? 'on' : ''}">
      ${glyph(key) || esc(initials(s.label))}
      <span class="tip">${esc(s.label)}${s.count ? ' · ' + s.count : ''}</span></button>`;
  }).join('');
}

function sidebar(query) {
  const q = (query || '').trim().toLowerCase();
  const room = (secOf(cat) || {}).label || cat;
  // The room name is unconditional now, but "in <room>" is not: a search run
  // from the Global Home covers every section rather than its own two pages, so
  // naming a room there would describe a scope the search does not use.
  catname.innerHTML = q ? `Search${cat ? `<span>in ${esc(room)}</span>` : ''}`
    : `${esc(room)}<span>${under(cat).length} pages</span>`;

  if (q) {
    // Searching from inside a section searches that section, not the vault: the
    // question you are asking in Diet is a question about food, and a page from
    // Personal Projects that happens to list a filename is not an answer to it.
    // The Global Home is the room where "everything" is the right scope.
    // pageText() is what the page shows, slices included — not just the HTML
    // that was written into it.
    const hits = NOTES.filter(n => (!cat || n.category === cat)
      && ((n.title + ' ' + n.category).toLowerCase() + ' ' + pageText(n)).includes(q));
    // A section can answer out of its own data as well as its pages — the Diet
    // recipes and the log live in CSVs, not in any page's text. One line per
    // section that has data worth searching.
    const data = cat === 'diet' ? dietSearch(q) : [];
    const total = hits.length + data.length;
    nav.innerHTML = `<div class="hits">${total} match${total === 1 ? '' : 'es'}</div>`
      + `<div class="results">` + hits.map(n =>
        `<a href="#/n/${encodeURIComponent(n.slug)}" data-s="${n.slug}"><i>·</i>${esc(n.title)}` +
        (n.summary ? `<small>${esc(n.summary)}</small>` : '') + `</a>`).join('')
      + data.map(r => `<a href="${r.href}"${r.day ? ` data-day="${r.day}"` : ''}>
          <i>·</i>${esc(r.title)}<small>${esc(r.sub)}</small></a>`).join('') + `</div>`;
  } else {
    // Every rail draws its panel the same way, the Global Home included — its
    // pages are the loose files in `pages/` itself, which is the same rule that
    // makes any other folder a section. It used to show the Inbox instead, and
    // that cost the one thing a panel is for: a section whose pages you cannot
    // list from the rail is a section you can only reach by remembering it. The
    // Inbox has its own room at `#/inbox`, one click away on the button below.
    const s = secOf(cat) || {label: cat};
    // A section can split itself into groups — projects by status. Pages that
    // sit in the section folder itself have no group and lead, the way the
    // Inbox panel puts loose files above the folders.
    // Sub-pages are drawn by their parent, so only top-level pages are listed
    // here — otherwise every child would appear twice.
    const top = under(cat).filter(n => !n.parent);
    const loose = top.filter(n => !n.group);
    const open = openFolds();
    const tree = ns => `<div class="tree">${ns.map(n => linkTree(n, open)).join('')}</div>`;
    nav.innerHTML = s.groups
      ? (loose.length ? tree(loose) : '')
        + Object.entries(s.groups).map(([dir, label]) => {
          const items = top.filter(n => n.group === dir);
          return `<h4>${esc(label)}<b>${items.length}</b></h4>` + tree(items);
        }).join('')
      : `<h4>${esc(s.label)}<b>${top.length}</b></h4>` + tree(top);
  }
  mark();
}

function mark() {
  // Staged files use the same data-s contract as pages, so currentSlug()
  // lights either panel.
  const cur = currentSlug();
  nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.s === cur));
  // The lit rail button follows the page you are actually on. Following `cat`
  // alone lit Global Home while you stood on a Projects page, because a deep link
  // or a card click reaches a section without going through the rail.
  const here = cur && BY[cur] ? BY[cur].category : cat;
  rail.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.cat === here));
}

rail.onclick = e => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  cat = b.dataset.cat;
  localStorage.setItem('cat', cat);
  q.value = '';
  drawRail();
  sidebar('');
  // A section lands on its own home: an explicit route if it has one, otherwise
  // the folder's index.html.
  const s = SECTIONS.find(x => (x.folder || '') === cat) || {};
  const idx = cat && homeOf(cat);
  location.hash = s.route || (idx ? '#/n/' + encodeURIComponent(idx.slug) : '#/');
};

// Local date, not UTC: toISOString() alone rolls the day over at 09:00 in Seoul,
// so a morning meal would file itself under yesterday.
const today = (d = new Date()) =>
  new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

// "yesterday", "3 days ago", "last week" from an ISO date. The platform already
// owns this — pluralising and the today/yesterday cases are not worth writing
// by hand, and `numeric: 'auto'` is what gives them for free.
const RTF = new Intl.RelativeTimeFormat('en', {numeric: 'auto'});
const AGE_UNITS = [['year', 365], ['month', 30], ['week', 7], ['day', 1]];
function ageOf(iso) {
  if (!iso) return '';
  // Local midnight on both sides, so a page saved this morning is "today"
  // rather than a fraction of a day that rounds however it likes.
  const days = Math.round((new Date(iso + 'T00:00') - new Date(today() + 'T00:00')) / 864e5);
  const [unit, size] = AGE_UNITS.find(([, s]) => Math.abs(days) >= s) || ['day', 1];
  return RTF.format(Math.round(days / size), unit);
}

