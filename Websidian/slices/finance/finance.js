/** Finance: what came in, what went out, and how much of it is believable.
 *
 *  The order is deliberate and it is not the order a budgeting app uses. The
 *  first thing on the page is coverage, because every number under it is
 *  conditional on which accounts were reporting that month — and a low month
 *  that was really an unlinked month is the one error here that looks exactly
 *  like a finding. Everything else is a total, and a total is only worth
 *  reading once you know what it is a total *of*.
 */
const FIN_CLASS = ['necessity', 'luxury', 'investment', 'uncategorised'];

const yen = n => (n < 0 ? '−¥' : '¥') + Math.abs(Math.round(n)).toLocaleString('en-US');

// A month label short enough to sit under a bar: 2026-04 -> Apr, and the year
// only where it turns over, so the axis reads as a year rather than as 19 dates.
function finMonth(m, prev) {
  const [y, mm] = m.split('-');
  const name = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
                'Oct', 'Nov', 'Dec'][+mm - 1];
  return (!prev || prev.split('-')[0] !== y) ? `${name}<i>${y}</i>` : name;
}

// Which month's detail is open under the chart, or null. Module state rather
// than a hash route, the same call `intakeDay` makes: it is a selection inside
// one page, and putting it in the URL would make Back walk through every bar
// you clicked instead of leaving the page.
let finPick = null;

const finTotal = (fin, m) =>
  FIN_CLASS.reduce((s, k) => s + (fin.monthly[m][k] || 0), 0);

/** The hover card: the month, its total, and the split as percentages.
 *
 *  **Not a `title`.** That was the first version and it was the right size of
 *  solution for the wrong constraint: the browser's own tooltip waits about a
 *  second before it appears, the delay belongs to the OS and no attribute
 *  changes it, and a chart you have to hold still on is a chart nobody hovers
 *  twice. So one element, moved to the cursor — which also buys the class
 *  swatches, since the thing being read is a colour split and `title` can only
 *  ever be text.
 *
 *  The markup goes in `data-tip` and is written straight into the card, so a
 *  merchant name is escaped on the way *in* — see `finMedCell`.
 */
function finTip(fin, m) {
  const t = finTotal(fin, m);
  return `<b>${esc(m)}</b><u>${yen(t)}</u>`
    + FIN_CLASS.filter(k => fin.monthly[m][k]).map(k =>
      `<span><i class="c-${k}"></i>${k}<em>${
        Math.round(fin.monthly[m][k] / t * 100)}%</em></span>`).join('')
    + `<span class="fin-tip-go">Click for every charge</span>`;
}

/** The one hover card on the page, parked on `<body>`.
 *
 *  On body rather than inside the chart because `main.innerHTML` is rewritten
 *  on every route and anything living in there would be thrown away mid-hover;
 *  fixed to the viewport rather than absolute because a card two thirds of the
 *  way down a scrolling pane must not be clipped by the box it belongs to.
 */
function finTipEl() {
  let el = document.getElementById('fintip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fintip';
    document.body.appendChild(el);
  }
  return el;
}

/** Follow the cursor, and turn back before going off the right or bottom edge.
 *
 *  Measured after the content is set, never guessed: the card is as tall as the
 *  month has classes and as wide as the longest rail name, and a fixed offset
 *  would push the last column's card off screen on exactly the months worth
 *  looking at.
 */
function finTipAt(el, e) {
  el.style.left = el.style.top = '0px';        // measure unconstrained
  const w = el.offsetWidth, h = el.offsetHeight, pad = 14;
  el.style.left = Math.max(4, e.clientX + pad + w > innerWidth
    ? e.clientX - pad - w : e.clientX + pad) + 'px';
  el.style.top = Math.max(4, e.clientY + pad + h > innerHeight
    ? e.clientY - pad - h : e.clientY + pad) + 'px';
}

/** The stacked monthly column chart, over covered months only.
 *
 *  Uncovered months are not drawn short — they are not drawn at all, and the
 *  card says how many were left out. Drawing them at their real height would
 *  put a plausible-looking ¥3,000 January next to a ¥180,000 April and invite
 *  exactly the wrong conclusion.
 */
function finChart(fin) {
  const months = fin.covered;
  if (!months.length) return '<div class="hint">No month has complete coverage yet.</div>';
  const peak = Math.max(...months.map(m => finTotal(fin, m))) || 1;
  return `<div class="fin-chart">
    ${months.map((m, i) => {
      const t = finTotal(fin, m);
      const parts = FIN_CLASS.filter(k => fin.monthly[m][k])
        .map(k => `<i class="c-${k}" style="height:${fin.monthly[m][k] / t * 100}%"></i>`)
        .join('');
      return `<div class="fin-col${finPick === m ? ' sel' : ''}" data-month="${m}"
        data-tip="${esc(finTip(fin, m))}">
        <div class="fin-stack" style="height:${t / peak * 100}%">${parts}</div>
        <span>${finMonth(m, months[i - 1])}</span>
      </div>`;
    }).join('')}
  </div>
  <div class="restkey">${FIN_CLASS.map(k =>
    `<span><i class="c-${k}"></i>${k}</span>`).join('')}</div>`;
}

/** One month, opened by clicking its column: what added up to that bar.
 *
 *  The rows are every row of the month including the ones no total counts —
 *  greyed, with why. Hiding them is what makes a month look like it is missing
 *  something you can no longer find, which is the opposite of what somebody
 *  reconciling against a bank app needs.
 */
function finDetail(fin, m) {
  const t = finTotal(fin, m);
  const tx = (fin.tx || []).filter(r => r.date.slice(0, 7) === m && r.amount < 0)
    .sort((a, b) => a.amount - b.amount);
  const med = fin.medium[m] || {};
  return `<div class="bento"><div class="box s12 fin-detail">
    <h3>${esc(m)}<em>${yen(t)} counted · ${tx.length} charges</em>
      <button class="fin-close" data-close>Close</button></h3>
    <div class="fin-split">
      ${FIN_CLASS.filter(k => fin.monthly[m][k]).map(k => `<div class="rest">
        <b><i class="c-${k}"></i>${esc(k)}</b>
        <div class="bar" style="flex:2;margin:0"><i class="c-${k}"
          style="width:${fin.monthly[m][k] / t * 100}%"></i></div>
        <span>${yen(fin.monthly[m][k])} · ${Math.round(
          fin.monthly[m][k] / t * 100)}%</span></div>`).join('')}
    </div>
    <h4>By medium</h4>
    <div class="fin-split">
      ${Object.entries(med).sort((a, b) => b[1].charged - a[1].charged)
        .map(([a, v]) => `<div class="rest">
        <b>${esc(a)}</b>
        <span>${v.n} ${v.n === 1 ? 'charge' : 'charges'} · ${yen(v.charged)} charged${
          v.charged !== v.counted ? ` · ${yen(v.counted)} counted` : ''}</span>
        </div>`).join('')}
    </div>
    <h4>Every charge<em>biggest first</em></h4>
    <div class="fin-tx">
      ${tx.map(r => `<div class="fin-t${r.on ? '' : ' off'}">
        <i>${esc(r.date.slice(8))}</i>
        <b>${esc(r.merchant)}</b>
        <u>${esc(r.account)}</u>
        <em>${esc(r.bucket)}</em>
        <span>${yen(r.amount)}</span></div>`).join('')}
    </div>
    <div class="fin-note">A greyed row is charged but not counted, and there are
      two ways that happens. <b>It is money you moved rather than spent</b> — an
      ATM withdrawal leaves the bank and arrives in a wallet, a card bill leaves
      the bank and settles the card; it becomes spending where it is spent. Or
      <b>Money Forward already has it counted elsewhere</b> — the same Amazon
      order arriving itemised from Amazon's own history, where counting both
      sides is how one purchase becomes two.</div>
  </div></div>`;
}

/** Spending by medium: the number to compare against the app that issued it.
 *
 *  **Charged is the column, not counted.** Every other figure on this site is
 *  the counted one, and it is the right number for "what did I spend" — but it
 *  is the wrong number to hold up against your card issuer's app, which knows
 *  nothing about Money Forward's matching and will show you every charge. So
 *  the cell is what the rail was charged, and the ones where the two disagree
 *  are marked; hover gives both.
 */
function finMedium(fin) {
  const months = Object.keys(fin.medium);
  if (!months.length) return '<div class="hint">No spending on any rail yet.</div>';
  const cols = fin.rails;
  // The rail name is data, so it is escaped here — before the whole card is
  // escaped again into the attribute. Once on the way in, once on the way out.
  const cell = (m, a) => {
    const v = (fin.medium[m] || {})[a];
    if (!v) return '<td></td>';
    const tip = `<b>${esc(a)}</b><u>${esc(m)}</u>`
      + `<span>charged<em>${yen(v.charged)}</em></span>`
      + `<span>counted here<em>${yen(v.counted)}</em></span>`
      + (v.moved ? `<span class="fin-tip-go">${yen(v.moved)} moved, not
          spent</span>` : '')
      + (v.elsewhere ? `<span class="fin-tip-go">${yen(v.elsewhere)} already
          counted elsewhere</span>` : '')
      + `<span class="fin-tip-go">${v.n} ${v.n === 1 ? 'charge' : 'charges'}</span>`;
    return `<td class="${v.charged === v.counted ? '' : 'gap'}"
      data-tip="${esc(tip)}">${
      Math.round(v.charged).toLocaleString('en-US')}</td>`;
  };
  return `<div class="fin-scroll"><table class="fin-med">
    <thead><tr><th>month</th>${cols.map(a => `<th>${esc(a)}</th>`).join('')}
      <th>charged</th></tr></thead>
    <tbody>${months.map(m => {
      const row = fin.medium[m];
      const tot = Object.values(row).reduce((s, v) => s + v.charged, 0);
      return `<tr${fin.covered.includes(m) ? '' : ' class="out"'}>
        <th>${esc(m)}</th>${cols.map(a => cell(m, a)).join('')}
        <td><b>${Math.round(tot).toLocaleString('en-US')}</b></td></tr>`;
    }).join('')}</tbody>
  </table></div>
  <div class="hint">Yen charged on each rail, newest first — the figure the
    issuing app will show you. A <span class="gap">marked</span> cell is one
    where this site counts less than was charged, for one of two reasons: part
    of it was <b>moved rather than spent</b> — an ATM withdrawal is charged to
    the bank and only becomes spending when the cash is — or Money Forward
    already has it <b>counted elsewhere</b>, which is what it says about a card
    charge whose purchase arrives itemised from the shop. Hover for both figures
    and which reason applies. A greyed row is a month before
    ${esc(fin.primary)} was reporting. Rows are dated by the transaction, not by
    a billing cycle, so a credit card statement closing mid-month will not line
    up month for month. <b>Amazon.co.jp is an order history, not a payment
    rail</b> — those purchases were charged to a card, and they appear here
    rather than in the card's counted figure because itemised is the more useful
    of the two records.</div>`;
}

/** Which accounts were reporting, month by month.
 *
 *  This is the card that makes the rest of the page honest, so it is a strip
 *  rather than a sentence: the eye catches the month the row goes thin without
 *  reading anything.
 */
function finCoverage(fin) {
  const months = Object.keys(fin.coverage);
  const most = Math.max(...months.map(m => fin.coverage[m].accounts.length), 1);
  return `<div class="fin-cov">
    ${months.map(m => {
      const c = fin.coverage[m];
      return `<div class="fin-cv${c.full ? '' : ' out'}"
        title="${m} — ${c.accounts.join(', ') || 'nothing'}${c.full ? '' : ' (no ' + fin.primary + ')'}"
        style="height:${Math.max(c.accounts.length / most * 100, 8)}%"></div>`;
    }).join('')}
  </div>
  <div class="hint">${months[0]} – ${months[months.length - 1]} ·
    <b>${fin.covered.length}</b> of ${months.length} months have
    ${esc(fin.primary)} reporting. Everything before
    <b>${fin.covered[0] || '—'}</b> is Amazon order history alone, which is a
    shopping list rather than a record of spending.</div>`;
}

/** Income only exists where a bank was linked, so it gets its own window. */
function finIncome(fin) {
  const months = fin.earning;
  if (!months.length) {
    return `<div class="hint">No month has a bank account reporting, so nothing
      about income can be said from this data.</div>`;
  }
  const rows = (fin.buckets.income || []).filter(([, v]) => v > 0);
  const total = rows.reduce((s, [, v]) => s + v, 0);
  return `<div class="tiles yen">
    <div class="tile"><b>${yen(total)}</b><span>received, ${months.length} months</span></div>
    <div class="tile"><b>${yen(total / months.length)}</b><span>per month</span></div>
  </div>
  <div style="margin-top:12px">${rows.map(([b, v]) => `<div class="rest">
    <b>${esc(b)}</b><span>${yen(v)}</span></div>`).join('')}</div>
  <div class="fin-note">Salary is <b>net of rent</b> — the company pays it and
    subtracts it before payment, so it never appears as either income or
    spending. Income is shown for ${months[0]} – ${months[months.length - 1]},
    the months a bank account was reporting.</div>`;
}

/** Buckets inside one class, as a page of their own (Necessity, Luxury). */
function financeClass(cls) {
  const fin = META.finance || {};
  const rows = fin.buckets && fin.buckets[cls] || [];
  if (!rows.length) return '<div class="hint">Nothing in this class yet.</div>';
  const total = rows.reduce((s, [, v]) => s + v, 0);
  const months = fin.covered.length || 1;
  return `<div class="bento"><div class="box s4">
    <h3>Total<em>${months} months</em></h3>
    <div class="tiles yen">
      <div class="tile"><b>${yen(total)}</b><span>${esc(cls)}</span></div>
      <div class="tile"><b>${yen(total / months)}</b><span>per month</span></div>
    </div>
  </div>
  <div class="box s8"><h3>Where it went<em>biggest first</em></h3>
    ${rows.map(([b, v]) => `<div class="rest">
      <b>${esc(b)}</b>
      <div class="bar" style="flex:2;margin:0"><i style="width:${v / rows[0][1] * 100}%"></i></div>
      <span>${yen(v)}</span></div>`).join('')}
  </div></div>`;
}

const financeNecessity = () => financeClass('necessity');
const financeLuxury = () => financeClass('luxury');

/** Goals: what the money is for, and whether the record says it is reachable.
 *
 *  **A goal with no price is the normal case, not a broken row.** Three of
 *  these cannot be priced until somebody can phone a clinic in Korea, and the
 *  useful thing to show there is not a 0% bar — it is the sentence saying what
 *  has to happen before the number can exist. So a card without a cost draws no
 *  bar at all and prints its blocker where the bar would be.
 */
function goalCard(g) {
  const pct = g.cost ? Math.min(100, Math.round(g.saved / g.cost * 100)) : 0;
  const eta = g.months
    ? `${g.months} ${g.months === 1 ? 'month' : 'months'} · ${g.eta}`
    : g.cost ? 'no surplus to fund it' : '';
  return `<div class="fin-goal k-${esc(g.status)}">
    <div class="act-h"><b>${esc(g.goal)}</b>
      <span class="when">${esc(g.kind)} · ${esc(g.status)}${
        g.by ? ' · by ' + esc(g.by) : ''}</span></div>
    ${g.cost ? `<div class="bar${g.estimate ? ' est' : ''}">
        <i style="width:${pct}%"></i></div>
      <div class="fin-goal-n"><span>${yen(g.saved)} of ${yen(g.cost)}${
        g.estimate ? ' <i>estimate</i>' : ''}</span>
        <span class="${g.late ? 'late' : ''}">${esc(eta)}</span></div>`
    : g.blocked ? `<div class="fin-goal-n"><span class="blocked">${
        esc(g.blocked)}</span></div>`
    // A rate is not a thing with a price, so "no price yet" would be reporting
    // a gap that is not one. Its own monthly line below says what it is.
    : g.kind === 'saving' ? ''
    : `<div class="fin-goal-n"><span class="blocked">no price yet</span></div>`}
    ${g.monthly ? `<div class="fin-goal-n"><span>${yen(g.monthly)} a month${
      g.status === 'active' ? ', committed' : ' if it starts'}</span></div>` : ''}
    <p>${esc(g.note)}</p>
  </div>`;
}

function financeGoals() {
  const fin = META.finance || {}, g = fin.goals;
  if (!g || !g.rows.length) {
    return `<div class="hint">Nothing in <code>Data/goals.csv</code> yet.</div>`;
  }
  const c = g.capacity, n = c.months.length;
  if (!n) {
    return `<div class="hint">No month has both a bank and the card reporting,
      so there is no surplus to project any of these against.</div>`;
  }
  const priced = g.rows.filter(r => r.cost).length;
  // Half the strip's height is one side of the zero line, so a full-scale month
  // fills its half and no bar can cross into the other one's territory.
  const scale = Math.max(Math.abs(c.worst), c.best, 1);
  const down = c.per.filter(m => m.net < 0).length;
  return `<div class="bento">
    <div class="box s4"><h3>What a month leaves<em>${n} months, ${
      c.months[0]}–${c.months[n - 1]}</em></h3>
      <div class="tiles yen">
        <div class="tile"><b>${yen(c.surplus)}</b><span>surplus, average</span></div>
        <div class="tile${c.worst < 0 ? ' warn' : ''}"><b>${yen(c.worst)}</b>
          <span>worst of the ${n}</span></div>
      </div>
      <div class="fin-spread">${c.per.map(m => `<i class="${m.net < 0 ? 'neg' : ''}"
        style="--h:${Math.abs(m.net) / scale * 50}%"
        title="${m.month} — in ${yen(m.in)}, out ${yen(m.out)}, net ${yen(m.net)}"></i>`)
        .join('')}</div>
      <div class="hint">In ${yen(c.income)}, out ${yen(c.spend)}${
        g.committed ? `, ${yen(g.committed)} already committed — ${yen(g.spare)}
        spare` : ''}. ${down ? `${down} of these ${n} months went backwards, so`
        : 'So'} the average is a shape rather than a monthly allowance. Income
        here is salary <b>and</b> the remittance; see the Income card on
        <a href="#/n/finance%2Findex">Finance Home</a> for the split.</div>
    </div>
    <div class="box s8"><h3>Goals<em>${g.rows.length}, ${priced} with a price</em></h3>
      ${g.rows.map(goalCard).join('')}
      <div class="fin-note">A goal with no instalment plan of its own is dated
        as if the <b>whole</b> spare went to it, so two of them will quote the
        same month and cannot both be true. Prices are in yen; a figure quoted
        in won was converted once, at the rate its note names, and is not
        tracked after that.</div>
    </div>
  </div>`;
}

/** The weekly review: the one part of this page a person writes.
 *
 *  Everything else here is arithmetic over the log and is right by construction.
 *  Whether a monthly surplus that swung from deep negative to solidly positive
 *  over a few months can carry a large planned purchase is a judgement, and it
 *  is stored as what it is — dated prose, newest first, with the older ones
 *  kept so a review that said "wait and see" three weeks running is visible
 *  as such.
 */
function financeReview() {
  const list = (META.finance || {}).reviews || [];
  if (!list.length) {
    return `<div class="hint">No review yet. Ask a session for one — it reads
      the same numbers this page draws and writes
      <code>Data/finance-reviews/YYYY-MM-DD.html</code>.</div>`;
  }
  const [now, ...past] = list;
  const age = daysBetween(now.date, today());
  return `<div class="box"><h3>This week's read<em>${esc(now.date)} · ${
      age === 0 ? 'today' : age + ' days ago'}${age > 10 ? ' — stale' : ''}</em></h3>
    <div class="fin-review">${now.html}</div>
    ${past.length ? `<details class="fin-past"><summary>${past.length} earlier
      ${past.length === 1 ? 'review' : 'reviews'}</summary>
      ${past.map(r => `<div class="fin-review"><h4>${esc(r.date)}</h4>${r.html}</div>`)
        .join('')}</details>` : ''}
  </div>`;
}

/** Finance Home. */
function financeBlock() {
  const fin = META.finance || {};
  if (!fin.rows) {
    return `<div class="stats">No spending data. Import a Money Forward export with
      <code>python3 slices/finance/tospend.py ~/Downloads/収入・支出詳細_*.csv</code>.</div>`;
  }
  const months = fin.covered.length || 1;
  const spent = FIN_CLASS.reduce((s, k) =>
    s + fin.covered.reduce((a, m) => a + (fin.monthly[m][k] || 0), 0), 0);
  const c = fin.classified, believable = c.rule + c.mf + c.none || 1;
  const target = (META.targets || {})['spend-monthly'];
  const perMonth = spent / months;

  return `<div class="bento">
    <div class="box s8"><h3>Spending<em>covered months only · click a month</em></h3>
      ${finChart(fin)}
    </div>
    <div class="box s4"><h3>Per month<em>${months} months</em></h3>
      <div class="tiles yen">
        <div class="tile"><b>${yen(perMonth)}</b><span>average out</span></div>
        ${target ? `<div class="tile${perMonth > target ? ' warn' : ''}">
          <b>${yen(target)}</b><span>target</span></div>` : ''}
      </div>
      ${target ? `<div class="bar"><i style="width:${
        Math.min(perMonth / target * 100, 100)}%"></i></div>
        <div class="hint">${perMonth > target
          ? `${yen(perMonth - target)} over, on average.`
          : `${yen(target - perMonth)} under, on average.`}</div>`
        : `<div class="hint">Set a monthly ceiling by adding a
           <code>spend-monthly</code> row to <code>Data/targets.csv</code>.</div>`}
    </div>
  </div>

  ${finPick && fin.monthly[finPick] ? finDetail(fin, finPick) : ''}

  <div class="bento">
    <div class="box s7"><h3>Coverage<em>accounts reporting</em></h3>
      ${finCoverage(fin)}
    </div>
    <div class="box s5"><h3>How it was categorised<em>of money out</em></h3>
      <div class="fin-tiers">
        ${[['rule', 'a rule matched'], ['mf', 'inherited from Money Forward'],
           ['none', 'uncategorised']].map(([k, label]) => `<div class="rest">
          <b>${esc(label)}</b>
          <div class="bar" style="flex:2;margin:0"><i class="t-${k}"
            style="width:${c[k] / believable * 100}%"></i></div>
          <span>${Math.round(c[k] / believable * 100)}%</span></div>`).join('')}
      </div>
      <div class="hint">Inherited rows carry Money Forward's own guess, made
        from the merchant name when nothing else was known. Most of this history
        was bulk imported from card statements, so treat that share as a shape
        rather than a number.</div>
      ${fin.unclassified.length ? `<div class="fin-note">Biggest merchants no rule
        names — add a row to <code>Data/spend-categories.csv</code>:<br>
        ${fin.unclassified.slice(0, 6).map(([m, v]) =>
          `${esc(m)} <b>${yen(v)}</b>`).join(' · ')}</div>` : ''}
    </div>
  </div>

  <div class="bento">
    <div class="box s6"><h3>Income<em>bank months only</em></h3>${finIncome(fin)}</div>
    <div class="box s6"><h3>Fixed spending<em>months seen</em></h3>
      ${fin.fixed.length ? fin.fixed.map(f => `<div class="rest">
        <b>${esc(f.bucket)}</b>
        <span>${f.months} ${f.months === 1 ? 'month' : 'months'} · ${yen(f.total)}</span>
        </div>`).join('') : '<div class="hint">Nothing marked fixed.</div>'}
      <div class="fin-note">Rent is absent by design: the company pays it and deducts
        it from salary, so it never crosses an account. Anything billed on a
        rail that was not yet linked is missing too — check Coverage above
        before reading a month as cheap.</div>
    </div>
  </div>

  <div class="bento"><div class="box s12">
    <h3>By medium<em>what each rail was charged</em></h3>
    ${finMedium(fin)}
  </div></div>`;
}

/** Clicking a month opens it, clicking it again closes it.
 *
 *  Through route() rather than a re-render of this block, the same call
 *  `bindIntake()` makes: the chart is a slice and can be dropped on any page,
 *  so it must redraw whichever view is actually showing rather than assume it
 *  is on Finance Home.
 */
function bindFinance() {
  const chart = main.querySelector('.fin-chart');
  if (chart) chart.onclick = e => {
    const col = e.target.closest('[data-month]');
    if (!col) return;
    finPick = finPick === col.dataset.month ? null : col.dataset.month;
    route();
  };
  const close = main.querySelector('[data-close]');
  if (close) close.onclick = () => { finPick = null; route(); };

  // Bound per container rather than on `main`: only two things on the site
  // carry a hover card, and a mousemove listener over the whole pane would run
  // on every page for the sake of these two.
  const tip = finTipEl();
  const hide = () => tip.classList.remove('on');
  main.querySelectorAll('.fin-chart,.fin-med').forEach(box => {
    box.onmousemove = e => {
      const el = e.target.closest('[data-tip]');
      if (!el) return hide();
      // Rewritten only when the cell changes — otherwise every pixel of travel
      // across one column reparses the same markup.
      if (tip.dataset.of !== el.dataset.tip) {
        tip.dataset.of = el.dataset.tip;
        tip.innerHTML = el.dataset.tip;
      }
      tip.classList.add('on');
      finTipAt(tip, e);
    };
    box.onmouseleave = hide;
  });
  // A route change can take the chart out from under a shown card, and
  // `onmouseleave` never fires on an element that no longer exists.
  if (!main.querySelector('[data-tip]')) hide();
}
