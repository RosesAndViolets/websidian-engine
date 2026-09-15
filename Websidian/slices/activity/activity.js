// A data file is content too, but its filename is not a title. Anything not
// listed falls back to its own name, so a new CSV needs no line here.
const DATA_LABEL = {
  'intake.csv': 'Diet log', 'ingredients.csv': 'Ingredient reference',
  'recipes.csv': 'Recipes', 'targets.csv': 'Targets', 'weight.csv': 'Weight log',
  'projects.csv': 'Project status',
  'milestones.csv': 'Milestones',
};

/** What has been written into the vault lately — pages, logged data,
 *  attachments. Development commits are dropped upstream in data.py, so an
 *  empty list here is a true statement rather than a broken widget. */
function activitySection() {
  const rows = META.activity.slice(0, 6);
  if (!rows.length) return `<div class="box s5"><h3>Recent activity<em>content</em></h3>
    <div class="stats" style="margin:0">Nothing logged yet. This shows pages and data
      written into the vault — an inbox run, an edit, rows added by a model — and
      skips commits that touch the application itself.</div></div>`;
  const label = f => {
    const n = NOTES.find(x => x.path === f);
    if (n) return `<a href="#/n/${encodeURIComponent(n.slug)}">${esc(n.title)}</a>`;
    const name = f.split('/').pop();
    return `<span class="gone">${esc(DATA_LABEL[name] || name)}</span>`;
  };
  return `<div class="box s5"><h3>Recent activity<em>content</em></h3>
    ${rows.map(c => `<div class="act">
      <div class="act-h"><b>${esc(c.subject)}</b>
        <span class="when">${esc(c.date)}</span></div>
      <div class="act-f">${c.files.map(label).join('')}${
        c.more ? `<span class="gone">+${c.more} more</span>` : ''}</div>
    </div>`).join('')}</div>`;
}
