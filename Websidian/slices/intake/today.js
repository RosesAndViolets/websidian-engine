/** The dashboard's diet card: today's numbers only. The composer and the record
 *  live at #/diet, so the dashboard stays a glance rather than a workspace. */
function intakeToday() {
  const rows = META.intake || [], d = today();
  const mine = rows.filter(e => (e.when || '').startsWith(d));
  const sum = k => mine.reduce((s, e) => s + (e[k] || 0), 0);
  const T = META.targets || {};
  const waiting = staged.filter(f => f.startsWith('Intake/')).length;
  const cell = (label, key, unit) => {
    const v = sum(key), t = T[key] || 0, over = t && v > t;
    return `<div class="meter${over ? ' over' : ''}">
      <div class="mrow"><span>${label}</span></div>
      <div class="mval"><b>${v}</b><span>${unit}${t ? ' / ' + t : ''}</span></div>
      <div class="bar"><i style="width:${t ? Math.min(100, v / t * 100) : 0}%"></i></div>
    </div>`;
  };
  return `<div class="box s5"><h3>Diet<em>today</em></h3>
    <div class="macros">${cell('Calories', 'kcal', 'kcal')}${cell('Protein', 'protein', 'g')}
      ${cell('Carbs', 'carbs', 'g')}</div>
    <div class="row"><a class="btn go" href="#/diet">Open the diet log</a>
      ${waiting ? `<span class="hint">${waiting} waiting to be processed</span>` : ''}</div>
  </div>`;
}
