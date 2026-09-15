/** The people, as cards grouped by which part of life they belong to.
 *
 *  A card carries the name, the category and the keywords — nothing else is
 *  recorded, so nothing else is shown. Reuses `.cards` and the pill system
 *  rather than growing a stylesheet for one page.
 */
function peopleBlock() {
  const rows = META.people || [];
  if (!rows.length) return `<p class="hint">Nobody in <code>Data/people.csv</code> yet —
    the columns are <code>name,category,keywords</code>, keywords separated by
    <code>;</code>.</p>`;
  // Already ordered by the reader; the headings just follow the run.
  const groups = [];
  rows.forEach(p => {
    const last = groups[groups.length - 1];
    if (last && last.cat === p.category) last.people.push(p);
    else groups.push({cat: p.category, people: [p]});
  });
  return groups.map(g => `<div class="foot" style="margin-top:22px">
    <h2>${esc(g.cat || 'Uncategorised')}<b> ${g.people.length}</b></h2>
    <div class="cards">${g.people.map(p => `<div class="card person">
      <h3>${esc(p.name)}</h3>
      <span class="badge">${esc(p.category || '—')}</span>
      <div class="row" style="margin-top:8px">${p.keywords.map(k =>
        `<span class="pill">${esc(k)}</span>`).join('')}</div>
    </div>`).join('')}</div></div>`).join('');
}
