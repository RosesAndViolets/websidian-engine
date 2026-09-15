"""Nights, as clock times rather than durations."""
import csv
import re

from core.vault import VAULT

HHMM = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


def minutes(v):
    """`HH:MM` as minutes past midnight, or None. Returning None rather than 0
    matters here: midnight is a real bedtime and 0 is its honest value, so a
    blank cell has to be distinguishable from one."""
    m = HHMM.match((v or "").strip())
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def read_sleep():
    """`Data/sleep.csv` — one row per night, dated by the morning you got up.

    `to_bed` and `woke` are clock times and the night is the arc between them, so
    a bedtime after midnight needs no special case: the length is the difference
    modulo a day. `woke_at` is a `;`-separated list of the times you surfaced in
    between, not a count — the count is derivable from the times and the times
    are not derivable from the count, and the interruptions are the thing this
    page is actually about.

    Returns (rows oldest first, rows dropped for an unreadable time).

    Asks: how am I sleeping, how much sleep did I get, what time do I go to bed and wake,
    do I wake in the night, am I rested, am I a morning person.

    Written for the question rather than the code, because this is what a
    lookup matches a person's words against — the `aka` column's job, done
    for a function. See `_evals/advice.py`.
    """
    f = VAULT / "Data" / "sleep.csv"
    if not f.exists():
        return [], []
    out, bad = [], []
    for r in csv.DictReader(f.open()):
        date = (r.get("date") or "").strip()
        bed, up = minutes(r.get("to_bed")), minutes(r.get("woke"))
        if not date:
            continue
        if bed is None or up is None:
            bad.append(date or "(no date)")
            continue
        woke_at = [t for t in ((r.get("woke_at") or "").split(";")) if minutes(t) is not None]
        out.append({"date": date, "bed": bed, "up": up,
                    # Modulo a day, so 23:30 -> 07:00 is 7.5 h and 00:00 -> 07:48
                    # is 7.8 h without either branch being written down.
                    "hours": round(((up - bed) % 1440) / 60, 2),
                    "wokeAt": [minutes(t) for t in woke_at],
                    "note": (r.get("note") or "").strip()})
    return sorted(out, key=lambda r: r["date"]), bad
