/** The supplement regimen, and what it adds up to against published limits.
 *
 *  **The bar is drawn against the UL, not the RDA.** The question this page
 *  exists for is "is this doing damage", and that is a ceiling question. An RDA
 *  bar would fill to 1000% on the vitamin C and say nothing at all — being far
 *  over a floor is the normal state of a supplement.
 *
 *  Nothing here interprets a number. A total, its ceiling, and the share of the
 *  ceiling it uses are arithmetic; whether that matters for one person's liver
 *  is not, and the page routes that to the panels the vault already tracks
 *  rather than answering it.
 */
const suppPct = n => n === null ? '' : `${n}%`;

const suppNum = v => {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, '');
};

/** The scale, built to read like a reference-range chart — because it is
 *  answering the same shape of question.
 *
 *  In one of those, a shaded band is the published range and a dot is your
 *  value. Here the band runs **RDA to UL**: above the floor where deficiency
 *  starts,
 *  below the ceiling where excess starts. A dot inside the band is a dose with
 *  a published range around it, and one past the right-hand tick is over the
 *  ceiling — the same read, in the same visual language, so the two pages do
 *  not have to be learned separately.
 *
 *  The axis runs to 1.35x the UL rather than stopping at it, for the reason the
 *  chart uses `HI = 1.38`: a scale that ends at the limit puts every overshoot
 *  in the same place and hides how far over it went.
 */
function suppScale(n) {
  if (!n.ul) return '<span class="sp-none">no ceiling set</span>';
  // Headroom past the ceiling, widened if the dose needs more than that. A
  // fixed multiplier pins anything above it to the end of the track, which is
  // the one case the headroom exists to show — niacin at 144% landed on the
  // edge and read the same as 200% would.
  const top = Math.max(n.ul * 1.35, n.total * 1.08);
  const at = v => Math.min(v, top) / top * 100;
  const rdas = [n.rda_f, n.rda_m].filter(v => v !== null && v !== undefined);
  // The lower of the two sexes' RDAs opens the band: it is the floor that is
  // certainly cleared, and the RDA column beside it already prints both.
  const rda = rdas.length ? Math.min(...rdas) : null;
  const band = rda !== null && rda < n.ul
    ? `<span class="sp-band" style="left:${at(rda)}%;width:${at(n.ul) - at(rda)}%"></span>
       <span class="sp-tick" style="left:${at(rda)}%"></span>` : '';
  return `<span class="sp-scale">${band}
    <span class="sp-tick sp-ceil" style="left:${at(n.ul)}%"></span>
    <span class="sp-val${n.overUl ? ' over' : ''}" style="left:${at(n.total)}%"></span>
  </span><em>${suppPct(n.pctUl)}</em>`;
}

/** Where a nutrient actually comes from, and what the ceiling rests on.
 *
 *  Opened from its own row rather than shown always: eleven products across
 *  twenty-four nutrients is a wall of arithmetic nobody reads, but the moment
 *  one row says "over the ceiling" the only useful next question is which
 *  bottle put it there.
 *
 *  The commentary is the `basis` cell of `nutrient-limits.csv` and nothing
 *  else. That is where the sourcing lives — which authority set the number,
 *  what it was set on, and where the units do not line up — and it is the
 *  furthest this page goes toward interpretation.
 */
function suppDetail(n, i) {
  const rows = n.parts.map(q => `<tr>
    <td>${esc(q.product)}${q.brand ? ` <i>${esc(q.brand)}</i>` : ''}</td>
    <td class="sp-n">${suppNum(q.per)} ${esc(n.unit)} <i>per ${esc(q.form)}</i></td>
    <td class="sp-n">${suppNum(q.units)}${q.every !== 1
      ? ` / ${suppNum(q.every)} days` : ' a day'}</td>
    <td class="sp-n"><b>${suppNum(q.amount)}</b> ${esc(n.unit)}</td>
    <td class="sp-share"><span class="sp-sharebar"><span style="width:${q.share}%"></span></span>
      <em>${q.share}%</em></td>
  </tr>`).join('');
  return `<tr class="sp-detail" data-sup-detail="${i}" hidden><td colspan="7">
    <div class="sp-detailin">
      <h4>Where ${esc(n.nutrient)} comes from</h4>
      <table class="sp-parts"><thead><tr><th>Product</th><th>Per unit</th>
        <th>Taken</th><th>Contributes</th><th>Share of your total</th></tr></thead>
        <tbody>${rows}</tbody></table>
      ${n.limitBasis ? `<h4>What the reference values rest on</h4>
        <p class="sp-basisnote">${esc(n.limitBasis)}</p>` : ''}
      ${n.ul ? `<p class="sp-basisnote">Your ${suppNum(n.total)} ${esc(n.unit)} a
        day is <b>${n.pctUl}%</b> of the ${suppNum(n.ul)} ${esc(n.unit)} ceiling.
        ${n.overUl ? 'Over it.' : 'Under it.'} What that means for you is a
        question for the clinic — this is arithmetic, not an assessment.</p>`
        : `<p class="sp-basisnote">No Tolerable Upper Intake Level has been set
        for ${esc(n.nutrient)}. That is not the same as safe at any dose; it
        means the evidence was too thin to place a number.</p>`}
    </div></td></tr>`;
}

/** One nutrient: what goes in, when, and how much of the ceiling that uses. */
function suppRow(n, i) {
  const cap = n.ul ? `${suppNum(n.ul)} ${n.unit}` : 'none set';
  const rda = n.rda_f === null && n.rda_m === null ? ''
    : n.rda_f === n.rda_m ? `${suppNum(n.rda_f)} ${n.unit}`
    : `${suppNum(n.rda_f)}–${suppNum(n.rda_m)} ${n.unit}`;
  return `<tr class="sp-line${n.overUl ? ' sp-over' : ''}" data-sup-row="${i}"
    tabindex="0" role="button" aria-expanded="false">
    <td><b>${esc(n.nutrient)}</b>${n.provisional ? '<i title="A dose on this row is the label default, not a stated regimen">provisional</i>' : ''}${
      n.averaged ? '<i title="Something on this row is not taken every day — the figure is a daily average">daily average</i>' : ''}</td>
    <td class="sp-n">${suppNum(n.morning)}</td>
    <td class="sp-n">${suppNum(n.evening)}</td>
    <td class="sp-n"><b>${suppNum(n.total)}</b> ${esc(n.unit)}${
      n.parts.length > 1 ? `<i>from ${n.parts.length} products</i>` : ''}</td>
    <td class="sp-n">${esc(rda) || '—'}</td>
    <td class="sp-n">${esc(cap)}</td>
    <td class="sp-bar">${suppScale(n)}</td>
  </tr>
  ${suppDetail(n, i)}`;
}

function supplementsBlock() {
  const [prods, nutrients, unknown] = [META.supplements || [],
                                       META.supplementNutrients || [],
                                       META.supplementUnknown || []];
  if (!prods.length) {
    return `<p class="hint">Nothing in <code>Data/supplements.csv</code> yet.</p>`;
  }
  const provisional = prods.filter(p => !p.stated && (p.morning || p.evening));
  const blank = prods.filter(p => p.blank);
  const over = nutrients.filter(n => n.overUl);

  return `${provisional.length ? `<div class="sp-warn">
      <b>${provisional.length} of ${prods.length} products are on their label's
      suggested intake, not a regimen you have stated.</b> Every total below that
      draws on one is marked provisional. Say how many you actually take of each,
      morning and evening, and <code>doses_from</code> becomes <code>stated</code>.
    </div>` : ''}
    ${blank.length ? `<div class="sp-warn sp-bad">
      <b>${blank.length} of ${prods.length} things you take have no label yet</b> —
      ${blank.map(p => esc(p.product.split(' —')[0])).join(', ')}. They are listed
      below so the gap is visible, but they contribute <b>nothing</b> to the
      totals, which are therefore a floor rather than your actual intake. A
      multivitamin and a B complex in particular overlap with almost every row
      here, so the stacked figures cannot be read as complete until those two
      labels are in.
    </div>` : ''}

    <div class="foot" style="margin-top:0"><h2>Against the published limits</h2>
    ${over.length ? `<div class="sp-warn sp-bad"><b>${over.length} nutrient${
      over.length === 1 ? ' is' : 's are'} over the Tolerable Upper Intake
      Level:</b> ${over.map(n => esc(n.nutrient)).join(', ')}. The UL is the
      highest chronic daily intake judged unlikely to pose a risk in the general
      population — it is not a diagnosis, and what it means for you is a question
      for the clinic that reads your panels.</div>` : ''}
    <div class="legend"><span><i class="sp-key sp-keyband"></i>RDA to ceiling</span>
      <span><i class="sp-key sp-keytick"></i>the two marks</span>
      <span><i class="sp-key sp-keyval"></i>what you take</span>
      <span><i class="sp-key sp-keyover"></i>past the ceiling</span></div>
    <div class="sp-tablewrap"><table class="sp-table">
      <thead><tr><th>Nutrient</th><th>Morning</th><th>Evening</th><th>Daily</th>
        <th>RDA</th><th>Ceiling (UL)</th><th>RDA · intake · ceiling</th></tr></thead>
      <tbody>${nutrients.map((n, i) => suppRow(n, i)).join('')}</tbody>
    </table></div>
    ${unknown.length ? `<div class="hint">No limits row for: ${
      unknown.map(esc).join(', ')} — these are counted but not compared. Add a
      row to <code>Data/nutrient-limits.csv</code> to give one a ceiling.</div>` : ''}
    <div class="hint">RDA is shown as female–male where the two differ; which
      applies to you is a clinical question, not one this file decides. Sources
      are in the <code>basis</code> column of
      <code>Data/nutrient-limits.csv</code>.</div>
    </div>

    <div class="foot"><h2>What goes in<em>${prods.length} products · click one for its label</em></h2>
    <div class="sp-cards">${prods.map(p => `<details class="sp-card${
        p.stated ? '' : ' sp-prov'}${p.blank ? ' sp-blank' : ''}">
      <summary>
        <h3>${esc(p.product)}</h3>
        <div class="sp-brand">${esc(p.brand)} · ${esc(p.form)}</div>
        <div class="sp-when">
          <span${p.morning ? '' : ' class="off"'}>am <b>${suppNum(p.morning)}</b></span>
          <span${p.evening ? '' : ' class="off"'}>pm <b>${suppNum(p.evening)}</b></span>
          ${p.every !== 1 ? `<span class="sp-cadence">/ <b>${suppNum(p.every)}</b>d</span>` : ''}
          <span class="sp-count${p.nutrients.length ? '' : ' off'}">${
            p.nutrients.length || 'no'} nutrient${p.nutrients.length === 1 ? '' : 's'}</span>
        </div>
      </summary>
      <ul class="sp-list">${p.nutrients.map(n =>
        `<li>${esc(n.nutrient)} <b>${suppNum(n.amount)} ${esc(n.unit)}</b>
          <i>per ${esc(p.form)}</i></li>`).join('') || '<li class="sp-none">no nutrients recorded</li>'}</ul>
      <p class="sp-basis">${esc(p.basis)}</p>
      ${p.url ? `<p class="sp-basis"><a href="${esc(p.url)}" target="_blank"
        rel="noopener noreferrer">The label ↗</a></p>` : ''}
    </details>`).join('')}</div></div>

    <div class="foot"><h2>What this page does not do</h2>
    <p class="sp-note">It does arithmetic against published reference values and
    stops there. It does not read your lab results, does not judge whether a dose
    is helping or harming you, and cannot see interactions with anything else you
    take. Those are for the clinician who orders your panels — what this gives
    you is the exact numbers to hand them.</p>
    <p class="sp-note"><b>Three things worth raising there, all factual.</b>
    <b>Biotin and your lab results:</b> above roughly 5&nbsp;mg/day biotin is
    documented to interfere with immunoassays, skewing a range of measured
    markers with nothing having changed in you (FDA safety communications, 2017
    and 2019). At 1000&nbsp;µg from the biotin tablets plus 21 from the
    multivitamin and 4.5 from the B complex, the total is about a fifth of that —
    under the line, and worth naming at the clinic anyway, because what it would
    affect is the assay rather than you.</p>
    <p class="sp-note"><b>Stacking is what this table is for.</b> Eight
    nutrients arrive from more than one product — vitamin D from three, biotin
    from three, B2 from three — and only the total is comparable to a ceiling.
    No single label here looks remarkable on its own, which is exactly why
    reading them one bottle at a time cannot answer the question.</p>
    <p class="sp-note"><b>Food is not counted here.</b> A row missing from the
    table means no <em>supplement</em> supplies it, not that you are not getting
    it. <b>Iron</b> is the only nutrient you named that nothing in this regimen
    carries — it has no row above at all, and food and lab results are the only
    things that can speak to it.</p>
    </div>`;
}

// Delegated, so the table can be redrawn by any route change without rebinding.
// A row and its detail are siblings rather than nested, because a <tr> cannot
// contain another <tr> and a table that fakes it stops being a table.
document.addEventListener('click', e => {
  const row = e.target.closest('[data-sup-row]');
  if (!row) return;
  const d = main.querySelector(`[data-sup-detail="${row.dataset.supRow}"]`);
  if (!d) return;
  d.hidden = !d.hidden;
  row.setAttribute('aria-expanded', String(!d.hidden));
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest && e.target.closest('[data-sup-row]');
  if (!row) return;
  e.preventDefault();
  row.click();
});
