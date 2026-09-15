"""What the daily supplement regimen adds up to, against published limits.

Three files, and the split is the same one `intake.csv` makes against
`ingredients.csv`: **nothing here stores a computed total.**

    supplements.csv           one row per product — and how many units are
                              taken morning and evening. The regimen.
    supplement-nutrients.csv  product x nutrient, per ONE unit. The label.
    nutrient-limits.csv       nutrient -> RDA and Tolerable Upper Intake
                              Level. The reference.

Correcting one label row moves every day it ever applied to, which is only
true because the arithmetic happens here rather than being written down.

**Two reference columns, not one.** Several DRIs differ by sex, and iron
differs by nearly a factor of two. A vault does not get to decide which
reference applies to the person keeping it, so both are carried and the page
prints the band. That is a question for a clinic, and the file says so in the
`basis` cell rather than quietly picking one.

**`ul` is the column that answers the question actually being asked.** An RDA
is a floor — the amount below which deficiency becomes likely. The Tolerable
Upper Intake Level is the ceiling, the highest chronic daily intake likely to
pose no risk. "Is this doing damage" is a UL question, and a nutrient with no
UL set is not thereby safe at any dose; it means the evidence was too thin to
place one, which the page prints as "none set" rather than as a blank.
"""
import csv

from core.vault import VAULT

TIMINGS = ["morning", "evening"]


def num(v):
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return None


def _rows(name):
    f = VAULT / "Data" / name
    return list(csv.DictReader(f.open())) if f.exists() else []


def supplements():
    """(products, nutrient totals joined to limits, nutrients with no limit row).

    A product whose `doses_from` is not `stated` is carrying the label's own
    suggested intake rather than what is actually swallowed, and every total it
    contributes to is provisional until someone says otherwise. That travels
    with the numbers instead of being a footnote, because a page that cannot
    tell the two apart is a page that quietly invents a regimen.

    Asks: what am I taking, should I take more or less of something, am I near a ceiling,
    is a dose safe, what does the regimen add up to.

    Written for the question rather than the code, because this is what a
    lookup matches a person's words against — the `aka` column's job, done
    for a function. See `_evals/advice.py`.
    """
    prods = {}
    for r in _rows("supplements.csv"):
        pid = (r.get("id") or "").strip()
        if not pid:
            continue
        prods[pid] = {
            "id": pid,
            "product": (r.get("product") or "").strip(),
            "brand": (r.get("brand") or "").strip(),
            "form": (r.get("form") or "").strip(),
            "url": (r.get("url") or "").strip(),
            "morning": num(r.get("morning")) or 0,
            "evening": num(r.get("evening")) or 0,
            # Not everything is daily. Half a pill every three days is a real
            # regimen and the UL it is being compared against is a *chronic
            # daily* ceiling, so the honest comparison is the average — with
            # the cadence printed beside it, because 15 mg every third day and
            # 5 mg every day are the same average and not the same thing.
            "every": num(r.get("every_days")) or 1,
            "stated": (r.get("doses_from") or "").strip() == "stated",
            "basis": (r.get("label_basis") or "").strip(),
            "nutrients": [],
        }

    limits = {}
    for r in _rows("nutrient-limits.csv"):
        n = (r.get("nutrient") or "").strip()
        if n:
            limits[n] = {"unit": (r.get("unit") or "").strip(),
                         "rda_f": num(r.get("rda_female")),
                         "rda_m": num(r.get("rda_male")),
                         "ul": num(r.get("ul")),
                         "basis": (r.get("basis") or "").strip()}

    totals, unknown = {}, set()
    for r in _rows("supplement-nutrients.csv"):
        pid, n = (r.get("id") or "").strip(), (r.get("nutrient") or "").strip()
        per = num(r.get("amount"))
        if pid not in prods or not n or per is None:
            continue
        unit = (r.get("unit") or "").strip()
        p = prods[pid]
        p["nutrients"].append({"nutrient": n, "amount": per, "unit": unit})
        if n not in limits:
            unknown.add(n)
        t = totals.setdefault(n, {"nutrient": n, "unit": unit, "morning": 0.0,
                                  "evening": 0.0, "parts": [], "provisional": False,
                                  "averaged": False})
        for when in TIMINGS:
            t[when] += per * p[when] / p["every"]
        if p["every"] != 1:
            t["averaged"] = True
        # Who put it there, and how much of it. A row saying a ceiling is
        # exceeded and not which bottle did it is a fact you cannot act on —
        # the answer is always "one of these eleven" and the page knows which.
        units = p["morning"] + p["evening"]
        if units:
            t["parts"].append({"id": p["id"], "product": p["product"],
                               "brand": p["brand"], "form": p["form"],
                               "per": per, "units": units, "every": p["every"],
                               "amount": per * units / p["every"]})
        if not p["stated"] and (p["morning"] or p["evening"]):
            t["provisional"] = True

    out = []
    for n, t in totals.items():
        lim = limits.get(n, {})
        total = t["morning"] + t["evening"]
        ul = lim.get("ul")
        for part in t["parts"]:
            part["share"] = round(part["amount"] / total * 100) if total else 0
        t["parts"].sort(key=lambda q: -q["amount"])
        out.append({**t, "total": total,
                    "rda_f": lim.get("rda_f"), "rda_m": lim.get("rda_m"),
                    "ul": ul, "limitBasis": lim.get("basis", ""),
                    # Share of the ceiling, which is the only ratio that speaks
                    # to harm. None where no UL exists, and the page must say
                    # "none set" rather than draw an empty bar at zero.
                    "pctUl": round(total / ul * 100) if ul else None,
                    "overUl": bool(ul and total > ul)})
    # Worst first: over the ceiling, then closest to it, then everything with
    # no ceiling to be near.
    out.sort(key=lambda r: (-(r["pctUl"] or -1), r["nutrient"]))
    for p in prods.values():
        p["blank"] = not p["nutrients"] and bool(p["morning"] or p["evening"])
    return list(prods.values()), out, sorted(unknown)
