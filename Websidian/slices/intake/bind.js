/** The record's own controls — the day picker, the sparkline, and a logged
 *  meal's edit/delete — shared by every view that carries On record: the
 *  Global Home board, the Diet page.
 *
 *  The composer that sits beside it is wired by `bindCaptures()` in
 *  `shell/compose.js`, because the Work page carries one too. Quick log's own
 *  popup is wired once, on `document`, in `slices/intake/quicklog.js` — it
 *  never needs rebinding here.
 *
 *  Re-rendering goes through route(), never home(): these handlers used to call
 *  home() directly, which meant clicking a bar on the Diet page threw you back
 *  to the Global Home. route() redraws whichever view you are actually on.
 */
function bindIntake() {
  const showDay = d => {
    intakeDay = d;
    route();
  };
  if ($('intakeday')) $('intakeday').onchange = e => showDay(e.target.value);
  const spark = main.querySelector('.spark');
  if (spark) spark.onclick = e => {
    const bar = e.target.closest('i[data-day]');
    if (bar) showDay(bar.dataset.day);
  };
  main.querySelectorAll('[data-editmeal]').forEach(b => b.onclick = () =>
    quickEdit(JSON.parse(b.dataset.editmeal)));
  // Arm-then-confirm rather than a native confirm(): a JS dialog blocks the
  // whole tab until dismissed, which this page never otherwise does anywhere.
  main.querySelectorAll('[data-delmeal]').forEach(b => {
    let armed = false, timer = null;
    b.onclick = async () => {
      if (!armed) {
        armed = true;
        b.textContent = 'sure?';
        timer = setTimeout(() => { armed = false; b.textContent = 'delete'; }, 3000);
        return;
      }
      clearTimeout(timer);
      b.textContent = '…';
      const r = await api('/api/intake/delete', {method: 'POST',
        body: b.dataset.delmeal}).catch(e => ({error: String(e)}));
      if (r.error) { armed = false; b.textContent = 'failed'; return; }
      location.reload();
    };
  });
}
