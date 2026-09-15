"""`Data/people.csv` — who is in the user's life, as rows rather than prose.

Three columns and no schema beyond them: a name, which part of life they belong
to, and the handful of things worth remembering about them. Keywords are one
cell, semicolon-separated, because the interesting facts about a person do not
share a shape — "two years older", "has a girlfriend" and "Parkinson's" are not
columns anyone would design.

Ordered by category, in CATEGORIES, then by name; a category nobody declared
still shows, after the ones that were.
"""
import csv
import difflib
import re

from core.vault import VAULT

CATEGORIES = ["Family", "Friend", "Coworker"]

# How alike two names have to be before one reads as a misspelling of the other.
# SequenceMatcher scores a one-character slip as 2*shared/(len+len), and CJK
# names are short enough that the ratio is coarse: 田中太郎 against 田中太朗 is
# .75, but a two-character name off by one is only .67. The cutoff has to sit
# under the shorter case or it catches long names alone.
#
# .66 does, and it is deliberately loose. 鈴木 against 鈴木一郎 also scores .67
# and is two people, not a typo — but a false positive costs one glance, and a
# misspelling nobody catches splits one person's history in two for good. This
# is watched rather than gated for exactly that reason: it asks a question.
CLOSE = .66


def read_people():
    f = VAULT / "Data" / "people.csv"
    if not f.exists():
        return []
    rows = []
    for r in csv.DictReader(f.open()):
        name = (r.get("name") or "").strip()
        if not name:
            continue
        cat = (r.get("category") or "").strip()
        rows.append({"name": name, "category": cat,
                     "keywords": [k.strip() for k in (r.get("keywords") or "").split(";")
                                  if k.strip()]})
    order = {c: i for i, c in enumerate(CATEGORIES)}
    return sorted(rows, key=lambda p: (order.get(p["category"], len(order)),
                                       p["category"], p["name"]))


def misspelt_people(people, entities, events, work):
    """One person written two ways, which renders as two people and looks fine.

    Person names are free text on purpose. `entities.related`, `events.people`
    and `work-log.people` each take a name the way somebody wrote it, and a name
    with no row in `people.csv` is allowed — a leaving do has forty attendees and
    none of them earn a row. That freedom is right and this does not take it
    back; it closes the one hole it leaves. Because an unknown name is normal,
    a *misspelt* name is indistinguishable from one nobody wrote down, and the
    two spellings quietly split a person: 田中太郎 attended the August 2nd study
    session, 田中太朗 the one on the 8th, and the map, the log and the cards each
    show half of him.

    So the question is three-way rather than two:

      exact, on a name or one of its keywords  known — say nothing
      no resemblance to anybody                the forty attendees — say nothing
      close, but not equal                     almost always a slip — say so

    Returns `(written, meant)` pairs, and only ever asks: two real people can
    have names one character apart, so a build must not fail on this.
    """
    fold = lambda s: re.sub(r"\s+", "", (s or "")).lower()
    names = [p["name"] for p in people]
    # Keywords are facts, not aliases, but the aliases that do get written land
    # there — a nickname, a romanised spelling, a title all sit in one cell.
    # Matching them exactly is what stops a nickname being reported as a
    # misspelling of the formal name.
    known = {fold(n) for n in names} | {fold(k) for p in people for k in p["keywords"]}

    said = set()
    for e in entities:
        # `related` carries ids and person names in one column. Ids are lowercase
        # slugs and must already resolve, so anything slug-shaped is not a person.
        said |= {r for r in e["related"]
                 if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", r)}
    for row in list(events) + list(work):
        said |= set(row["people"])

    out = set()
    for name in said:
        if fold(name) in known:
            continue
        near = difflib.get_close_matches(name, names, n=1, cutoff=CLOSE)
        if near:
            out.add((name, near[0]))
    return sorted(out)
