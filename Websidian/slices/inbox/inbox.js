/** Nested {dirs, files} from flat "a/b/file.txt" paths, so empty folders survive. */
function inboxTree() {
  const root = {dirs: {}, files: []};
  const dir = path => path.split('/').filter(Boolean)
    .reduce((n, part) => (n.dirs[part] = n.dirs[part] || {dirs: {}, files: []}), root);
  folders.forEach(f => dir(f));
  staged.forEach(f => {
    const cut = f.lastIndexOf('/');
    (cut < 0 ? root : dir(f.slice(0, cut))).files.push(f);
  });
  return root;
}

const inboxCount = n => n.files.length +
  Object.values(n.dirs).reduce((s, d) => s + inboxCount(d), 0);

// What the page can show inline. Everything else gets a link — a .zip or a
// .docx has no useful rendering here, and pretending otherwise is worse than
// saying so.
const STAGED_IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const STAGED_TEXT = /\.(md|txt|csv|json|log|ya?ml|html?|css|js|py|sh|tsv)$/i;

/** One staged file, read straight from the Inbox. Reuses `article`'s prose
 *  styling, so a pasted screenshot and a captured note both land looking like
 *  the rest of the site rather than like a download. */
async function stagedPage(path) {
  const url = '/api/staged?path=' + encodeURIComponent(path);
  const cut = path.lastIndexOf('/');
  main.innerHTML = `<div class="wrap">
    <h1>${esc(path.slice(cut + 1))}</h1>
    <div class="meta"><span class="badge">Inbox${cut < 0 ? '' : '/' + esc(path.slice(0, cut))}</span>
      <span class="hint">staged, not yet processed</span></div>
    <article id="staged"></article>
    <div class="row" style="margin-top:34px">
      <a class="btn" href="#/inbox">Re-file or remove it</a></div></div>`;
  main.scrollTop = 0;

  const box = $('staged');
  if (!online) return void (box.innerHTML = readonlyNotice('read it from'));
  if (STAGED_IMAGE.test(path)) {
    box.innerHTML = `<img src="${url}" alt="${esc(path)}">`;
  } else if (STAGED_TEXT.test(path)) {
    // .ok matters: the guard replies with JSON on a bad path, and printing that
    // as the file's contents would look like the file said it.
    const r = await fetch(url);
    box.innerHTML = r.ok ? `<pre>${esc(await r.text())}</pre>`
      : `<p class="hint">Could not read that file — it may have been moved.</p>`;
  } else {
    box.innerHTML = `<p class="hint">No inline view for this format.
      <a href="${url}" target="_blank" rel="noopener">Open it in a new tab →</a></p>`;
  }
}

function movePicker(path) {
  const here = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const opt = (v, label) =>
    `<option value="${esc(v)}"${v === here ? ' selected' : ''}>${esc(label)}</option>`;
  return `<select class="mv" data-from="${esc(path)}" title="Move to folder">
    ${opt('', 'Inbox root')}${folders.map(f => opt(f, f)).join('')}
    <option value="::new">New folder…</option></select>`;
}

function treeHtml(node, name, depth) {
  const count = inboxCount;
  const kids = Object.entries(node.dirs).sort((a, b) => a[0].localeCompare(b[0]));
  const files = node.files.map(f => `<li class="f">
      <span class="nm">${esc(f.split('/').pop())}</span>
      ${movePicker(f)}
      <button data-unstage="${esc(f)}" title="Remove">✕</button></li>`).join('');
  // Files before folders at every level: a folder header followed by files that
  // are not in it reads as if they were.
  const inner = `<ul class="tree">${files}${kids.map(([k, v]) =>
      treeHtml(v, k, depth + 1)).join('')}</ul>`;
  if (depth === 0) return `<div class="dh-row"><span class="nm">Inbox/</span>
    <span class="when">${count(node) || 'empty'}</span></div>${inner}`;
  return `<li class="d"><div class="dh-row"><span class="nm">${esc(name)}/</span>
    <span class="when">${count(node) || 'empty'}</span></div>${inner}</li>`;
}

function inboxPage() {
  main.innerHTML = `<div class="wrap">
    <h1>Write &amp; drop</h1>
    <div class="stats">Everything here lands in <code>Inbox/</code>, shared by both
      applications. The subfolder decides who gets it: <code>Intake/</code> becomes rows in
      the diet log, <code>Design Library/</code> becomes style records, anything else
      becomes a page.</div>
    ${online ? '' : readonlyNotice('write to')}
    <div class="drop" id="drop">Drop files or folders here, or click to choose
      <small>Images, PDFs, exports, text — anything the inbox normally takes.
      ⌘V pastes a screenshot straight in. Dropped folders keep their structure.</small>
      <div class="row" style="justify-content:center">
        <button class="btn" id="pickfiles">Choose files</button>
        <button class="btn" id="pickdir">Choose a folder</button>
      </div></div>
    <textarea class="compose" id="text" placeholder="…or just write.

Saved to the Inbox as a dated file."></textarea>
    <div class="row">
      <input id="folder" placeholder="Subfolder (optional) — e.g. Design Library">
      <select id="ext" title="File format">
        ${['md', 'txt', 'csv', 'json', 'log'].map(e =>
          `<option value="${e}">.${e}</option>`).join('')}
      </select>
      <button class="btn" id="savetext">Save to Inbox</button>
    </div>
    <div class="foot"><h2>Staged</h2>
      <div class="hint" style="margin-bottom:10px">Re-file anything before processing —
        the folder is the grouping hint the skill reads.</div>
      <div class="queue" id="queue"></div>
      <div class="row">
        <input id="newfolder" placeholder="New folder in the Inbox" style="max-width:280px">
        <button class="btn" id="mkdir">Create</button>
      </div>
      <div class="hint" style="margin-top:16px">Processing is a Claude session you start
        yourself — say <b>process the inbox</b>. This page only stages files.</div>
    </div></div>`;
  main.scrollTop = 0;

  const pick = dir => {
    const inp = Object.assign(document.createElement('input'),
      {type: 'file', multiple: true});
    if (dir) inp.webkitdirectory = true;   // native folder picker, no library
    inp.onchange = () => take(inp.files);
    inp.click();
  };
  $('drop').onclick = e => { if (e.target === $('drop') || e.target.tagName === 'SMALL') pick(false); };
  $('pickfiles').onclick = () => pick(false);
  $('pickdir').onclick = () => pick(true);
  $('savetext').onclick = async () => {
    const t = $('text');
    if (!t.value.trim() || !online) return;
    await api('/api/note', {method: 'POST', body: JSON.stringify(
      {text: t.value, folder: $('folder').value, ext: $('ext').value})});
    t.value = '';
    drawQueue();
  };
  $('mkdir').onclick = async () => {
    const f = $('newfolder');
    if (!f.value.trim()) return;
    await api('/api/mkdir', {method: 'POST', body: JSON.stringify({folder: f.value})});
    f.value = '';
    drawQueue();
  };
  drawQueue();
}

async function drawQueue() {
  await pollInbox();
  const q = $('queue');
  if (!q) return;
  q.innerHTML = (staged.length || folders.length)
    ? treeHtml(inboxTree(), '', 0) +
      (staged.length ? '' : '<div class="hint">No files staged — folders shown are waiting.</div>')
    : '<div class="hint" style="margin:0">Nothing staged yet.</div>';
}

/** Make a page, then open it in the editor.
 *
 *  Where it lands is the same rule `core/pages.py` reads back out, so nothing
 *  has to be declared: a section's home page makes a page in that section, any
 *  other page makes a sub-page of itself, because the folder named after a page
 *  is what holds its children.
 *
 *  The site's own data is stale the moment the file exists — NOTES was baked
 *  into the page that is running — so this reloads rather than routing.
 */
async function newPage(slug) {
  const n = BY[slug];
  const title = (prompt('Title of the new page') || '').trim();
  if (!title) return;
  const name = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!name) return alert('That title has nothing to make a filename from.');
  const dir = n.home ? n.category : slug;
  const r = await api('/api/save', {method: 'POST', body: JSON.stringify({
    path: `Websidian/pages/${dir}/${name}.html`, create: true,
    text: `<h1>${esc(title)}</h1>\n\n<p></p>\n`})});
  if (r.error) return alert(r.error);
  location.hash = '#/edit/' + encodeURIComponent(`${dir}/${name}`);
  location.reload();
}

async function editor(slug) {
  const n = BY[slug];
  if (!n || !online) return show(slug);
  const {text, error} = await api('/api/raw?path=' + encodeURIComponent(n.path));
  if (error) { alert(error); return show(slug); }   // never put `undefined` in the box
  main.innerHTML = `<div class="wrap">
    <h1>${esc(n.title)}</h1>
    <div class="stats">Editing <code>${esc(n.path)}</code> — saving writes the file and
      rebuilds the site. Every version is in git.</div>
    <textarea class="editor" id="src"></textarea>
    <div class="row">
      <button class="btn go" id="save">Save</button>
      <a class="btn" href="#/n/${slug}">Cancel</a>
      <span class="hint grow" id="savemsg"></span>
    </div></div>`;
  $('src').value = text;
  main.scrollTop = 0;
  $('save').onclick = async () => {
    $('save').disabled = true;
    $('savemsg').textContent = 'Saving…';
    const r = await api('/api/save', {method: 'POST',
      body: JSON.stringify({path: n.path, text: $('src').value})});
    if (r.error) {
      $('savemsg').textContent = r.error;
      $('save').disabled = false;
    } else {
      $('savemsg').innerHTML = '<span class="saved">Saved — reloading…</span>';
      setTimeout(() => { location.hash = '#/n/' + slug; location.reload(); }, 700);
    }
  };
}

