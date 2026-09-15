#!/usr/bin/env python3
"""Serve the vault site with a capture inbox attached.

    python3 "$HOME/Workspace/Personal Projects/Vault/Websidian/serve.py"   ->  http://127.0.0.1:8765

Drag files onto the page, paste images, or type a note: everything lands in
`Vault/Inbox/` exactly as if you had dropped it in Finder.

Capture only, on purpose: processing the Inbox is a Claude session you start
yourself, so you can watch it and it can ask you things.

Bound to loopback only. Nothing here is reachable from outside this machine.
"""
import csv
import datetime
import json
import mimetypes
import pathlib
import re
import subprocess
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

APP = pathlib.Path(__file__).resolve().parent    # Websidian/ — this application
REPO = APP.parent                                # holds both applications
INBOX = REPO / "Inbox"                           # the one thing they share
PORT = 8765

# The quick-log picker on the Diet page: a second writer to intake.csv, next to
# /vault-intake. Safe because it never estimates — every gram here was resolved
# against ingredients.csv/recipes.csv before the request was sent — and every row
# it writes is marked `source=manual` so the two writers stay distinguishable.
INTAKE_CSV = APP / "Data" / "intake.csv"
INTAKE_FIELDS = ["when", "meal", "ingredient", "grams", "source"]


def read_intake_csv():
    if not INTAKE_CSV.exists():
        return []
    with INTAKE_CSV.open(newline="") as f:
        return list(csv.DictReader(f))


def write_intake_csv(rows):
    with INTAKE_CSV.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=INTAKE_FIELDS, extrasaction="ignore",
                           lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") or "" for k in INTAKE_FIELDS})


def rebuild():
    subprocess.run(["python3", str(APP / "build.py")], cwd=str(REPO), capture_output=True)


FAVORITES_CSV = APP / "Data" / "favorites.csv"
FAVORITES_FIELDS = ["kind", "key", "slot", "added"]


def read_favorites_csv():
    if not FAVORITES_CSV.exists():
        return []
    with FAVORITES_CSV.open(newline="") as f:
        return list(csv.DictReader(f))


def write_favorites_csv(rows):
    with FAVORITES_CSV.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FAVORITES_FIELDS, extrasaction="ignore",
                           lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") or "" for k in FAVORITES_FIELDS})

TEXT_FORMATS = ("md", "txt", "csv", "json", "log")

# The page is assembled from these on every build, so editing one and reloading
# should just show it. Notes already rebuild via /api/save; this covers the
# front-end source, which nothing else watches.
SOURCE_DIRS = ("shell", "slices", "core")


def rebuild_if_stale():
    """Rebuild when any slice is newer than the page built from it.

    An mtime sweep over ~30 small files, once per page load. Cheap enough not to
    matter and simpler than a watcher — there is no daemon to leave running or
    to get out of sync after a git checkout.
    """
    out = APP / "index.html"
    built = out.stat().st_mtime if out.exists() else 0
    newest = max((p.stat().st_mtime
                  for d in SOURCE_DIRS for p in (APP / d).rglob("*")
                  if p.is_file()), default=0)
    newest = max(newest, (APP / "build.py").stat().st_mtime)
    if newest > built:
        print("  rebuilding — front-end source changed")
        subprocess.run(["python3", str(APP / "build.py")],
                       cwd=str(REPO), capture_output=True)


def safe_name(name):
    """Filename only — no directories, no traversal, no shell-hostile characters."""
    name = pathlib.PurePosixPath(name.replace("\\", "/")).name
    name = re.sub(r"[^\w .()\-—–]", "_", name, flags=re.UNICODE).strip(". ")
    return name[:120] or "dropped"


def clean_folder(raw):
    """Subfolder path from the browser, or None. Every caller goes through here.

    "/" survives so a dropped folder keeps its structure. ".." is refused
    outright rather than stripped — silently turning "../../etc" into "etc"
    is contained but creates a folder nobody asked for.
    """
    raw = (raw or "").strip()
    if ".." in raw or raw.startswith("/"):
        return None
    return "/".join(re.sub(r"[^\w \-]", "", part).strip()
                    for part in raw.split("/")).strip("/")


def destination(folder, filename):
    d = INBOX / folder if folder else INBOX
    d.mkdir(parents=True, exist_ok=True)
    p = d / safe_name(filename)
    stem, suffix, i = p.stem, p.suffix, 1
    while p.exists():
        p = d / f"{stem}-{i}{suffix}"
        i += 1
    return p


EDITABLE = f"{APP.name}/pages"


def editable_path(rel, must_exist=True):
    """Resolve a client-supplied path, or refuse it.

    The browser is not trusted with a path: it must land inside one of the
    note folders, stay under the vault after symlink resolution, and be .md.

    `must_exist=False` is how a page is created — same boundary, minus the
    requirement that the file already be there.
    """
    p = (REPO / rel).resolve()
    if p.suffix != ".html" or p.is_dir() or (must_exist and not p.is_file()):
        return None
    try:
        parts = p.relative_to(REPO.resolve()).parts
    except ValueError:
        return None
    # Must match what build.py treats as a page, or notes render with an Edit
    # button that 400s — root-level notes like the spec are pages too.
    return p if "/".join(parts[:2]) == EDITABLE else None


def inbox_listing():
    if not INBOX.exists():
        return []
    return sorted(str(p.relative_to(INBOX)) for p in INBOX.rglob("*")
                  if p.is_file() and p.name not in (".keep", ".DS_Store"))


def inbox_folders():
    """Every subfolder, including empty ones — an empty folder is still a
    destination you can file something into."""
    if not INBOX.exists():
        return []
    return sorted(str(p.relative_to(INBOX)) for p in INBOX.rglob("*") if p.is_dir())


def staged_type(name):
    """Content type for a staged file — decided here, never sniffed.

    An Inbox file is shown, not executed. Images keep their own type so an
    `<img>` renders them; everything else is text/plain or octet-stream, so an
    .html someone dropped is read as its own source rather than running as a
    page in this origin.
    """
    kind = mimetypes.guess_type(name)[0] or ""
    if kind.startswith("image/"):
        return kind
    if kind.startswith("text/") or name.rsplit(".", 1)[-1].lower() in TEXT_FORMATS:
        return "text/plain; charset=utf-8"
    return "application/octet-stream"


def inside_inbox(rel, must_exist=True):
    """Resolve a client-supplied inbox path, or refuse it."""
    if rel in (None, ""):
        return INBOX
    p = (INBOX / rel).resolve()
    if not p.is_relative_to(INBOX.resolve()):
        return None
    return p if (p.exists() or not must_exist) else None


# Every refusal this server hands back goes here. The client on the other end is
# usually a skill rather than a person watching the screen, so a 400 nobody sees
# is a capture that silently never happened — and the next thing anyone notices
# is a note that isn't in the Inbox, days later, with nothing to look at.
#
# ponytail: append-only and unbounded. Refusals are rare enough at one user that
# it does not matter; rotate if this ever outgrows skimming.
REJECTIONS = APP / "serve.log"

# What a refusal records about its request: the identifiers only. `text` is the
# note itself, and a log sitting beside the Inbox is the last place a second
# copy of it should accumulate.
DETAIL_KEYS = ("path", "folder", "from", "to", "file", "ext", "create")


def request_detail(headers, body):
    """The identifying fields of a request, for the rejection log.

    Both shapes the API accepts: a drop names its file in headers, everything
    else posts JSON. A body that is neither — the raw bytes of a dropped image —
    contributes nothing rather than raising.
    """
    out = {}
    for h in ("X-Filename", "X-Folder"):
        if headers.get(h):
            out[h] = urllib.parse.unquote(headers[h])[:200]
    try:
        data = json.loads(body or b"{}")
    except ValueError:
        return out
    if isinstance(data, dict):
        out.update({k: str(data[k])[:200] for k in DETAIL_KEYS if k in data})
    return out


class Handler(SimpleHTTPRequestHandler):
    # Overwritten per request. A class attribute so a GET can never inherit the
    # detail of a POST that shared its connection.
    detail = {}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(APP), **kw)

    def end_headers(self):
        # index.html is regenerated constantly; a cached copy silently hides
        # every edit and every processed note.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if not self.path.startswith("/assets"):
            print("  %s %s" % (self.command, self.path))

    def log_rejection(self, obj, code):
        """One JSON line per refusal.

        Never raises: a log that cannot be written must not turn a clean 400
        into a dropped connection.
        """
        endpoint, _, query = self.path.partition("?")
        detail = dict(self.detail)
        if query:
            detail.update({k: v[0][:200]
                           for k, v in urllib.parse.parse_qs(query).items()})
        entry = {"at": datetime.datetime.now().isoformat(timespec="seconds"),
                 "method": self.command, "endpoint": endpoint, "code": code,
                 "error": obj.get("error", ""), "detail": detail}
        try:
            with REJECTIONS.open("a") as fh:
                fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except OSError:
            pass

    def reply(self, obj, code=200):
        # One guard for all thirteen refusals: every one of them comes through
        # here, so none of the call sites has to remember to log itself.
        if code >= 400:
            self.log_rejection(obj, code)
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_staged(self, p):
        """The bytes of one staged file, for the panel's file view. The Inbox is
        outside the served directory, so this is the only way in."""
        body = p.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", staged_type(p.name))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.detail = {}          # a GET carries its identifiers in the query
        if self.path == "/api/inbox":
            return self.reply({"files": inbox_listing(), "folders": inbox_folders()})
        if self.path.startswith("/api/staged?"):
            rel = urllib.parse.parse_qs(self.path.split("?", 1)[1]).get("path", [""])[0]
            p = inside_inbox(rel)
            if not p or not p.is_file() or p == INBOX:
                return self.reply({"error": "no such staged file"}, 400)
            return self.send_staged(p)
        if self.path.startswith("/api/raw?"):
            rel = urllib.parse.parse_qs(self.path.split("?", 1)[1]).get("path", [""])[0]
            p = editable_path(rel)
            if not p:
                return self.reply({"error": "not an editable note"}, 400)
            return self.reply({"text": p.read_text()})
        if self.path in ("/", "/index.html"):
            rebuild_if_stale()
        return super().do_GET()

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self.detail = request_detail(self.headers, body)

        if self.path == "/api/drop":
            # Headers are latin-1 on the wire, so the page percent-encodes both.
            name = urllib.parse.unquote(self.headers.get("X-Filename", "dropped"))
            folder = clean_folder(urllib.parse.unquote(self.headers.get("X-Folder", "")))
            if folder is None:
                return self.reply({"error": "bad folder path"}, 400)
            p = destination(folder, name)
            p.write_bytes(body)
            return self.reply({"saved": str(p.relative_to(REPO))})

        if self.path == "/api/note":
            data = json.loads(body or b"{}")
            text = (data.get("text") or "").strip()
            if not text:
                return self.reply({"error": "empty note"}, 400)
            stamp = datetime.datetime.now().strftime("%Y-%m-%d %H%M")
            # A capture answering a todo names itself after the todo, not after
            # its own first line — the first line is the marker, and "TODO ·
            # Work · …" repeated across every such file would make the Inbox
            # tree unreadable. `safe_name()` still sanitises it downstream.
            head = re.sub(r"\s+", " ",
                          data.get("name") or text.splitlines()[0])[:60]
            ext = data.get("ext") if data.get("ext") in TEXT_FORMATS else "md"
            folder = clean_folder(data.get("folder", ""))
            if folder is None:
                return self.reply({"error": "bad folder path"}, 400)
            p = destination(folder, f"{stamp} — {head}.{ext}")
            p.write_text(text + "\n")
            return self.reply({"saved": str(p.relative_to(REPO))})

        if self.path == "/api/save":
            data = json.loads(body or b"{}")
            new = bool(data.get("create"))
            p = editable_path(data.get("path", ""), must_exist=not new)
            if not p:
                return self.reply({"error": "not an editable note"}, 400)
            # Creating is the one case where the path is a guess, so a collision
            # is refused rather than overwriting the page that is already there.
            if new and p.exists():
                return self.reply({"error": "a page already lives at that name"}, 400)
            text = data.get("text", "")
            if not text.strip():
                return self.reply({"error": "refusing to save an empty note"}, 400)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text if text.endswith("\n") else text + "\n")
            subprocess.run(["python3", str(APP / "build.py")],
                           cwd=str(REPO), capture_output=True)
            return self.reply({"saved": str(p.relative_to(REPO))})

        if self.path == "/api/move":
            data = json.loads(body or b"{}")
            src = inside_inbox(data.get("from"))
            dest_dir = inside_inbox(data.get("to"), must_exist=False)
            if not src or not src.is_file() or dest_dir is None:
                return self.reply({"error": "bad move"}, 400)
            dest_dir.mkdir(parents=True, exist_ok=True)
            target = dest_dir / src.name
            stem, suffix, i = target.stem, target.suffix, 1
            while target.exists():
                target = dest_dir / f"{stem}-{i}{suffix}"
                i += 1
            src.rename(target)
            return self.reply({"moved": str(target.relative_to(INBOX))})

        if self.path == "/api/mkdir":
            data = json.loads(body or b"{}")
            name = clean_folder(data.get("folder", ""))
            if name is None:
                return self.reply({"error": "folder name cannot contain .. or start with /"}, 400)
            d = inside_inbox(name, must_exist=False) if name else None
            if not d or d == INBOX:
                return self.reply({"error": "bad folder name"}, 400)
            d.mkdir(parents=True, exist_ok=True)
            (d / ".keep").touch()
            return self.reply({"created": str(d.relative_to(INBOX))})

        if self.path in ("/api/intake/log", "/api/intake/edit"):
            data = json.loads(body or b"{}")
            when = (data.get("when") or "").strip()
            meal = (data.get("meal") or "").strip()
            items = data.get("items") or []
            if not when or not meal or not items:
                return self.reply({"error": "need when, meal and at least one item"}, 400)
            new_rows = []
            for it in items:
                ing = (it.get("ingredient") or "").strip()
                grams = it.get("grams")
                if not ing or not isinstance(grams, (int, float)) or grams <= 0:
                    return self.reply({"error": f"bad item: {it}"}, 400)
                new_rows.append({"when": when, "meal": meal, "ingredient": ing,
                                  "grams": grams, "source": "manual"})
            rows = read_intake_csv()
            if self.path == "/api/intake/edit":
                rows = [r for r in rows
                        if not (r.get("when") == when and r.get("meal") == meal)]
            write_intake_csv(rows + new_rows)
            rebuild()
            return self.reply({"saved": len(new_rows)})

        if self.path == "/api/intake/delete":
            data = json.loads(body or b"{}")
            when = (data.get("when") or "").strip()
            meal = (data.get("meal") or "").strip()
            if not when or not meal:
                return self.reply({"error": "need when and meal"}, 400)
            rows = read_intake_csv()
            kept = [r for r in rows
                    if not (r.get("when") == when and r.get("meal") == meal)]
            if len(kept) == len(rows):
                return self.reply({"error": "no matching meal"}, 400)
            write_intake_csv(kept)
            rebuild()
            return self.reply({"deleted": len(rows) - len(kept)})

        if self.path == "/api/favorite/toggle":
            data = json.loads(body or b"{}")
            kind = (data.get("kind") or "").strip()
            key = (data.get("key") or "").strip()
            slot = (data.get("slot") or "").strip()
            if not kind or not key or not slot:
                return self.reply({"error": "need kind, key and slot"}, 400)
            rows = read_favorites_csv()
            match = lambda r: r.get("kind") == kind and r.get("key") == key and r.get("slot") == slot
            kept = [r for r in rows if not match(r)]
            if len(kept) == len(rows):
                kept.append({"kind": kind, "key": key, "slot": slot,
                             "added": datetime.date.today().isoformat()})
                favorited = True
            else:
                favorited = False
            write_favorites_csv(kept)
            rebuild()
            return self.reply({"favorited": favorited})

        if self.path == "/api/unstage":
            data = json.loads(body or b"{}")
            p = (INBOX / data.get("file", "")).resolve()
            if p.is_file() and p.is_relative_to(INBOX.resolve()) and p.name != ".keep":
                p.unlink()
                return self.reply({"removed": data["file"]})
            return self.reply({"error": "no such staged file"}, 400)

        return self.reply({"error": "unknown endpoint"}, 404)


if __name__ == "__main__":
    INBOX.mkdir(exist_ok=True)
    print(f"vault → http://127.0.0.1:{PORT}   (inbox: {len(inbox_listing())} file(s))")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
