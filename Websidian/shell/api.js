let online = false, staged = [];
const api = (path, opts) => fetch(path, opts).then(r => r.json());
const $ = id => document.getElementById(id);

let folders = [];

async function pollInbox() {
  try {
    const r = await api('/api/inbox');
    staged = r.files;
    folders = r.folders || [];
    online = true;
  } catch { staged = []; folders = []; online = false; }
  capn.textContent = staged.length || '';
  // The panel is page lists now, not the Inbox, so this no longer redraws a
  // staged file into view — it is kept because `mark()` at the end of sidebar()
  // is what re-lights the current row, and a capture saved from a todo can
  // change which page you are standing on.
  sidebar(q.value);
  return staged;
}

