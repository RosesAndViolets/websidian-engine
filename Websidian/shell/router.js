function route() {
  const h = location.hash;
  let m;
  // Anything that is not a page render invalidates show()'s "same page" marker,
  // so returning to a page you had scrolled still starts at the top.
  if (!h.startsWith('#/n/')) shownSlug = null;
  if (m = h.match(/^#\/n\/(.+)$/)) show(decodeURIComponent(m[1]));
  else if (m = h.match(/^#\/staged\/(.+)$/)) stagedPage(decodeURIComponent(m[1]));
  else if (m = h.match(/^#\/edit\/(.+)$/)) editor(decodeURIComponent(m[1]));
  else if (h === '#/inbox') inboxPage();
  // Diet is a folder section now; the old route is kept for bookmarks.
  else if (h === '#/diet') location.hash = DIET_HOME;
  else home();
  sidebar(q.value);   // re-folds the panel around wherever you just landed
}

q.addEventListener('input', () => sidebar(q.value));
// "/" jumps to search, but only when you are not writing — "2/3 of an apple"
// belongs in the intake box, and a shortcut that eats a character you typed on
// purpose is worse than no shortcut.
const typing = () => {
  const el = document.activeElement;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};
document.addEventListener('keydown', e => {
  if (e.key === '/' && !typing()) { e.preventDefault(); q.focus(); }
  if (e.key === 'Escape' && (!typing() || document.activeElement === q)) {
    q.value = ''; sidebar(''); q.blur();
  }
});
addEventListener('hashchange', route);
drawRail();
// Neither the panel nor the first route renders here: the panel is the Inbox
// now, and `staged` is not declared until api.js. pollInbox() draws both.

// ---- writing: live when served by serve.py, inert on a file:// open ----
