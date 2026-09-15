"""Read the HTML fragments under `pages/` into page records.

There is no parser here, and that is the point. A page is a file of HTML you
wrote; the two things the site needs to know about it are already in it or
around it:

    the first <h1> is the title
    the folder it sits in is its category

Nothing else. No frontmatter to keep in sync, no wikilinks to resolve, no slug
to declare — the filename is the slug, and moving a file between folders is how
you recategorise it.
"""
import datetime
import re

from .vault import APP, REPO

PAGES = APP / "pages"
H1 = re.compile(r"<h1[^>]*>(.*?)</h1>\s*", re.S | re.I)
TAG = re.compile(r"<[^>]+>")
ENTITY = {"&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " "}


def text_of(html):
    """Tags stripped, entities decoded, whitespace collapsed — for search and
    for the one-line summary."""
    out = TAG.sub(" ", html)
    for k, v in ENTITY.items():
        out = out.replace(k, v)
    return re.sub(r"\s+", " ", out).strip()


def collect():
    """Every page, sorted by category then title. Returns (pages, by-slug index)
    so build.py keeps the same contract it had when this read markdown."""
    pages = []
    for p in sorted(PAGES.rglob("*.html")):
        raw = p.read_text()
        rel = p.relative_to(PAGES)
        m = H1.search(raw)
        # The shell prints the title itself, so it is lifted out of the body
        # rather than rendered twice.
        title = text_of(m.group(1)) if m else p.stem
        body = raw[:m.start()] + raw[m.end():] if m else raw
        pages.append({
            "slug": "/".join(rel.with_suffix("").parts),
            "title": title,
            "category": rel.parts[0] if len(rel.parts) > 1 else "",
            # A second folder level groups pages inside a section — projects by
            # status. Same rule as the category: the folder is the answer, and
            # regrouping a page is still a `mv`.
            "group": rel.parts[1] if len(rel.parts) > 2 else "",
            # index.html is a section's home page: it sorts first in the panel
            # and the rail button lands on it.
            "home": rel.stem == "index",
            # The file's own mtime, not a git date: a page saved from the site
            # is edited the moment it is written, and a commit may be days
            # later or never. ponytail: a fresh clone stamps every page with
            # the checkout — read `git log -1` per page if this vault ever
            # lives on two machines.
            "edited": datetime.date.fromtimestamp(p.stat().st_mtime).isoformat(),
            "path": str(p.relative_to(REPO)),
            "html": body.strip(),
            "summary": text_of(body)[:180],
            "text": text_of(body).lower(),
        })
    # A page can own sub-pages: a folder named after it holds them. So
    # `active/websidian.html` is the parent of `active/websidian/specs.html`,
    # and the parent link is simply "does a page exist at my folder's path".
    # Nothing to declare — the folder is the answer here too.
    # A slug with no slash has no folder above it, and `rsplit` would hand back
    # the slug itself — making a loose page its own parent, which walks the
    # panel's ancestor loop forever.
    slugs = {n["slug"] for n in pages}
    for n in pages:
        head = n["slug"].rsplit("/", 1)[0] if "/" in n["slug"] else ""
        n["parent"] = head if head in slugs else ""
    pages.sort(key=lambda n: (n["category"], not n["home"], n["title"].lower()))
    return pages, {n["slug"]: n for n in pages}


ASSET_REF = re.compile(r'(?:src|href)="assets/([^"]+)"')


def copy_referenced_assets(pages):
    """Copy every attachment the pages actually point at, and return the names
    that had no file behind them.

    Driven by the HTML rather than by a folder listing: an image nobody
    references is not shipped, and a reference nobody can satisfy is reported
    instead of quietly rendering as a broken image.
    """
    from .vault import copy_asset
    wanted = {name for n in pages for name in ASSET_REF.findall(n["html"])}
    return sorted(name for name in wanted if not copy_asset(name))


# The rail, top to bottom. Explicit rather than derived from the folder listing,
# because the order is an editorial decision and folders sort alphabetically.
#
#   folder  a directory under pages/. Its index.html is the section's home page
#           and the panel beside the rail lists everything else in it.
#   route   a hash the button jumps to instead — for the sections the site
#           builds itself rather than reading from a file.
#   groups  subfolder -> heading, in the order the panel should show them. A
#           declared group with no folder yet still gets a heading, because an
#           empty Done is a fact worth seeing.
SECTIONS = [
    {"label": "Global Home", "route": "#/"},
    {"label": "Personal Projects", "folder": "personal-projects",
     "groups": {"active": "Active", "planned": "Planned",
                "idea": "Just an Idea", "done": "Done"}},
    {"label": "Knowledge", "folder": "knowledge"},
    {"label": "Work", "folder": "work"},
    {"label": "Social Life", "folder": "social-life"},
    {"label": "Finance", "folder": "finance"},
    {"label": "Health", "folder": "diet"},
    {"label": "Workout", "folder": "workout"},
]


def sections(pages):
    """SECTIONS with each folder's page count attached, dropping any folder that
    has no pages so the rail never offers an empty room."""
    counts = {}
    for n in pages:
        counts[n["category"]] = counts.get(n["category"], 0) + 1
    out = []
    for s in SECTIONS:
        folder = s.get("folder", "")
        if folder and not counts.get(folder) and "route" not in s:
            continue
        out.append({**s, "count": counts.get(folder, 0)})
    return out
