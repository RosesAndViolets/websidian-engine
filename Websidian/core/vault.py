"""Paths and attachments — the parts every slice needs.

Two roots, and the distinction matters:

`APP` is this application — `Websidian/`. Everything it owns lives under it:
its content, its `Data/`, its `_attachments/`, its build output. The design
library is a second application beside it and shares none of that.

`REPO` is the folder holding both, and exists for exactly two reasons: `Inbox/`
is the one thing the two applications share, and git runs there.
"""
import pathlib
import re
import shutil

APP = pathlib.Path(__file__).resolve().parents[1]
REPO = APP.parent
INBOX = REPO / "Inbox"
OUT = APP
ASSETS = APP / "assets"

# Alias kept for the slices that still spell it this way; it means "this
# application's own folder", never the repository.
VAULT = APP


def safe_name(name):
    """The URL-safe filename an attachment gets inside `assets/`."""
    return re.sub(r"-+", "-", re.sub(r"[^A-Za-z0-9.]+", "-", name)).strip("-")


def find_attachments():
    """safe filename -> source path. Keyed by the safe name because that is what
    a page's `src="assets/…"` already says; pages reference the copy, not the
    original, so the build only has to know how to produce it."""
    found = {}
    for p in (VAULT / "_attachments").rglob("*"):
        if p.is_file() and "old-vault" not in p.parts:
            found.setdefault(safe_name(p.name), p)
    return found


ATTACHMENTS = find_attachments()


def copy_asset(safe):
    """Copy one referenced attachment into `assets/`. Returns False for a
    reference with no matching file, so the build can name it rather than
    shipping a page with a broken image."""
    src = ATTACHMENTS.get(safe)
    if not src:
        return False
    shutil.copy2(src, ASSETS / safe)
    return True

