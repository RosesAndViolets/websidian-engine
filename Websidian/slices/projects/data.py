"""Per-project commit history, for the Projects Home.

A project's progress is its repository's commits, so this reads git directly
rather than asking anyone to keep a status field up to date.
"""
import csv
import datetime
import pathlib
import re
import subprocess

from core.vault import REPO, VAULT

WORKSPACE = pathlib.Path.home() / "Workspace"

# Project slug -> the local checkout whose commits are that project's progress.
#
# A path on this machine, not a remote URL: the calendar is read with `git log`
# and the whole site stays offline, so a project you have not cloned has no
# history here. Explicit, never discovered — a guessed path would credit one
# project with another's work, and a project with no entry simply shows no
# calendar, which is the honest rendering of "nobody told the site where it is".
#
# Empty by default — a fresh instance has not cloned anything yet, and a
# stale entry pointing at a path that no longer exists is silently skipped
# below rather than failing the build, so there is no harm in adding one
# early. Two examples of the shapes this actually takes:
#
#   "personal-projects/active/some-project": REPO,
#     when the project *is* this repository — REPO is this vault's own root,
#     imported from core.vault, so its own commits become the calendar.
#   "personal-projects/active/another-project": WORKSPACE / "some" / "checkout",
#     when the project lives in its own repo elsewhere on this machine.
REPOS = {}

WEEKS = 53


def read_project_log():
    """`Data/project-log.csv` — what a session did, grouped by project and day.

        date,kind,project,text,people,due,closed

    The same seven columns as `work-log.csv` with `topic` replaced by `project`,
    and it exists because those two things were living in one file. `/vault-log`
    files a coding session; `/vault-work` files the job. Reading them from one
    table meant the Work page showed the vault's own homework, and no amount of
    filtering downstream fixes a row that is in the wrong book.

    **Grouped by day, not returned flat.** A session produces a dozen bullets
    and a project earns a milestone every few days, so threading every bullet
    onto the milestone spine would bury the spine in its own footnotes. A day is
    the unit a session actually happens in, and it keeps the timeline readable
    as the log grows: one quiet entry per working day, however much was done.
    """
    f = VAULT / "Data" / "project-log.csv"
    if not f.exists():
        return {}
    out = {}
    for r in csv.DictReader(f.open()):
        slug = (r.get("project") or "").strip()
        date, text = (r.get("date") or "").strip(), (r.get("text") or "").strip()
        if not slug or not date or not text:
            continue
        day = out.setdefault(slug, {}).setdefault(date, [])
        day.append({"kind": (r.get("kind") or "").strip().lower(), "text": text,
                    "due": (r.get("due") or "").strip(),
                    "closed": (r.get("closed") or "").strip(),
                    "people": [p.strip() for p in (r.get("people") or "").split(";")
                               if p.strip()]})
    return {slug: dict(sorted(days.items())) for slug, days in out.items()}


def read_project_meta():
    """`Data/projects.csv` — one row per project page, keyed by its slug.

    Status, urgency, effort and a target date are things only you know; git
    cannot tell us any of them. A blank cell stays blank on the page rather
    than being guessed at.
    """
    f = VAULT / "Data" / "projects.csv"
    if not f.exists():
        return {}
    out = {}
    for r in csv.DictReader(f.open()):
        slug = (r.get("project") or "").strip()
        if slug:
            out[slug] = {k: (v or "").strip()
                         for k, v in r.items() if k and k != "project"}
    return out


# The four rooms a milestone's account is divided into, and what counts as one
# thing inside each. The count is what rides the tab, so you learn there were
# five rejected paths without opening the pane — the summary before the detail.
PARTS = {"account": None, "dropped": 'data-kind="',
         "code": "<figure", "refs": 'data-status="'}
PART_RE = re.compile(r'<section\s+data-part="(\w+)"[^>]*>(.*?)</section>', re.S)
SINCE_RE = re.compile(r'data-since="(\d{4}-\d{2}-\d{2})"')


def read_milestone_parts(name, sub=""):
    """One milestone's account, split into its four panes.

    The account lives in `Data/milestones/<file>.html` rather than in the CSV
    cell, because the cell cannot hold a code snippet: every newline and quote
    would be escaped into something no one — and no later session — can read.
    A fragment is what the rest of this vault already uses for authored content,
    so it costs no parser and no new convention.

    Splitting is a regex over `<section data-part="…">` rather than an HTML
    parse. The fragment is ours, written by `/vault-log` to a fixed shape, and a
    section that does not match simply does not render: a malformed file loses a
    pane instead of taking the page down with it.
    """
    f = VAULT / "Data" / "milestones" / sub / name
    if not name or "/" in name or not f.exists():
        return {}, {}
    src = f.read_text()
    parts = {k: v.strip() for k, v in PART_RE.findall(src) if k in PARTS}
    counts = {k: parts[k].count(mark)
              for k, mark in PARTS.items() if mark and parts.get(k)}
    return parts, counts


def read_milestone_drafts():
    """`Data/milestones/_drafts/` — the milestone each project has not earned yet.

    A session that changed something real but did not reach a milestone still
    produces the expensive half: the route tried and abandoned, the reason it
    failed, the snippet that carries the idea. Before this, that went to a
    terminal report and died at `/clear` — `work-log.csv` has no kind for a
    rejected decision, so there was nowhere for it to land.

    So it lands here, in the same four-room shape a milestone uses, and
    accumulates across sessions. This is not a lesser class of milestone and
    deliberately not a second tier — a second bar set below the first is a bar
    everything clears, and forty of those on the tree would cost the drawing the
    only thing it has to say. It is *the* milestone, before it is finished:
    `/vault-log` appends to it every run, and the run that finally earns the row
    opens with it already written and then clears it.

    One draft per project, so the tree can show at most one bud and inflation is
    impossible by construction rather than by discipline.
    """
    d = VAULT / "Data" / "milestones" / "_drafts"
    if not d.is_dir():
        return {}
    out = {}
    for f in sorted(d.glob("*.html")):
        parts, counts = read_milestone_parts(f.name, "_drafts")
        if not parts:
            continue
        m = SINCE_RE.search(f.read_text())
        out[f.stem.replace("--", "/")] = {
            "parts": parts, "counts": counts, "since": m.group(1) if m else ""}
    return out


# Worst first, and the order is the whole reason the column exists. `silent` is
# top because this vault's one stated rule about faults is that the dangerous one
# is the one that renders as an ordinary page — a wrong number nobody scrolls
# past. `open` is last because an undecided question is not yet a defect.
SEVERITIES = ["silent", "blocking", "visible", "open"]


def read_challenges():
    """`Data/challenges.csv` — what is known to be wrong, grouped by project slug.

        project,id,title,severity,noticed,note

    A register rather than a backlog. Every row here is something already
    diagnosed and deliberately not fixed, so the value is in the *why not* — a
    list of titles would be a worse version of the thing that already exists in
    everybody's head. The account lives in `Data/challenges/<id>.html`, and
    **the id is the filename**, the same pairing a knowledge entry uses, so
    nothing joins them that could fall out of sync.

    A row with no such file still renders; it just does not open. That is the
    honest rendering of a problem noticed but not yet written up, and it is
    better than either hiding the row or blocking on the prose.

    `noticed` is when the row entered this register, not when the problem
    started. Most of these predate the file and inventing start dates for them
    would be worse than admitting the register is younger than its contents.

    Returns (by-project dict, unknown severities).
    """
    f = VAULT / "Data" / "challenges.csv"
    if not f.exists():
        return {}, []
    out, unknown = {}, set()
    for r in csv.DictReader(f.open()):
        slug = (r.get("project") or "").strip()
        cid = (r.get("id") or "").strip()
        title = (r.get("title") or "").strip()
        if not slug or not cid or not title:
            continue
        sev = (r.get("severity") or "").strip().lower()
        if sev not in SEVERITIES:
            unknown.add(sev or "(blank)")
        detail = VAULT / "Data" / "challenges" / f"{cid}.html"
        out.setdefault(slug, []).append({
            "id": cid, "title": title, "severity": sev,
            "noticed": (r.get("noticed") or "").strip(),
            "note": (r.get("note") or "").strip(),
            "detail": detail.read_text().strip() if detail.is_file() else ""})
    order = {s: i for i, s in enumerate(SEVERITIES)}
    for rows in out.values():
        rows.sort(key=lambda c: (order.get(c["severity"], len(order)), c["title"]))
    return out, sorted(unknown)


def read_milestones():
    """`Data/milestones.csv` — the significant steps, grouped by project slug.

    Curated, not derived. Commits are the raw record and the calendar already
    shows them; a milestone is the judgement that something mattered, and no
    amount of reading `git log` produces that. Oldest first, so the timeline
    reads downward as the project grew.
    """
    f = VAULT / "Data" / "milestones.csv"
    if not f.exists():
        return {}
    out = {}
    for r in csv.DictReader(f.open()):
        slug = (r.get("project") or "").strip()
        title = (r.get("title") or "").strip()
        if not slug or not title:
            continue
        # `detail` names a file now, not prose. An entry whose file is missing
        # stays a closed line rather than an empty dialog — the right shape for
        # a step that needs no defending, and for one whose account went astray.
        parts, counts = read_milestone_parts((r.get("detail") or "").strip())
        out.setdefault(slug, []).append({
            "date": (r.get("date") or "").strip(), "title": title,
            "note": (r.get("note") or "").strip(),
            "parts": parts, "counts": counts})
    for rows in out.values():
        rows.sort(key=lambda m: m["date"])
    return out


def commit_days(path, since):
    """{"YYYY-MM-DD": commits that day} for one repository."""
    r = subprocess.run(["git", "log", f"--since={since}", "--date=short", "--format=%ad"],
                       cwd=str(path), capture_output=True, text=True)
    days = {}
    for day in r.stdout.split():
        days[day] = days.get(day, 0) + 1
    return days


def first_commit(path):
    """The day the history starts — a project's start date, read rather than
    declared. Root commits only, so the cost does not grow with the log."""
    r = subprocess.run(["git", "log", "--max-parents=0", "--date=short", "--format=%ad"],
                       cwd=str(path), capture_output=True, text=True)
    days = sorted(r.stdout.split())
    return days[0] if days else ""


def project_activity():
    """One entry per project that has a repository, keyed by page slug.

    The calendar ships as a flat run of daily counts plus its start date, so the
    page indexes into it instead of doing date arithmetic — the grid is seven
    rows flowing down each column, which is what makes a column one week.
    """
    today = datetime.date.today()
    start = today - datetime.timedelta(days=WEEKS * 7 - 1)
    # Back up to Sunday so every column is a whole week, the way GitHub reads.
    start -= datetime.timedelta(days=(start.weekday() + 1) % 7)
    out = {}
    for slug, path in REPOS.items():
        if not (path / ".git").exists():
            continue
        first = first_commit(path)
        # A repo that exists but has no commits yet — a fresh `git init` ahead
        # of its own first commit — has no history to draw either. Same class
        # of gap as no `.git` at all: nobody has anything to show here yet.
        if not first:
            continue
        days = commit_days(path, start.isoformat())
        counts = [days.get((start + datetime.timedelta(days=i)).isoformat(), 0)
                  for i in range((today - start).days + 1)]
        out[slug] = {"start": start.isoformat(), "counts": counts,
                     "total": sum(counts), "first": first}
    return out
