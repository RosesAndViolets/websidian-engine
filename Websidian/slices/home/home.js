/** The Global Home is a board of widgets, not a fixed dashboard.
 *
 *  WIDGETS is the registry — one line per widget, and the render function is
 *  the card a section already draws for itself, so a widget is a reuse rather
 *  than a second copy. What the user picked lives in localStorage.
 *
 *  The long term goals are not in the registry: they are the page's own
 *  furniture, always drawn, always pinned to the top whatever the board holds.
 */
const WIDGETS = {
  intake:   ['Daily intake',    intakeToday],
  record:   ['On record',       onRecord],
  activity: ['Recent activity', activitySection],
};

// A goal is a number you are counting toward, not a percentage to keep in sync
// by hand — progress is now/goal, so editing one number moves the bar.
// Empty by default; an instance adds its own, e.g.:
//   {label: 'Paying off the loan', now: 3, goal: 12, unit: 'months'}
const GOALS = [];

/** The saved board, cleaned once on the way in.
 *
 *  localStorage is a trust boundary: it outlives the code that wrote it. A
 *  widget dropped from WIDGETS — `goals` became permanent furniture and left
 *  the registry — was still in saved boards, and `WIDGETS[id][0]` threw inside
 *  the render, so the whole page came up blank rather than one card short.
 *  Filtering here covers every use; filtering at each use never does.
 */
function loadBoard() {
  try {
    const saved = JSON.parse(localStorage.getItem('board') || '[]');
    return Array.isArray(saved) ? saved.filter(id => WIDGETS[id]) : [];
  } catch { return []; }
}

let board = loadBoard();

function goalsWidget() {
  return `<div class="box"><h3>Long term goals<em>how far along</em></h3>
    ${GOALS.map(g => {
      const pct = Math.min(100, Math.round(g.now / g.goal * 100));
      return `<div class="act"><div class="act-h"><b>${esc(g.label)}</b>
          <span class="when">${g.now} / ${g.goal} ${esc(g.unit)} · ${pct}%</span></div>
        <div class="bar"><i style="width:${pct}%"></i></div></div>`;
    }).join('')}</div>`;
}

/** Add and remove, as chips beside a picker. Deliberately outside the cards:
 *  a widget renders the same markup here as it does on its own section. */
function boardBar() {
  const spare = Object.keys(WIDGETS).filter(id => !board.includes(id));
  return `<div class="row wbar">
    ${board.map(id => `<span class="pill">${esc(WIDGETS[id][0])}
      <b data-drop="${id}" title="Remove">×</b></span>`).join('')}
    ${spare.length ? `<select id="addw"><option value="">+ Add a widget</option>
      ${spare.map(id => `<option value="${id}">${esc(WIDGETS[id][0])}</option>`)
        .join('')}</select>` : ''}</div>`;
}

/** Pages that sit in `pages/` itself, as cards.
 *
 *  The folder is the section everywhere else, so a page in no folder belongs to
 *  the Global Home — no registry, no route, drop the file and it appears. Drawn
 *  with the card show() gives a sub-page, because that is what it is.
 */
function rootPages() {
  const ns = NOTES.filter(n => !n.category);
  if (!ns.length) return '';
  return `<div class="foot"><h2>Pages</h2><div class="cards">${ns.map(n =>
    `<a class="card" href="#/n/${encodeURIComponent(n.slug)}">
      <h3>${esc(n.title)}</h3><p>${esc(n.summary)}</p></a>`).join('')}</div></div>`;
}

function home() {
  // No <h1>: the goals are the top of this page, and a heading above them
  // would be the one thing that scrolls out from under the pinned card.
  main.innerHTML = `<div class="wrap wide">
    <div class="goals">${goalsWidget()}</div>
    <div class="bento" data-todo-host>${todoCard()}</div>
    ${boardBar()}
    ${board.length ? `<div class="bento">${board.map(id => WIDGETS[id][1]()).join('')}</div>` : ''}
    ${rootPages()}
    </div>`;

  bindCaptures();
  bindTodo();
  bindIntake();
  main.querySelectorAll('[data-drop]').forEach(b => b.onclick = () => {
    board = board.filter(id => id !== b.dataset.drop);
    localStorage.setItem('board', JSON.stringify(board));
    home();
  });
  if ($('addw')) $('addw').onchange = e => {
    if (!e.target.value) return;
    board.push(e.target.value);
    localStorage.setItem('board', JSON.stringify(board));
    home();
  };
}
