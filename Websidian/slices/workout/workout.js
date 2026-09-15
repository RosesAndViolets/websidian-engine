/** The muscles the figures can show, in the order the rest list reads them. The
 *  keys are what `Data/workout.csv` writes in its `muscles` column, and
 *  `slices/workout/data.py` holds the same list so the build can report a name
 *  no figure will ever light up. */
const MUSCLE_NAME = {
  chest: 'Chest', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps',
  forearms: 'Forearms', abs: 'Abs', obliques: 'Obliques', traps: 'Traps',
  lats: 'Lats', 'lower back': 'Lower back', glutes: 'Glutes', quads: 'Quads',
  adductors: 'Adductors', hamstrings: 'Hamstrings', calves: 'Calves',
};

/** One figure, drawn twice. Each entry is [muscle key, tag, attributes]; an
 *  empty key is body rather than muscle — head, hands, knees — and stays grey
 *  whatever you trained. The skeleton is shared, so the front and back differ
 *  only in which muscles sit on it and cannot drift out of proportion.
 *
 *  Blocks, not anatomy: the job is telling abs from obliques at a glance, and a
 *  real écorché would be a thousand lines of path data to say the same thing.
 */
const BODY_BASE = [
  ['', 'circle', 'cx="100" cy="30" r="19"'],
  ['', 'rect', 'x="92" y="44" width="16" height="14" rx="6"'],
  // The torso sits under the muscle blocks and fills the seams between them,
  // which is what stops the figure reading as parts rather than a person.
  ['', 'rect', 'x="70" y="62" width="60" height="94" rx="20"'],
  ['', 'rect', 'x="74" y="148" width="52" height="26" rx="10"'],
  ['', 'ellipse', 'cx="50" cy="190" rx="7" ry="9"'],
  ['', 'ellipse', 'cx="150" cy="190" rx="7" ry="9"'],
  ['', 'ellipse', 'cx="87" cy="246" rx="11" ry="8"'],
  ['', 'ellipse', 'cx="113" cy="246" rx="11" ry="8"'],
  ['', 'ellipse', 'cx="87" cy="314" rx="10" ry="7"'],
  ['', 'ellipse', 'cx="113" cy="314" rx="10" ry="7"'],
];
const ARMS = m => [
  [m, 'rect', 'x="46" y="86" width="18" height="46" rx="9"'],
  [m, 'rect', 'x="136" y="86" width="18" height="46" rx="9"'],
  ['forearms', 'rect', 'x="42" y="136" width="16" height="46" rx="8"'],
  ['forearms', 'rect', 'x="142" y="136" width="16" height="46" rx="8"'],
];
const SHOULDERS = [
  ['shoulders', 'ellipse', 'cx="64" cy="76" rx="17" ry="12"'],
  ['shoulders', 'ellipse', 'cx="136" cy="76" rx="17" ry="12"'],
];
const FIGURES = {
  Front: [...BODY_BASE, ...SHOULDERS,
    ['chest', 'rect', 'x="73" y="66" width="25" height="28" rx="9"'],
    ['chest', 'rect', 'x="102" y="66" width="25" height="28" rx="9"'],
    ['obliques', 'rect', 'x="71" y="102" width="11" height="42" rx="5"'],
    ['obliques', 'rect', 'x="118" y="102" width="11" height="42" rx="5"'],
    ['abs', 'rect', 'x="84" y="98" width="32" height="48" rx="7"'],
    ...ARMS('biceps'),
    ['quads', 'rect', 'x="74" y="172" width="17" height="66" rx="8"'],
    ['quads', 'rect', 'x="109" y="172" width="17" height="66" rx="8"'],
    ['adductors', 'rect', 'x="91" y="178" width="9" height="56" rx="4"'],
    ['adductors', 'rect', 'x="100" y="178" width="9" height="56" rx="4"'],
    ['', 'rect', 'x="78" y="252" width="18" height="54" rx="9"'],
    ['', 'rect', 'x="104" y="252" width="18" height="54" rx="9"'],
  ],
  Back: [...BODY_BASE,
    ['traps', 'path', 'd="M78 56 L122 56 L136 84 L64 84 Z"'],
    ...SHOULDERS,
    ['lats', 'path', 'd="M69 86 L97 100 L93 140 L72 128 Z"'],
    ['lats', 'path', 'd="M131 86 L103 100 L107 140 L128 128 Z"'],
    ['lower back', 'rect', 'x="86" y="128" width="28" height="24" rx="7"'],
    ...ARMS('triceps'),
    ['glutes', 'rect', 'x="76" y="150" width="23" height="30" rx="13"'],
    ['glutes', 'rect', 'x="101" y="150" width="23" height="30" rx="13"'],
    ['hamstrings', 'rect', 'x="76" y="182" width="22" height="58" rx="11"'],
    ['hamstrings', 'rect', 'x="102" y="182" width="22" height="58" rx="11"'],
    ['calves', 'rect', 'x="78" y="252" width="18" height="52" rx="9"'],
    ['calves', 'rect', 'x="104" y="252" width="18" height="52" rx="9"'],
  ],
};

/** When each muscle was last worked, and with what. Computed in the browser
 *  rather than at build time for the reason any day count is: a number baked in
 *  at build is wrong by morning. */
function muscleState() {
  const now = Date.now();
  const out = {};
  (META.workout || []).forEach(r => {
    const t = Date.parse(r.when.replace(' ', 'T'));
    if (isNaN(t)) return;
    r.muscles.forEach(m => {
      if (!out[m] || t > out[m].t) out[m] = {t, effort: r.effort, exercise: r.exercise};
    });
  });
  Object.values(out).forEach(s => s.hours = (now - s.t) / 36e5);
  return out;
}

// Colour is recency and nothing else — effort is a word in the tooltip and the
// list, never a second thing the same colour has to carry.
const restLevel = h => h == null ? 0 : h < 24 ? 4 : h < 48 ? 3 : h < 96 ? 2 : h < 168 ? 1 : 0;
const ago = h => h == null ? 'never logged'
  : h < 1 ? 'just now'
  : h < 24 ? Math.round(h) + (Math.round(h) === 1 ? ' hour ago' : ' hours ago')
  : Math.round(h / 24) + (Math.round(h / 24) === 1 ? ' day ago' : ' days ago');

const REST_STEPS = [[4, 'today'], [3, '1–2 days'], [2, '3–4 days'], [1, '5–7 days'],
                    [0, 'longer · never']];

function bodyMap() {
  const state = muscleState();
  const figure = (label, parts) => `<figure class="fig">
    <svg viewBox="0 0 200 330" role="img" aria-label="${label} of the body,
         muscles shaded by how recently they were worked">
      ${parts.map(([m, tag, attrs]) => {
        if (!m) return `<${tag} ${attrs} class="body"/>`;
        const s = state[m];
        return `<${tag} ${attrs} class="mus l${restLevel(s && s.hours)}">
          <title>${esc(MUSCLE_NAME[m] || m)} — ${ago(s && s.hours)}${
            s && s.effort ? ' · ' + esc(s.effort) : ''}</title></${tag}>`;
      }).join('')}
    </svg><figcaption>${label}</figcaption></figure>`;
  return `<div class="figs">${Object.entries(FIGURES)
      .map(([label, parts]) => figure(label, parts)).join('')}</div>
    <div class="restkey">${REST_STEPS.map(([l, label]) =>
      `<span><i class="l${l}"></i>${label}</span>`).join('')}</div>`;
}

/** Longest since first: the diagram says what you trained, this says what you
 *  have not. Muscles with nothing on record sit at the bottom — they are a gap
 *  in the log as much as in the training, and mixing them into the ranking
 *  would put every untouched one above the leg day you actually skipped. */
function restList() {
  const state = muscleState();
  const keys = Object.keys(MUSCLE_NAME);
  const seen = keys.filter(m => state[m]).sort((a, b) => state[b].hours - state[a].hours);
  const never = keys.filter(m => !state[m]);
  const row = m => {
    const s = state[m];
    return `<div class="rest"><i class="l${restLevel(s && s.hours)}"></i>
      <b>${esc(MUSCLE_NAME[m])}</b>
      <span>${ago(s && s.hours)}${s && s.effort ? ' · ' + esc(s.effort) : ''}</span></div>`;
  };
  return seen.map(row).join('') + never.map(row).join('');
}

function workoutBlock() {
  const rows = META.workout || [];
  const unknown = META.workoutUnknown || [];
  const now = Date.now();
  const week = rows.filter(r => now - Date.parse(r.when.replace(' ', 'T')) < 7 * 864e5);
  const days = new Set(week.map(r => r.when.slice(0, 10)));
  const sets = week.reduce((s, r) => s + r.sets, 0);
  const mins = week.reduce((s, r) => s + r.minutes, 0);
  const hit = new Set(week.flatMap(r => r.muscles));
  // Newest first, and grouped into sessions — one evening is one row of the log
  // to read, however many exercises it took.
  const sessions = {};
  rows.forEach(r => (sessions[r.when] || (sessions[r.when] = [])).push(r));
  const recent = Object.entries(sessions).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8);

  return `<div class="bento">
    <div class="box s8"><h3>Body map<em>time since last worked</em></h3>
      ${bodyMap()}
      ${rows.length ? '' : `<div class="hint">Nothing logged yet — add rows to
        <code>Data/workout.csv</code>: <code>when,exercise,muscles,sets,reps,kg,effort</code>,
        muscles separated by <code>;</code>.</div>`}
      ${unknown.length ? `<div class="log">These muscle names are in the log but on no
        figure, so they colour nothing: ${unknown.map(esc).join(', ')}</div>` : ''}
    </div>
    <div class="box s4"><h3>Since last worked<em>longest first</em></h3>
      ${restList()}</div>
  </div>
  <div class="bento">
    <div class="box s4"><h3>This week</h3>
      <div class="tiles">
        <div class="tile"><b>${days.size}</b><span>days trained</span></div>
        <div class="tile"><b>${Math.round(sets)}</b><span>sets${
          mins ? ` · ${Math.round(mins)} min` : ''}</span></div>
        <div class="tile"><b>${hit.size}</b><span>of ${
          Object.keys(MUSCLE_NAME).length} muscles</span></div>
      </div></div>
    <div class="box s8"><h3>Recent sessions</h3>
      ${recent.length ? recent.map(([when, items]) => `<div class="act">
        <div class="act-h"><b>${esc(when.slice(0, 10))}</b>
          <span class="when">${when.length > 10 ? esc(when.slice(11, 16)) + ' · ' : ''}${
            Math.round(items.reduce((s, r) => s + r.sets, 0))} sets${
              items.some(r => r.minutes) ? ` · ${
                Math.round(items.reduce((s, r) => s + r.minutes, 0))} min` : ''}</span></div>
        ${items.map(r => `<div class="hint" style="margin-top:4px">${esc(r.exercise)}
          — ${r.sets ? `${r.sets} × ${r.reps}` : `${r.minutes} min`}${
            r.kg ? ` · ${r.kg} kg` : ''}${
            r.effort ? ` · ${esc(r.effort)}` : ''}
          <span class="when">${r.muscles.map(m =>
            esc(MUSCLE_NAME[m] || m)).join(' · ')}</span></div>`).join('')}
      </div>`).join('') : '<div class="stats" style="margin:0">No sessions on record.</div>'}
    </div>
  </div>`;
}
