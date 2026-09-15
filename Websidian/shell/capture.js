/** Walk a dropped directory. dataTransfer.files is flat and omits folders. */
async function entryFiles(entry, prefix = '') {
  if (entry.isFile) {
    const file = await new Promise(res => entry.file(res));
    return [{file, path: prefix}];
  }
  const reader = entry.createReader();
  const out = [];
  for (;;) {  // readEntries returns at most 100 at a time
    const batch = await new Promise(res => reader.readEntries(res, () => res([])));
    if (!batch.length) break;
    for (const e of batch) out.push(...await entryFiles(e, prefix + entry.name + '/'));
  }
  return out;
}

async function take(files, base = '') {
  if (!online) return;
  const folder = $('folder');
  const root = base || (folder ? folder.value : '');
  for (const item of files) {
    const f = item.file || item;
    // webkitRelativePath is set by the folder picker; item.path by a folder drop
    const rel = item.path ?? (f.webkitRelativePath
      ? f.webkitRelativePath.slice(0, f.webkitRelativePath.lastIndexOf('/') + 1) : '');
    await fetch('/api/drop', {method: 'POST', body: await f.arrayBuffer(), headers: {
      'X-Filename': encodeURIComponent(f.name || 'pasted-' + Date.now() + '.png'),
      'X-Folder': encodeURIComponent([root, rel].filter(Boolean).join('/')),
    }});
  }
  if (location.hash !== '#/inbox') location.hash = '#/inbox';
  else drawQueue();
}

document.addEventListener('click', async e => {
  const un = e.target.closest('[data-unstage]');
  if (un) {
    await api('/api/unstage', {method: 'POST',
      body: JSON.stringify({file: un.dataset.unstage})});
    drawQueue();
  }
});
document.addEventListener('change', async e => {
  const sel = e.target.closest('select.mv');
  if (!sel) return;
  let to = sel.value;
  if (to === '::new') {
    to = (prompt('New folder inside the Inbox:') || '').trim();
    if (!to) return drawQueue();
  }
  await api('/api/move', {method: 'POST',
    body: JSON.stringify({from: sel.dataset.from, to})});
  drawQueue();
});
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
  e.preventDefault();
  if (online) veil.classList.add('on');
}));
document.addEventListener('dragleave', e => {
  if (e.relatedTarget === null) veil.classList.remove('on');
});
document.addEventListener('drop', async e => {
  e.preventDefault();
  veil.classList.remove('on');
  const entries = [...e.dataTransfer.items]
    .map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (entries.some(en => en.isDirectory)) {
    const found = [];
    for (const en of entries) found.push(...await entryFiles(en));
    return take(found);
  }
  if (e.dataTransfer.files.length) take(e.dataTransfer.files);
});
document.addEventListener('paste', e => {
  const files = [...e.clipboardData.files];
  if (files.length && document.activeElement.tagName !== 'TEXTAREA') take(files);
});
document.addEventListener('keydown', e => {
  if (e.key === 'n' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
    e.preventDefault();
    location.hash = '#/inbox';
  }
});
pollInbox().then(route);
