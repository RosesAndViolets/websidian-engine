"""`Data/cadence.csv` — the things that are due because time passed, not
because anyone wrote them down.

    what,label,every,rail,note
    intake,Log today's intake,1,Diet,
    muscle:glutes,Train glutes,2,Workout,

A work log holds a `next` because you typed one. Nothing types "you have not
eaten on the record today" or "it has been three days since you trained glutes"
— those are only visible as an *absence*, and an absence has to be computed
against an expectation. This file is the expectation, and it is the whole of it:
one row is one thing, how often it should happen, and which rail it belongs to.

**`what` names a record, not a task.** The question the page asks is always the
same — when was this record last added to — and `every` is how long that may go
without becoming a todo. So `finance` is due when the newest transaction in
`spend.csv` is a week old, never when some import command was last run. Data
freshness is the honest signal: re-running an importer that fetched nothing
should not tick a box, and a file's mtime says nothing at all after a checkout.

The names the page knows how to resolve are `intake`, `weight`, `finance`,
`finance-review`, `work` and `muscle:<name>`, which reads the last session that
named that muscle. Anything else is reported rather than silently never due — a
cadence that quietly stops firing is the failure worth catching here, because
it looks exactly like a life in which nothing is ever overdue.
"""
import csv

from core.vault import VAULT

# The records `todo.js` knows how to date. `muscle:` is a prefix rather than a
# name because the muscle list belongs to the workout slice and duplicating it
# here would be two lists to keep in step.
RESOLVERS = ["intake", "weight", "finance", "finance-review", "work"]


def read_cadence():
    """Rows oldest-file-order, and any `what` nothing can resolve.

    Returns (rows, unresolvable). The second half is the maintenance signal:
    a typo in `what` costs the row silently, and a todo that never appears is
    indistinguishable from one that is never due.
    """
    f = VAULT / "Data" / "cadence.csv"
    if not f.exists():
        return [], []
    rows, unknown = [], set()
    for r in csv.DictReader(f.open()):
        what = (r.get("what") or "").strip()
        label = (r.get("label") or "").strip()
        if not what or not label:
            continue
        try:
            every = int(r.get("every") or 0)
        except ValueError:
            every = 0
        if every < 1:
            unknown.add(what + " (no period)")
            continue
        if what not in RESOLVERS and not what.startswith("muscle:"):
            unknown.add(what)
            continue
        rows.append({"what": what, "label": label, "every": every,
                     "rail": (r.get("rail") or "").strip(),
                     "note": (r.get("note") or "").strip()})
    return rows, sorted(unknown)
