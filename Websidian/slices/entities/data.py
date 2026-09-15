"""`Data/entities.csv` — the things captures refer to obliquely, given names.

    id,kind,name,aka,when,related,note,added

Reference, not log. It is to "the keyring from the business trip" what
`ingredients.csv` is to "some chicken": the place a loose phrase resolves to
something stable. Narrative stays where it already lives — `events.csv` holds
what happened on the trip, this holds only that the trip exists, what it is
called, and what it is attached to.

`aka` is the column that earns the file. The captures are Korean, Japanese and
English, often inside one sentence — `ingredients.csv` already carries
`계란 -> egg; 卵; たまご` for exactly this reason, and a trip needs it just as
much: 사원여행, 社員旅行 and "that work trip" are one thing and no substring
search connects them. Every alias written here is one a future query no longer
has to guess.

`related` is what makes the keyring resolvable at all. Similarity ranks things
that *sound* alike, which is useless when three trips all mention a keyring;
a link is an answer rather than a ranking. Values are entity ids or names as
written in `people.csv`, because half of what a thing attaches to is a person
and nobody is going to invent an id for their manager.

A link may carry **how it was made**, written after a colon — `kanazawa:said`.
Two links that render identically can have come from opposite places: one
because a capture said so, one because a session read two rows and joined them.
The second is a guess with a link's confidence, and once it is in the table
nothing distinguishes it from a fact — least of all `retrieval.py`, which scores
the `relational` class off exactly these edges and cannot tell that half of what
it is crediting was invented here. The mark is per edge and not per row because
one row routinely holds both.

**A bare link means nobody recorded it, and that is a third state, not a
default.** The rows that predate this column say nothing rather than claiming
`said`, because backfilling a confident value onto an edge whose origin is gone
is the one failure this column exists to prevent.

`when` is a day, a `start..end` range, or `start..` for something still running.
One column rather than two: unlike an event, most entities have no date at all,
and a place never will.

Deliberately not enforced here: that everything in `events.csv` has a row. Most
events are never referred to again and cost nothing by staying prose. A row is
earned by being mentioned a second time, in words that did not match the first.
"""
import csv

from core.vault import VAULT

KINDS = ["trip", "event", "place", "item", "project", "org", "topic", "knowledge"]

# How an edge got there. Two values, because the only distinction worth the
# keystrokes is whether a person asserted the link or a session concluded it —
# anything finer (which capture, which day) describes a file that gets deleted
# once it is processed, and would be unverifiable a week later.
VIA = {
    "said": "stated in a capture — the connection came from you",
    "inferred": "concluded while processing; nothing said it outright",
}


def edges(cell):
    """`"kanazawa:said; 田中さん"` -> `(["kanazawa", "田中さん"], {"kanazawa": "said"})`.

    Refs come back exactly as they always did, so everything that reads the
    column — the id gate, `misspelt_people`, the retrieval index — keeps working
    on a plain list and never has to learn the syntax. A colon cannot occur in
    an id (`[a-z0-9-]` only, enforced) and does not occur in a name anyone
    writes, which is what makes the suffix free rather than a new column.
    """
    refs, via = [], {}
    for part in (cell or "").split(";"):
        ref, _, mark = part.strip().partition(":")
        ref, mark = ref.strip(), mark.strip()
        if not ref:
            continue
        refs.append(ref)
        if mark:
            via[ref] = mark
    return refs, via


def read_entities():
    f = VAULT / "Data" / "entities.csv"
    if not f.exists():
        return []
    rows = []
    for r in csv.DictReader(f.open()):
        eid = (r.get("id") or "").strip()
        name = (r.get("name") or "").strip()
        if not eid or not name:
            continue
        refs, via = edges(r.get("related"))
        rows.append({
            "id": eid,
            "kind": (r.get("kind") or "").strip(),
            "name": name,
            "aka": [a.strip() for a in (r.get("aka") or "").split(";") if a.strip()],
            "when": (r.get("when") or "").strip(),
            "related": refs,
            # Kept beside `related` rather than folded into it: a projection of
            # one cell, parsed once, so no consumer has to carry a shape it has
            # no use for. A ref missing here is unrecorded, never `said`.
            "via": via,
            "note": (r.get("note") or "").strip(),
            "added": (r.get("added") or "").strip(),
        })
    order = {k: i for i, k in enumerate(KINDS)}
    return sorted(rows, key=lambda e: (order.get(e["kind"], len(order)), e["kind"], e["name"]))


def names_of(entity):
    """Every string this entity answers to — what a query is matched against."""
    return [entity["name"]] + entity["aka"]
