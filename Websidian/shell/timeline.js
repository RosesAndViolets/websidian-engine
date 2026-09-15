/** A dated list with a rule down the left: project milestones, events, career
 *  milestones. Several pages draw one, so the markup lives here instead of
 *  drifting into several near-copies.
 *
 *  An item is:
 *    when   the small line above the title — a date, a range, "D+42 · 2025-11-10"
 *    title  what happened
 *    note   the paragraph under it, optional
 *    tags   pills between the two, optional — attendees, topics
 *    parts  the full account in named rooms, optional — opens a dialog
 *    counts how many things are in each room, for the tab that opens it
 *    gap    the pill on the right: how long since the entry above
 *    tight  close up the space below, for entries sharing a day
 *    now    the lit dot — whichever end of the list is "where things stand"
 *
 *  The list stays a list: `note` is one or two lines and the entry is read at a
 *  glance. Anything worth studying goes in `parts`, which opens in a <dialog>
 *  rather than pushing the entries below it down the page — a timeline you have
 *  to re-find your place in is not a timeline.
 *
 *  **`parts` is rooms, not a document.** It arrives as `{account, dropped, code,
 *  refs}` and each becomes a tab, because the four are different kinds of thing
 *  and a reader looking for the rejected path should not have to scroll past the
 *  prose to find it. The tab carries its own count, so you learn there were five
 *  dropped decisions without opening them — the summary before the detail, which
 *  is the rule the rest of this site is built on.
 *
 *  The values are HTML fragments the vault wrote, injected as they are. That is
 *  the same trust the pages themselves are read under; nothing here comes off a
 *  network. It also means this file no longer carries a `# `-to-heading
 *  convention — the fragment is already markup, so the parser is gone.
 *
 *  <dialog> and not a div: Escape, the backdrop, focus containment and returning
 *  focus to the entry afterwards are all the browser's, and `method="dialog"`
 *  closes it without a line of script. An entry with no parts renders exactly
 *  as it always did, which is why the events list is untouched by any of
 *  this.
 */
let tlSeq = 0;

// The order the rooms are offered in, and what to call them. Account first
// because it is the entry's own account of itself; sources last because they
// are what you check rather than what you read.
const TL_PARTS = [['account', 'Account'], ['dropped', 'Dropped'],
                  ['code', 'Code'], ['refs', 'Sources']];

function timeline(items) {
  const head = i => `<div class="tl-when">${esc(i.when)}</div>
    <b>${esc(i.title)}</b>
    ${(i.tags || []).length ? `<div class="row" style="margin:6px 0 0">${i.tags.map(t =>
      `<span class="pill">${esc(t)}</span>`).join('')}</div>` : ''}
    ${i.note ? `<p>${esc(i.note)}</p>` : ''}`;
  return `<ol class="tl">${items.map(i => {
    // A quiet entry is a day the project moved without earning a milestone.
    // It shares the spine because that is the claim — the same chronology, one
    // rank down — and it stays folded because a session's dozen bullets beside
    // a milestone's one line would make the footnotes louder than the text.
    // `<details>` rather than a handler: the disclosure and its keyboard
    // support are already in the browser.
    if (i.quiet) {
      return `<li class="tl-quiet"><details>
        <summary><span class="tl-when">${esc(i.when)}</span>
          <span class="tl-sum">${esc(i.title)}</span></summary>
        <ul>${i.bullets.map(b => `<li><i>${esc(b.kind)}</i>${esc(b.text)}</li>`).join('')}</ul>
      </details></li>`;
    }
    const li = `<li class="${i.tight ? 'tight ' : ''}${i.now ? 'now' : ''}">`;
    // `pick` is the other reason an entry is clickable: it selects something
    // elsewhere on the page rather than opening a dialog. Whoever passed it
    // owns the listener — the timeline only marks which entry was hit.
    const rooms = TL_PARTS.filter(([k]) => (i.parts || {})[k]);
    if (!rooms.length) return i.pick === undefined
      ? `${li}${head(i)}${gapPill(i)}</li>`
      : `${li}<button type="button" class="tl-hit" data-tl-pick="${esc(i.pick)}">${
          head(i)}</button>${gapPill(i)}</li>`;
    const id = `tlx${++tlSeq}`;
    // One room is not a choice. A lone Account pane gets no tab strip, so an
    // entry that only has an account opens looking exactly as it always did.
    const tabs = rooms.length < 2 ? '' :
      `<div class="tl-tabs" role="tablist">${rooms.map(([k, label], n) =>
        `<button type="button" class="pill${n ? '' : ' act'}" role="tab"
           aria-selected="${!n}" data-tl-tab="${id}-${k}">${label}${
           (i.counts || {})[k] ? `<span class="n">${i.counts[k]}</span>` : ''}
         </button>`).join('')}</div>`;
    return `${li}
      <button type="button" class="tl-hit" data-tl-open="${id}">${head(i)}</button>
      ${gapPill(i)}
      <dialog id="${id}" class="tl-modal">
        <form method="dialog"><button class="tl-close" aria-label="Close">✕</button></form>
        <div class="tl-when">${esc(i.when)}</div>
        <h3>${esc(i.title)}</h3>
        ${tabs}
        ${rooms.map(([k], n) => `<div class="tl-part tl-${k}" id="${id}-${k}"
          role="tabpanel"${n ? ' hidden' : ''}>${i.parts[k]}</div>`).join('')}
      </dialog></li>`;
  }).join('')}</ol>`;
}

const gapPill = i => i.gap ? `<span class="tl-gap"${i.gapTitle
  ? ` title="${esc(i.gapTitle)}"` : ''}>${esc(i.gap)}</span>` : '';

// Delegated, so a timeline redrawn by a route change needs no rebinding.
document.addEventListener('click', e => {
  const hit = e.target.closest('[data-tl-open]');
  if (hit) document.getElementById(hit.dataset.tlOpen).showModal();

  const tab = e.target.closest('[data-tl-tab]');
  if (tab) tlShow(tab.closest('.tl-modal'), tab.dataset.tlTab);

  // A snippet says which sentence it explains, and clicking it goes there and
  // lights it. The connection is data — one attribute on the <figure> — so the
  // prose never has to spend a clause saying "see the code below", and the two
  // cannot drift apart the way a written cross-reference does.
  const fig = e.target.closest('figure[data-explains]');
  if (fig) {
    const dlg = fig.closest('.tl-modal');
    const p = dlg.querySelector(`[data-p="${CSS.escape(fig.dataset.explains)}"]`);
    if (!p) return;
    tlShow(dlg, dlg.querySelector('.tl-account').id);
    p.classList.add('lit');
    p.scrollIntoView({block: 'center', behavior: 'smooth'});
    p.addEventListener('animationend', () => p.classList.remove('lit'), {once: true});
  }
});

/** Show one room and hide its siblings, within one dialog. */
function tlShow(dlg, paneId) {
  if (!dlg) return;
  dlg.querySelectorAll('[data-tl-tab]').forEach(b => {
    const on = b.dataset.tlTab === paneId;
    b.classList.toggle('act', on);
    b.setAttribute('aria-selected', on);
  });
  dlg.querySelectorAll('.tl-part').forEach(p => { p.hidden = p.id !== paneId; });
}

const apartDays = (a, b) => Math.round(
  (Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 864e5);
// Days up close, months once a run of them stops meaning anything.
const gapLabel = n => n >= 90 ? `+${Math.round(n / 30.44)}mo` : `+${n}d`;
