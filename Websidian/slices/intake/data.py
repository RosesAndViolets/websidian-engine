"""The intake reference, the log, and the join between them."""
import csv
import re

from core.vault import VAULT


def num(v):
    """A blank or unparseable number reads as 0 rather than killing the build — a
    hand-editable CSV will have a typo in it eventually, and losing one value
    beats losing the whole page."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


# Columns of ingredients.csv that describe the row rather than its nutrition.
# Everything else is treated as a per-100 g nutrient, so adding a `sodium` or
# `sugar` column is all it takes to get a meter for it — no code change.
NOT_NUTRIENTS = {"ingredient", "aka", "basis", "added", "portion_g"}


def read_ingredients():
    """`Data/ingredients.csv` — per 100 g, keyed by name. Every nutrition number in
    the vault comes from here, so the same food scores the same on every day it
    appears. Returns (reference, nutrient names in column order)."""
    f = VAULT / "Data" / "ingredients.csv"
    if not f.exists():
        return {}, []
    rows = list(csv.DictReader(f.open()))
    if not rows:
        return {}, []
    nutrients = [c for c in rows[0] if c and c not in NOT_NUTRIENTS]
    ref = {}
    for r in rows:
        name = (r.get("ingredient") or "").strip()
        if name:
            ref[name] = {k: num(r.get(k)) for k in nutrients}
    return ref, nutrients


def ingredient_table():
    """Every reference food as the browser needs it to price one that has *not*
    been eaten yet — what On record's simulator adds to today's figures.

    Three things beyond the per-100 g numbers. The aliases, because a food is
    searched for in whichever language comes to hand and `계란` has to be findable
    by typing `egg`. The portion weight, because "two eggs" is a count and every
    number in this vault is a weight — without it a count cannot be converted and
    the simulator says so rather than guessing. And the name, sorted, so the
    datalist reads alphabetically.

    Re-reads the file rather than widening `read_ingredients()`: that returns a
    per-100 g reference, `portion_g` is not per 100 g of anything, and three call
    sites would have had to learn a third return value to carry it.
    """
    f = VAULT / "Data" / "ingredients.csv"
    if not f.exists():
        return []
    rows = list(csv.DictReader(f.open()))
    if not rows:
        return []
    nutrients = [c for c in rows[0] if c and c not in NOT_NUTRIENTS]
    out = []
    for r in rows:
        name = (r.get("ingredient") or "").strip()
        if not name:
            continue
        out.append({"name": name, "portion": num(r.get("portion_g")),
                    "aka": [a.strip() for a in (r.get("aka") or "").split(";") if a.strip()],
                    **{k: num(r.get(k)) for k in nutrients}})
    return sorted(out, key=lambda x: x["name"])


def ingredient_conflicts():
    """Two rows for one food is the failure a multilingual log invites: the same
    thing written in Korean one week and English the next scores twice, from two
    sets of numbers, and nothing complains.

    Neither check needs judgement, which is the point — discipline is what fails
    six months later:

    `collision` — a name is a row's key *and* sits in another row's `aka`. That is
    unambiguous; one of them has to go.
    `twin` — rows whose per-100 g numbers are identical and that are not already
    linked by `aka`. Sometimes legitimate (two oils really are both pure fat), so
    it is a question to answer, not an error.
    """
    f = VAULT / "Data" / "ingredients.csv"
    if not f.exists():
        return [], []
    rows = list(csv.DictReader(f.open()))
    if not rows:
        return [], []
    nutrients = [c for c in rows[0] if c and c not in NOT_NUTRIENTS]
    fold = lambda s: re.sub(r"\s+", "", (s or "")).lower()
    aliases = {}                       # folded alias -> the row that claims it
    for r in rows:
        for a in (r.get("aka") or "").split(";"):
            if a.strip():
                aliases.setdefault(fold(a), r["ingredient"])

    collision = sorted({(r["ingredient"], aliases[fold(r["ingredient"])]) for r in rows
                        if fold(r["ingredient"]) in aliases
                        and aliases[fold(r["ingredient"])] != r["ingredient"]})

    by_name = {r["ingredient"]: r for r in rows}
    linked = lambda a, b: fold(b) in {fold(x) for x in
                                      (by_name[a].get("aka") or "").split(";")}
    groups = {}
    for r in rows:
        if any(num(r.get(k)) for k in nutrients):
            groups.setdefault(tuple(round(num(r.get(k)), 1) for k in nutrients),
                              []).append(r["ingredient"])
    twin = [sorted(names) for names in groups.values() if len(names) > 1
            and not all(linked(names[0], n) for n in names[1:])]
    return collision, sorted(twin)


def read_targets():
    """The daily target per metric, with the running phase's numbers on top.

    `Data/targets.csv` is the base — one target per metric, and what the site
    used before there was a cycle. A phase that is running may override any of
    them, because a cut and a bulk are the same person eating to two different
    numbers, and every meter on the site asks for "the kcal target" without
    wanting to know that.

    **Overriding rather than replacing.** A phase states only what it changes;
    anything it leaves blank keeps the base value. That is what makes the bulk
    row legal with no kcal in it — the number has not been decided, and
    inheriting the base target would be the site inventing a surplus nobody
    chose.

    Asks: what am I aiming for, how many calories should I have, what is the daily target,
    how much is left today, what is the goal weight or ratio.

    Written for the question rather than the code, because this is what a
    lookup matches a person's words against — the `aka` column's job, done
    for a function. See `_evals/advice.py`.
    """
    f = VAULT / "Data" / "targets.csv"
    base = {}
    if f.exists():
        base = {(r.get("metric") or "").strip(): num(r.get("target"))
                for r in csv.DictReader(f.open()) if (r.get("metric") or "").strip()}
    live = active_phase()
    if live:
        for metric in ("kcal", "protein", "fat", "carbs"):
            if live.get(metric):
                base[metric] = live[metric]
        # The weight target follows the phase it is in. Left alone it is a
        # leftover from before the cycle — 60 kg, which is neither end of it.
        if live.get("to_kg"):
            base["weight"] = live["to_kg"]
    return base


def read_phases():
    """`Data/phases.csv` — the weight cycle, one row per phase, in order.

        phase,kind,from_kg,to_kg,rate_lo,rate_hi,kcal,protein,fat,carbs,
        started,ended,blocked,note

    A plan rather than a log. `weight.csv` records what happened; this records
    what was meant to, and the distance between them is the only thing on the
    Health rail worth alarming about.

    **The rate is the substance, not the target.** Both bounds are kg per week
    for every kind of phase, including a bulk stated in kg per month — one unit
    means one corridor formula, and a phase that carries its own unit would put
    the conversion in the renderer where nobody would find it. `rate_lo` is the
    gentler bound and `rate_hi` the one it is dangerous to exceed, whichever
    direction the weight is moving.

    A row with no `started` has not begun; a row with `ended` is done. At most
    one row should have a `started` and no `ended`, and `active_phase()` takes
    the last such row rather than asserting it, so a half-edited file renders
    the current phase instead of failing the build.

    Asks: am I cutting or bulking, what phase am I in, how fast should I be losing or gaining,
    what is the safe rate, when does this finish, what is the plan.

    Written for the question rather than the code, because this is what a
    lookup matches a person's words against — the `aka` column's job, done
    for a function. See `_evals/advice.py`.
    """
    f = VAULT / "Data" / "phases.csv"
    if not f.exists():
        return []
    out = []
    for r in csv.DictReader(f.open()):
        name = (r.get("phase") or "").strip()
        if not name:
            continue
        row = {"phase": name, "kind": (r.get("kind") or "").strip().lower(),
               "note": (r.get("note") or "").strip(),
               "blocked": (r.get("blocked") or "").strip()}
        for k in ("from_kg", "to_kg", "rate_lo", "rate_hi",
                  "kcal", "protein", "fat", "carbs"):
            row[k] = num(r.get(k))
        for k in ("started", "ended"):
            row[k] = (r.get(k) or "").strip()
        out.append(row)
    return out


def active_phase():
    """The phase that is running: started, not ended. `{}` when none is."""
    live = [p for p in read_phases() if p["started"] and not p["ended"]]
    return live[-1] if live else {}


# The tape measurements, and what each one is for. Ordered as drawn, and the
# order is deliberate: the two that make the ratio come first, then the two that
# make the difference, then the ones with a single reading behind them.
METRICS = ["waist", "hip", "bust", "underbust", "shoulder", "thigh"]


def read_measurements():
    """`Data/measurements.csv` — dated tape readings, long rather than wide.

        date,metric,cm,note

    Long because the record is sparse and always will be: the 2024 rows carry a
    waist and a hip and nothing else, the 2025-11 rows carry a bust and an
    underbust and nothing else. A wide table would hold a grid of blanks and
    would need a new column the first time a new thing is measured.

    **This is the only rail that can see what the cycle is for.** Weight cannot
    distinguish five kilos that went to the hips from five that went to the
    waist — they are the same line. Waist over hip separates them, and the
    record already contains one instance: between 2025-08-25 and 2025-11-07 the
    waist held at 69 while the hip fell 91 to 89, so the ratio moved away from
    goal while the weight went down.

    A reading given as a range in the original note is stored as its midpoint,
    with the range kept in `note` — the alternative is a lo/hi pair on every row
    to serve the three that need one.

    Returns (by-date dict of metric -> cm, notes by "date/metric", unknowns).

    Asks: what are my measurements, waist hip bust underbust thigh shoulder, what is the
    waist-to-hip ratio, is my shape changing, what does the tape say.

    Written for the question rather than the code, because this is what a
    lookup matches a person's words against — the `aka` column's job, done
    for a function. See `_evals/advice.py`.
    """
    f = VAULT / "Data" / "measurements.csv"
    if not f.exists():
        return {}, {}, []
    out, notes, unknown = {}, {}, set()
    for r in csv.DictReader(f.open()):
        date = (r.get("date") or "").strip()
        metric = (r.get("metric") or "").strip().lower()
        if not date or not metric:
            continue
        if metric not in METRICS:
            unknown.add(metric)
            continue
        out.setdefault(date, {})[metric] = num(r.get("cm"))
        if (r.get("note") or "").strip():
            notes[f"{date}/{metric}"] = r["note"].strip()
    return dict(sorted(out.items())), notes, sorted(unknown)


def read_weight():
    """`Data/weight.csv` — dated weigh-ins, oldest first.

    A log rather than a single number, so the first row is where this started
    and the last is where it is now; the target is the `weight` row of
    targets.csv. One row is enough to draw the bar — a second makes it a trend.

    Asks: how much do I weigh, have I lost or gained, am I heavier or lighter, what does the
    scale say, am I losing too fast, what rate am I going at, is the weight trending.

    Written for the question rather than the code, because this is what a
    lookup matches a person's words against — the `aka` column's job, done
    for a function. See `_evals/advice.py`.
    """
    f = VAULT / "Data" / "weight.csv"
    if not f.exists():
        return []
    rows = [{"date": (r.get("date") or "").strip(), "kg": num(r.get("kg"))}
            for r in csv.DictReader(f.open()) if (r.get("date") or "").strip()]
    return sorted(rows, key=lambda r: r["date"])


def read_recipes():
    """`Data/recipes.csv` — dish, ingredient, grams — scored off the same per-100 g
    reference the log uses, so a recipe and a meal made of it cannot disagree.

    Unmatched names score zero here exactly as they do in the log, and are named
    on the row rather than silently dropped.
    """
    f = VAULT / "Data" / "recipes.csv"
    if not f.exists():
        return []
    ref, nutrients = read_ingredients()
    dishes = {}
    for r in csv.DictReader(f.open()):
        dish = (r.get("dish") or "").strip()
        name = (r.get("ingredient") or "").strip()
        if not dish or not name:
            continue
        grams = num(r.get("grams"))
        per100 = ref.get(name)
        d = dishes.setdefault(dish, {"dish": dish, "items": [], "unknown": [],
                                     **{k: 0 for k in nutrients}})
        if per100 is None:
            d["unknown"].append(name)
            per100 = {k: 0 for k in nutrients}
        for k in nutrients:
            d[k] += per100.get(k, 0) * grams / 100
        d["items"].append({"ingredient": name, "grams": round(grams)})
    return [{**d, **{k: round(d[k]) for k in nutrients}}
            for d in sorted(dishes.values(), key=lambda d: d["dish"])]


def read_intake():
    """Meals oldest first, macros computed by joining `Data/intake.csv` grams against
    the per-100 g reference. Both files are written by a Claude session, never by the
    server — the site only captures raw text into `Inbox/Intake/`.

    Nothing is stored pre-computed, so correcting one reference row fixes every past
    day. The cost of a join is that a log name with no reference row silently scores
    zero, so unmatched names come back alongside the meals to be shown, not swallowed.

    Asks: what did I eat, what have I been eating, how many calories, am I over or under,
    what are my macros today, protein fat carbs, what did I have for dinner.

    Written for the question rather than the code, because this is what a
    lookup matches a person's words against — the `aka` column's job, done
    for a function. See `_evals/advice.py`.
    """
    f = VAULT / "Data" / "intake.csv"
    if not f.exists():
        return [], [], []
    ref, nutrients = read_ingredients()
    meals, unknown = {}, set()
    for r in csv.DictReader(f.open()):
        when, name = (r.get("when") or "").strip(), (r.get("ingredient") or "").strip()
        if not when or not name:
            continue
        meal = (r.get("meal") or "").strip()
        grams = num(r.get("grams"))
        per100 = ref.get(name)
        if per100 is None:
            unknown.add(name)
            per100 = {k: 0 for k in nutrients}
        # `source` is "manual" for a row the quick-log UI wrote directly and blank
        # for everything /vault-intake produced — the one group's rows are always
        # written together, so the first row settles it for the whole meal.
        m = meals.setdefault((when, meal), {"when": when, "meal": meal, "items": [],
                                            "source": (r.get("source") or "").strip(),
                                            **{k: 0 for k in nutrients}})
        for k in nutrients:
            m[k] += per100.get(k, 0) * grams / 100
        m["items"].append({"ingredient": name, "grams": round(grams),
                           "kcal": round(per100.get("kcal", 0) * grams / 100)})
    rows = [{**m, **{k: round(m[k]) for k in nutrients}}
            for m in sorted(meals.values(), key=lambda m: m["when"])]
    return rows[-400:], sorted(unknown), nutrients


def read_favorites():
    """`Data/favorites.csv` — a food or dish tagged as a favourite *for a slot*
    (Breakfast/Lunch/...), not favourited in general. The same food can be a
    favourite under more than one slot, as one row each — that is what lets
    the quick-log popup filter "what is this favourited as".
    """
    f = VAULT / "Data" / "favorites.csv"
    if not f.exists():
        return []
    out = []
    for r in csv.DictReader(f.open()):
        kind, key = (r.get("kind") or "").strip(), (r.get("key") or "").strip()
        slot = (r.get("slot") or "").strip()
        if kind and key and slot:
            out.append({"kind": kind, "key": key, "slot": slot,
                        "added": (r.get("added") or "").strip()})
    return out

