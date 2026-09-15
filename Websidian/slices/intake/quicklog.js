/** Quick log: four time-of-day cards, each opening a popup to pick from —
 *  writes straight to `Data/intake.csv`.
 *
 *  A second writer next to `/vault-intake`, and safe for the same reason a
 *  hand-typed amount is safe to trust: every entry here was resolved against
 *  `ingredients.csv`/`recipes.csv` before it reached the tray, so there is
 *  nothing left to estimate. Every row this writes carries `source=manual` so
 *  it never gets mistaken for what a skill inferred from free text.
 *
 *  Shares its matching engine with the simulator above it on the page
 *  (`simCatalog`, `simMatches`, `simPrice`, ...) rather than re-deriving one —
 *  same reference files, same ranking, one place either can drift from
 *  `ingredients.csv`.
 *
 *  The popup is a native `<dialog>`, on the same pattern as the Milestone
 *  Dialog in `shell/timeline.js` — Escape, the backdrop and focus containment
 *  are the browser's, so none of that is re-implemented here. Its own body is
 *  redrawn wholesale on every interaction except typing in the search box,
 *  which replaces only the results div — see the `input` listener at the
 *  bottom, and the note on the first quick-log build that made this necessary.
 *
 *  Every interaction is wired through one delegated `click`/`input` listener
 *  on `document`, bound once at load, the same way the timeline and the
 *  recipe cards are — nothing here needs rebinding after a redraw.
 */
const SLOTS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

let quickSlot = null;       // the slot the open dialog represents; an arbitrary
                             // meal name while editing an older, free-text meal
let quickTray = [];         // [{kind, key, label, amount, grams|servings, per}]
let quickQuery = '';
let quickMsg = '';
let quickEditing = null;    // {when, meal} of the logged meal being edited, or null
let quickTab = 'recent';    // 'recent' | 'favorite' | 'most'
let favFilter = '';         // '' = All, else a slot name — the Favorite tab's filter
let favSort = {k: 'kcal', desc: true};

/** last-eaten date and times-eaten, per catalog key, across all history — not
 *  scoped to one slot. Most of the log predates quick log and was never typed
 *  with "Breakfast"/"Lunch" as its meal name, so a slot-scoped ranking would
 *  read as empty for weeks; a global one is useful from the first day. */
function usageStats() {
  const stats = {};
  (META.intake || []).forEach(m => m.items.forEach(i => {
    const s = stats[i.ingredient] || (stats[i.ingredient] = {last: '', count: 0});
    s.count++;
    if (m.when > s.last) s.last = m.when;
  }));
  Object.entries(recipeLog()).forEach(([dish, dates]) => {
    if (dates.length) stats[dish] = {last: dates[dates.length - 1], count: dates.length};
  });
  return stats;
}

const usageRanked = (n, by) => {
  const stats = usageStats();
  return simCatalog().filter(e => stats[e.key])
    .sort((a, b) => by(stats[a.key], stats[b.key])).slice(0, n);
};
const recentFoods = (n = 12) => usageRanked(n, (a, b) => b.last.localeCompare(a.last));
const frequentFoods = (n = 12) => usageRanked(n, (a, b) => b.count - a.count);

/** A favourite is tagged with the slot it was favourited *from* — the same
 *  food can be a favourite for Breakfast and, separately, for Snack, as two
 *  rows in `favorites.csv`. `\0` joins kind and key for the lookup map
 *  because it cannot occur in either. */
const favKey = (kind, key) => kind + '\0' + key;
const isFavorite = (e, slot) => (META.favorites || [])
  .some(f => f.kind === e.kind && f.key === e.key && f.slot === slot);

function favoriteEntries(filterSlot) {
  const slots = {};
  (META.favorites || []).filter(f => !filterSlot || f.slot === filterSlot).forEach(f => {
    const k = favKey(f.kind, f.key);
    (slots[k] || (slots[k] = new Set())).add(f.slot);
  });
  return simCatalog().filter(e => slots[favKey(e.kind, e.key)])
    .map(e => ({...e, favSlots: [...slots[favKey(e.kind, e.key)]]}));
}

function quickDefaultAmount(e) {
  if (e.kind === 'dish') return {amount: 1, unit: 'x'};
  return e.portion ? {amount: 1, unit: 'x'} : {amount: 100, unit: 'g'};
}

function quickCard(e, favSlots) {
  const kcal = Math.round(e.per.kcal || 0);
  const sub = e.kind === 'dish' ? `${kcal} kcal · serving`
    : `${kcal} kcal / 100 g${e.portion ? ` · ${e.portion} g each` : ''}`;
  // No star while editing an older meal — favouriting it would tag the
  // favourite with whatever free-text name that meal happened to carry.
  const star = quickSlot && !quickEditing;
  const fav = star && isFavorite(e, quickSlot);
  return `<div class="card qcard">
    ${star ? `<button type="button" class="qstar${fav ? ' on' : ''}"
        data-qfav-kind="${e.kind}" data-qfav-key="${esc(e.key)}"
        aria-label="${fav ? 'Remove from favourites' : 'Add to favourites'}"
        title="${fav ? 'Remove from favourites' : 'Add to favourites'}">${fav ? '★' : '☆'}</button>` : ''}
    <button type="button" class="qadd" data-qadd-kind="${e.kind}" data-qadd-key="${esc(e.key)}">
      <h3>${esc(e.kind === 'dish' ? dishName(e.key) : e.key)}</h3>
      <div class="hint">${esc(sub)}</div>
      ${favSlots ? `<div class="hint">for ${esc(favSlots.join(', '))}</div>` : ''}
    </button>
  </div>`;
}

const QUICK_MAX = 24;

/** Just the results, so a keystroke can redraw this alone — replacing the
 *  input along with it is what dropped focus after every letter in the first
 *  build of this box. */
function quickResultsBlock() {
  const q = quickQuery.trim();
  const hits = q ? simMatches(q) : simAll();
  const shown = hits.slice(0, QUICK_MAX), rest = hits.length - shown.length;
  return `${shown.length ? `<div class="cards qcards">${shown.map(e => quickCard(e)).join('')}</div>`
      : `<div class="hint">Nothing in <code>ingredients.csv</code> or
          <code>recipes.csv</code> matches that.</div>`}
    ${rest > 0 ? `<div class="hint" style="margin-top:6px">${rest} more — keep typing</div>` : ''}`;
}

function quickRecentPanel() {
  const items = recentFoods();
  return items.length ? `<div class="cards qcards">${items.map(e => quickCard(e)).join('')}</div>`
    : `<div class="hint">Nothing on record yet.</div>`;
}

function quickMostPanel() {
  const items = frequentFoods();
  return items.length ? `<div class="cards qcards">${items.map(e => quickCard(e)).join('')}</div>`
    : `<div class="hint">Nothing on record yet.</div>`;
}

function quickFavoritePanel() {
  const entries = favoriteEntries(favFilter);
  const key = e => favSort.k === 'name' ? (e.kind === 'dish' ? dishName(e.key) : e.key)
    : (e.per.kcal || 0);
  const sorted = [...entries].sort((a, b) => {
    const x = key(a), y = key(b);
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return favSort.desc ? -c : c;
  });
  const filters = ['', ...SLOTS].map(s => `<button type="button"
      class="pill${s === favFilter ? ' val' : ''}" data-qfavfilter="${s}">${s || 'All'}</button>`).join('');
  const sorts = [['kcal', 'Calories'], ['name', 'Name']].map(([k, label]) => `<button type="button"
      class="pill${k === favSort.k ? ' val' : ''}" data-qfavsort="${k}">${label}</button>`).join('');
  return `<div class="row" style="margin:0 0 8px">${filters}</div>
    <div class="row" style="margin:0 0 12px"><span class="hint">Sorted by</span>${sorts}</div>
    ${sorted.length ? `<div class="cards qcards">${sorted.map(e => quickCard(e, e.favSlots)).join('')}</div>`
      : `<div class="hint">No favourites${favFilter ? ` for ${esc(favFilter)}` : ''} yet — tap the
          star on a card to add one.</div>`}`;
}

function quickTrayBlock() {
  if (!quickTray.length) return '';
  const kcal = quickTray.reduce((s, x) => s + (x.per.kcal || 0), 0);
  return `<div class="simchips" style="margin-top:16px">${quickTray.map((x, i) =>
      `<span class="simchip">${esc(x.label)} <i>${esc(x.amount)}</i>
        <b>${Math.round(x.per.kcal || 0)}</b>
        <button type="button" data-qdrop="${i}" title="Remove">×</button></span>`).join('')}
    <button type="button" class="btn" data-qsave>${
      quickEditing ? 'Save changes' : `Log to ${esc(quickSlot)}`}</button>
    ${quickEditing ? `<button type="button" class="simclear" data-qcancel>Cancel edit</button>`
      : `<button type="button" class="simclear" data-qdrop="all">Clear all</button>`}
    </div>
    <div class="hint" style="margin-top:4px">Adds up to ${Math.round(kcal)} kcal.</div>`;
}

function quickDialogBody() {
  const editing = !!quickEditing;
  const searching = quickQuery.trim().length > 0;
  const tabs = editing ? [['recent', 'Recent'], ['most', 'Most logged']]
    : [['recent', 'Recent'], ['favorite', 'Favorite'], ['most', 'Most logged']];
  return `<form method="dialog"><button class="tl-close" aria-label="Close">✕</button></form>
    <h3>${esc(quickSlot || '')}</h3>
    ${editing ? `<div class="hint" style="margin-top:4px">Editing <b>${esc(quickEditing.meal)}</b>
        at ${esc(quickEditing.when.slice(11, 16))} — change what's in the tray, then save.</div>` : ''}
    <input type="text" class="qsearch" placeholder="Search a food or a dish"
      value="${esc(quickQuery)}" style="margin-top:14px">
    <div class="qresults"${searching ? '' : ' hidden'}>${quickResultsBlock()}</div>
    <div class="tl-tabs" role="tablist"${searching ? ' hidden' : ''}>${tabs.map(([k, label]) =>
      `<button type="button" class="pill${k === quickTab ? ' act' : ''}" role="tab"
         aria-selected="${k === quickTab}" data-qltab="${k}">${label}</button>`).join('')}</div>
    <div class="tl-part" id="qltab-recent"${searching || quickTab !== 'recent' ? ' hidden' : ''}>${quickRecentPanel()}</div>
    ${editing ? '' : `<div class="tl-part" id="qltab-favorite"${
        searching || quickTab !== 'favorite' ? ' hidden' : ''}>${quickFavoritePanel()}</div>`}
    <div class="tl-part" id="qltab-most"${searching || quickTab !== 'most' ? ' hidden' : ''}>${quickMostPanel()}</div>
    ${quickTrayBlock()}
    ${quickMsg ? `<div class="hint" style="margin-top:8px">${esc(quickMsg)}</div>` : ''}`;
}

function quickDialogRedraw() {
  const dlg = document.getElementById('qldlg');
  if (dlg) dlg.innerHTML = quickDialogBody();
}

function quickOpen(slot) {
  quickSlot = slot;
  quickEditing = null;
  quickTray = [];
  quickQuery = '';
  quickMsg = '';
  quickTab = 'recent';
  quickDialogRedraw();
  document.getElementById('qldlg').showModal();
}

/** Called from `onRecord`'s edit control: loads one already-logged meal into
 *  the tray so its ingredients can be added to or dropped, in the same
 *  dialog. Only foods can be re-priced exactly — a meal logged with a dish
 *  already expanded is edited as its loose ingredients, which is what is
 *  actually sitting in `intake.csv` for it. */
function quickEdit(m) {
  quickSlot = m.meal;
  quickEditing = {when: m.when, meal: m.meal};
  quickTray = m.items.map(i => {
    const e = simCatalog().find(x => x.kind === 'food' && x.key === i.ingredient);
    return e ? simPrice(e, i.grams, 'g')
      : {kind: 'food', key: i.ingredient, label: i.ingredient, grams: i.grams,
         amount: `${i.grams} g`, per: {kcal: i.kcal}};
  });
  quickQuery = '';
  quickMsg = '';
  quickTab = 'recent';
  quickDialogRedraw();
  document.getElementById('qldlg').showModal();
}

/** A dish in the tray holds its aggregate totals, never its ingredients — the
 *  same shape the price lookup returns them in. `intake.csv` only ever
 *  accepts ingredient rows, so a dish is expanded against `recipes.csv` at
 *  the last moment, scaled by however many servings the tray holds. */
function expandDish(x) {
  const dish = (META.recipes || []).find(d => d.dish === x.key);
  if (!dish) return [];
  return dish.items.map(i => ({ingredient: i.ingredient,
    grams: Math.round(i.grams * x.servings * 10) / 10}));
}

function quickLogBlock() {
  if (!simCatalog().length) return '';
  const day = today();
  const bySlot = s => (META.intake || [])
    .filter(m => (m.when || '').startsWith(day) && m.meal === s)
    .reduce((sum, m) => sum + (m.kcal || 0), 0);
  return `<div class="box s7 quicklog"><h3>Quick log</h3>
    <div class="stats" style="margin-bottom:0">Pick a time, then pick what you ate — no
      writing, no session to run. Straight into <code>Data/intake.csv</code>, tagged so
      it never reads as something <code>/vault-intake</code> estimated.</div>
    <div class="qslots">${SLOTS.map(s => {
      const kcal = Math.round(bySlot(s));
      return `<button type="button" class="card qslot${kcal ? ' done' : ''}" data-qopen="${s}">
        <h3>${s}</h3>
        ${kcal ? `<div class="qslot-kcal">${kcal}<span>kcal</span></div>`
               : `<div class="qslot-add">+</div>`}
      </button>`;
    }).join('')}</div>
    <dialog id="qldlg" class="tl-modal ql-modal"></dialog>
  </div>`;
}

async function quickToggleFavorite(kind, key) {
  const r = await api('/api/favorite/toggle', {method: 'POST',
    body: JSON.stringify({kind, key, slot: quickSlot})}).catch(e => ({error: String(e)}));
  if (r.error) { quickMsg = 'Could not update favourites — ' + r.error; quickDialogRedraw(); return; }
  // Patched locally so the star flips at once; the server already rebuilt,
  // so the next real page load carries the same state either way.
  const favs = META.favorites || (META.favorites = []);
  const idx = favs.findIndex(f => f.kind === kind && f.key === key && f.slot === quickSlot);
  if (r.favorited && idx < 0) favs.push({kind, key, slot: quickSlot, added: today()});
  else if (!r.favorited && idx >= 0) favs.splice(idx, 1);
  quickDialogRedraw();
}

async function quickSave(saveBtn) {
  if (!quickTray.length) { quickMsg = 'Add something first.'; quickDialogRedraw(); return; }
  const items = quickTray.flatMap(x => x.kind === 'dish' ? expandDish(x)
    : [{ingredient: x.key, grams: x.grams}]);
  if (!items.length) {
    quickMsg = 'Could not resolve a dish in the tray against recipes.csv.';
    return void quickDialogRedraw();
  }
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  const when = quickEditing ? quickEditing.when
    : `${today()} ${new Date().toTimeString().slice(0, 5)}`;
  const meal = quickEditing ? quickEditing.meal : quickSlot;
  const endpoint = quickEditing ? '/api/intake/edit' : '/api/intake/log';
  const r = await api(endpoint, {method: 'POST',
    body: JSON.stringify({when, meal, items})}).catch(e => ({error: String(e)}));
  if (r.error) {
    quickMsg = 'Could not save — ' + r.error;
    return void quickDialogRedraw();
  }
  location.reload();
}

document.addEventListener('click', e => {
  const open = e.target.closest('[data-qopen]');
  if (open) return void quickOpen(open.dataset.qopen);

  const tab = e.target.closest('[data-qltab]');
  if (tab) { quickTab = tab.dataset.qltab; return void quickDialogRedraw(); }

  const filter = e.target.closest('[data-qfavfilter]');
  if (filter) { favFilter = filter.dataset.qfavfilter; return void quickDialogRedraw(); }

  const sort = e.target.closest('[data-qfavsort]');
  if (sort) {
    const k = sort.dataset.qfavsort;
    favSort = k === favSort.k ? {k, desc: !favSort.desc} : {k, desc: true};
    return void quickDialogRedraw();
  }

  const fav = e.target.closest('[data-qfav-key]');
  if (fav) return void quickToggleFavorite(fav.dataset.qfavKind, fav.dataset.qfavKey);

  const add = e.target.closest('[data-qadd-key]');
  if (add) {
    const entry = simCatalog().find(x => x.kind === add.dataset.qaddKind && x.key === add.dataset.qaddKey);
    if (!entry) return;
    const {amount, unit} = quickDefaultAmount(entry);
    const priced = simPrice(entry, amount, unit);
    if (priced.error) { quickMsg = priced.error; return void quickDialogRedraw(); }
    quickTray.push(priced);
    quickMsg = '';
    return void quickDialogRedraw();
  }

  const drop = e.target.closest('[data-qdrop]');
  if (drop) {
    if (drop.dataset.qdrop === 'all') quickTray = [];
    else quickTray.splice(+drop.dataset.qdrop, 1);
    return void quickDialogRedraw();
  }

  const cancel = e.target.closest('[data-qcancel]');
  if (cancel) { quickEditing = null; quickTray = []; return void quickDialogRedraw(); }

  const save = e.target.closest('[data-qsave]');
  if (save) quickSave(save);
});

// A keystroke redraws only the results — see the docblock at the top.
document.addEventListener('input', e => {
  if (!e.target.matches('.qsearch')) return;
  quickQuery = e.target.value;
  const dlg = document.getElementById('qldlg');
  if (!dlg) return;
  const searching = quickQuery.trim().length > 0;
  const results = dlg.querySelector('.qresults');
  if (results) { results.hidden = !searching; results.innerHTML = quickResultsBlock(); }
  const tabs = dlg.querySelector('.tl-tabs');
  if (tabs) tabs.hidden = searching;
  dlg.querySelectorAll('.tl-part').forEach(p => { p.hidden = searching || p.id !== `qltab-${quickTab}`; });
});
