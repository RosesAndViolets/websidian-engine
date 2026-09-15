/** A box that writes what you type into a folder of the Inbox.
 *
 *  Two pages carry one — the diet log and the work log — and they differ only in
 *  the folder and the words around it, which is why this is one function rather
 *  than two composers drifting apart.
 *
 *  Nothing here processes anything. The capture lands in `Inbox/<folder>/` as a
 *  dated `.md` and waits for a session you start deliberately; the site captures
 *  and never interprets.
 */
const draftOf = folder => ({
  get: () => localStorage.getItem('draft:' + folder) || '',
  set: v => v ? localStorage.setItem('draft:' + folder, v)
              : localStorage.removeItem('draft:' + folder),
});

function captureBox({folder, title, blurb, placeholder, cls = 'box s5'}) {
  const waiting = staged.filter(f => f.startsWith(folder + '/'));
  return `<div class="${cls}"><h3>${esc(title)}</h3>
    <div class="stats" style="margin-bottom:0">${blurb}</div>
    ${online ? `<textarea class="compose" data-capture="${esc(folder)}"
        style="min-height:84px;margin-top:12px"
        placeholder="${esc(placeholder)}">${esc(draftOf(folder).get())}</textarea>
      <div class="row">
        <button class="btn" data-capture-save="${esc(folder)}">Save to Inbox</button>
        <span class="hint" data-capture-msg="${esc(folder)}"></span>
      </div>`
    // A silent dead button is exactly what a file:// open used to look like.
    : readonlyNotice('save to')}
    ${waiting.length ? `<div class="hint" style="margin-top:14px">Staged in
        <code>Inbox/${esc(folder)}/</code></div>
      <ul class="todo">${waiting.map(f =>
        `<li>${esc(f.slice(folder.length + 1).replace(/\.md$/, ''))}</li>`).join('')}</ul>` : ''}
  </div>`;
}

/** Every box on the page, wired by its folder.
 *
 *  The draft is held on each keystroke, so leaving the page mid-sentence costs
 *  nothing, and cleared only once the text is safely a file in the Inbox.
 */
function bindCaptures() {
  main.querySelectorAll('[data-capture]').forEach(t => {
    const folder = t.dataset.capture, d = draftOf(folder);
    const msg = main.querySelector(`[data-capture-msg="${folder}"]`);
    const send = async () => {
      if (!t.value.trim()) {
        return void (msg.textContent = 'Nothing to save — write something first.');
      }
      msg.textContent = 'Saving…';
      // A rejected POST used to vanish: api() resolves, nothing reads the error.
      const r = await api('/api/note', {method: 'POST',
        body: JSON.stringify({text: t.value, folder, ext: 'md'})})
        .catch(e => ({error: String(e)}));
      if (r.error) return void (msg.textContent = 'Could not save — ' + r.error);
      t.value = '';
      d.set('');
      pollInbox().then(route);   // re-render for the waiting list; no full reload
    };
    t.oninput = () => d.set(t.value);
    t.onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); };
    const btn = main.querySelector(`[data-capture-save="${folder}"]`);
    if (btn) btn.onclick = send;
  });
}
