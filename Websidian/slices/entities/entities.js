/** `<div data-slice="related">` — what this page is attached to.
 *
 *  A knowledge page is a page whose filename is an id in `Data/entities.csv`,
 *  and that row is the whole reason the page is not an isolated document: its
 *  `related` column is the anchor the entry had to earn, and every row pointing
 *  back at it is a place the same thing came up again.
 *
 *  Both directions are drawn, because they are different facts. What this page
 *  points at was a decision made while writing it. What points here was made
 *  later, by something else, and is the only way an entry gets richer without
 *  being edited.
 *
 *  Each chip also carries how its link was made. A backlink's mark belongs to
 *  the row that wrote it, not to this one — `by[bid].via[id]`, never `me.via` —
 *  because the claim is that entity's, and reading it off this page would put
 *  someone else's certainty under our own name.
 *
 *  A chip links only when there is a page behind it. Most entities — a trip, a
 *  laptop, a person — are rows and nothing more, and a link that lands on the
 *  dashboard is worse than plain text.
 */
function relatedBlock(n) {
  const all = META.entities || [];
  // The vocabulary comes from the build, which is the thing that validates it.
  const VIA = META.via || {};
  const id = n.slug.split('/').pop();
  const me = all.find(e => e.id === id);
  if (!me) return `<p>Nothing in <code>Data/entities.csv</code> answers to
    <code>${esc(id)}</code>, so this page is anchored to nothing.</p>`;

  const by = Object.fromEntries(all.map(e => [e.id, e]));
  // A link is either an id or a person's name written the way people write it.
  // Slug shape tells them apart — the same call entities.csv itself makes.
  //
  // ponytail: only knowledge entities have a page, because only they promise
  // that the id is the filename. Give entities.csv a `page` column if a project
  // or a place ever wants to be clicked through to.
  // An unmarked edge gets no attribute at all rather than data-via="", so the
  // CSS can ask for :not([data-via]) and say "nobody wrote this down" — a
  // state that has to stay distinct from "someone said so".
  const chip = (ref, via) => {
    const mark = VIA[via] ? ` data-via="${esc(via)}" title="${esc(VIA[via])}"` : '';
    const e = by[ref];
    if (!e) return `<span class="badge"${mark}>${esc(ref)}</span>`;
    const page = BY['knowledge/' + e.id];
    return page
      ? `<a class="tag"${mark} href="#/n/${encodeURIComponent(page.slug)}">${esc(e.name)}</a>`
      : `<span class="badge"${mark}>${esc(e.name)}</span>`;
  };

  // Links are one-directional by convention, but nothing enforces it, and a
  // reciprocal pair would otherwise print the same chip in both rows.
  const back = all.filter(e => e.related.includes(id) && !me.related.includes(e.id))
                  .map(e => e.id);
  const shown = me.related.map(r => me.via[r])
    .concat(back.map(bid => by[bid].via[id]));
  // The legend is drawn from what is actually on this page. A row where every
  // edge was stated should not carry a paragraph about dashes it does not have.
  const key = [
    shown.some(v => v === 'inferred')
      && `<i data-via="inferred">dashed</i> concluded here — nothing said it outright`,
    shown.some(v => !VIA[v])
      && `<i>faded</i> unrecorded, and older than the column that would have said`,
  ].filter(Boolean);

  return `<div class="foot">
    <h2>Anchored to</h2>
    <div class="row">${me.related.map(r => chip(r, me.via[r])).join('')
      || '<span class="badge">nothing — this entry has not earned its place</span>'}</div>
    ${back.length ? `<h2 style="margin-top:20px">Referred to by</h2>
      <div class="row">${back.map(bid => chip(bid, by[bid].via[id])).join('')}</div>` : ''}
    ${key.length ? `<p class="ent-key">${key.join('<br>')}</p>` : ''}
    ${me.aka.length ? `<p style="margin-top:16px">Also called
      ${me.aka.map(esc).join(' · ')}.</p>` : ''}
  </div>`;
}
