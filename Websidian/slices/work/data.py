"""`Data/work-log.csv` — the work log, one row per bullet.

    date,kind,topic,text,people,due,closed
    2026-08-05,open,rag,Why did 田中さん advise against inheriting the RAG as-is?,田中さん,,

A day is several bullets and each bullet is one fact, because the five kinds of
thing a work note contains do not belong in one paragraph:

    did      what was done
    learned  what is now known that was not
    open     a question with no answer yet — it stays on the board until `closed`
    next     something to do, `due` if it has a day
    dated    a fact with a date attached: hardware arriving, a release, a review
    milestone  the handful of things that would be on a CV: joining, changing
               team, a project starting. Its own timeline on the page.

`topic` is one slug per bullet, and it is what turns a chronological log into
threads — every `rag` row is the history of that thread whatever week it was
written in. `closed` is the date an open question was answered or a next was
done; the answer itself arrives as its own `learned` row, so nothing is
overwritten and the log stays append-only.

Written by `/vault-work` from captures in `Inbox/Work/` — and by `/vault-log`,
which files a coding session against the same columns. **That is why a row
carries a rail.** Two skills write here and only one of them is about the job;
by the time the file had ninety rows, fifty-two of them were Websidian sessions
and the Work page was showing all of them under a heading that promised the
opposite.
"""
import csv

from core.vault import VAULT

KINDS = ["did", "learned", "open", "next", "dated", "milestone"]

# Topics that live on another rail, and the rail each belongs to. Personal
# projects are not listed because they come from `projects.csv` — starting one
# needs no edit here, which is the only reason this stays short.
ELSEWHERE = {"finance": "Finance", "supplements": "Health"}

# An exclusion list rather than an inclusion list, and the asymmetry is the
# whole design. A job topic missing from the Work page is invisible — the page
# looks complete and is simply wrong. A personal topic showing up there is a
# mistake you can see and name in one word. So anything unrecognised is the job,
# and the failure this can still have is the one that announces itself.


def rail_of(topic, projects):
    """Which rail a bullet belongs to. Unrecognised is the job, on purpose."""
    if topic and topic in projects:
        return "Personal Projects"
    return ELSEWHERE.get(topic, "Work")


def read_work_log():
    """Bullets oldest first, and any `kind` the page has no rendering for.

    Nothing is dropped here. A row that belongs to another rail keeps its place
    in the file and in this list and is marked, because it is still a true thing
    that happened on a day — the to-do list files it under the rail it actually
    came from rather than calling it work.

    Asks: what is happening at work, what am I working on, what is still open, what did I
    say I would do, was it a hard week, who did I work with.

    Written for the question rather than the code, because this is what a
    lookup matches a person's words against — the `aka` column's job, done
    for a function. See `_evals/advice.py`.
    """
    from slices.projects.data import read_project_meta

    f = VAULT / "Data" / "work-log.csv"
    if not f.exists():
        return [], []
    # A project's topic slug is the last segment of its page slug:
    # `personal-projects/active/websidian` is written `#websidian` in the log.
    projects = {s.rsplit("/", 1)[-1] for s in read_project_meta()}
    rows, unknown = [], set()
    for r in csv.DictReader(f.open()):
        date, text = (r.get("date") or "").strip(), (r.get("text") or "").strip()
        if not date or not text:
            continue
        kind = (r.get("kind") or "").strip().lower()
        if kind not in KINDS:
            unknown.add(kind or "(blank)")
        topic = (r.get("topic") or "").strip().lower()
        rows.append({"date": date, "kind": kind, "text": text,
                     "topic": topic, "rail": rail_of(topic, projects),
                     "people": [p.strip() for p in (r.get("people") or "").split(";")
                                if p.strip()],
                     "due": (r.get("due") or "").strip(),
                     "closed": (r.get("closed") or "").strip()})
    return sorted(rows, key=lambda r: r["date"]), sorted(unknown)
