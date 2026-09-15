"""`Data/workout.csv` — home training, one row per exercise.

    when,exercise,muscles,sets,reps,kg,minutes,effort
    2026-08-05 21:00,push-ups,chest; triceps; shoulders,4,15,,,moderate

`muscles` is semicolon-separated and its words are the diagram's own keys, which
is the whole join: the body map colours a region because a row named it. A key
the map does not know is reported rather than dropped, the same way an unmatched
ingredient is — a typo that silently greys out a muscle is the failure worth
catching.

`kg` is blank for bodyweight work. `minutes` is for work that is not counted in
sets — thirty minutes of squats done on and off across an evening is a duration,
and forcing it into a set count would invent a number. A row carries one or the
other. `effort` is light / moderate / hard, the user's own word for the session
and never anything computed from sets and reps; blank means they did not say.
"""
import csv

from core.vault import VAULT

# The regions the figures draw. The reader owns this list so the build can say
# which rows name something that will never light up.
MUSCLES = ["chest", "shoulders", "biceps", "triceps", "forearms", "abs", "obliques",
           "traps", "lats", "lower back", "glutes", "quads", "adductors", "hamstrings",
           "calves"]


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def read_workout():
    """Sets oldest first, and the muscle names no figure can show.

    Returns (rows, unknown muscle names).

    Asks: have I trained, when did I last work out, what did I train, how late do I train,
    which muscles are rested, am I exercising enough.

    Written for the question rather than the code, because this is what a
    lookup matches a person's words against — the `aka` column's job, done
    for a function. See `_evals/advice.py`.
    """
    f = VAULT / "Data" / "workout.csv"
    if not f.exists():
        return [], []
    rows, unknown = [], set()
    for r in csv.DictReader(f.open()):
        when = (r.get("when") or "").strip()
        if not when:
            continue
        muscles = [m.strip().lower() for m in (r.get("muscles") or "").split(";") if m.strip()]
        unknown |= {m for m in muscles if m not in MUSCLES}
        rows.append({"when": when,
                     "exercise": (r.get("exercise") or "").strip(),
                     "muscles": muscles,
                     "sets": num(r.get("sets")), "reps": num(r.get("reps")),
                     "kg": num(r.get("kg")), "minutes": num(r.get("minutes")),
                     "effort": (r.get("effort") or "").strip().lower()})
    return sorted(rows, key=lambda r: r["when"]), sorted(unknown)
