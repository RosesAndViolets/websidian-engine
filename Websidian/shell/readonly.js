/** Shown wherever a write control would be, when the page was opened as a file.
 *  The link carries the hash, so one click lands on the live page in the same
 *  place — a file:// page can't probe the server itself (its origin is null and
 *  the fetch is blocked before it leaves the browser), so it can't redirect. */
function readonlyNotice(what) {
  return `<div class="log">Read-only — this page was opened as a file, so there is no server
    to ${what}. Open <a href="http://127.0.0.1:8765/${location.hash}"><b>http://127.0.0.1:8765</b></a>
    instead. If nothing loads there, the server isn't running — start it with
    <b>python3 "$HOME/Workspace/Personal Projects/Vault/Websidian/serve.py"</b>.</div>`;
}

