"""`Data/spend.csv` joined to `Data/spend-categories.csv`, per month.

The log holds what the bank said: a date, a merchant, a signed yen amount and
which rail it came down. Nothing in it says whether a thing was worth buying.
That judgement lives entirely in the rule table, and it is applied at build
time — so deciding next year that eating out is a necessity moves every month
back to 2025 with it, the same way correcting one row of `ingredients.csv`
re-scores every meal that ever used it.

Three tiers decide a row's class, and which tier answered is kept:

    rule  a row of spend-categories.csv matched the merchant
    mf    nothing matched, so Money Forward's own 大項目 was used
    none  neither — the row is counted as uncategorised, out loud

Tier `mf` is not trusted, it is *inherited*. Most of this history was bulk
imported from credit-card CSVs into an account that had no rules yet, so 大項目
is frequently a guess made from the same merchant string a rule would read. It
earns its place only because the alternative for a merchant seen once is to
drop the money on the floor. `classified()` reports the split, and a month
where inheritance dominates is a month to read as a shape rather than a number.

**Coverage is the signal that matters here, not unknown merchants.** A missing
rule shows up as an uncategorised total on the page — visible, and annoying
enough to fix. An account that was not yet linked shows up as a *low month*,
which reads exactly like a frugal one. 2022 to 2024 hold nothing but Amazon
order history; the card arrives in 2025-01 and only becomes continuous in
2025-04; five more accounts arrive in 2026. So `coverage()` marks every month
by whether the primary rail was reporting, and the page refuses to draw a trend
across the months where it was not.
"""
import collections
import csv
import datetime
import math

from core.vault import VAULT

# The rail that carries most spending, and therefore the one whose silence
# means "no data" rather than "no spending". It is a constant rather than a
# column because there is exactly one such account and guessing which it is
# from row counts would quietly change answer as the data grows.
PRIMARY = "メインカード"   # an instance sets this to its own card, as MF names it

# How many times the primary rail has to report before a month counts as
# covered. Presence alone is not enough: the card's first two months carry one
# and two rows, which is a card that exists rather than a month that was
# recorded, and drawn on a chart beside a forty-row month it reads as thrift.
# Five is where this data's own gap falls — 1, 2, then 38.
MIN_ROWS = 5

# Salary and remittances only exist where a bank account is reporting. A card
# is never told about them, so a month can have complete spending and no income
# at all — which on a net line reads as catastrophe rather than as absence.
# These are the two rails income arrives on, and income is shown only where one
# of them was live.
INCOME_ACCOUNTS = {"メイン銀行", "サブ銀行"}   # an instance names its own banks here

CLASSES = ["necessity", "luxury", "investment", "income", "transfer"]

# Money Forward's own categories, mapped to a class for the fallback tier.
# 未分類 and その他 are deliberately absent: MF assigns them when it has no
# idea, and inheriting "no idea" as a class would launder a gap into a number.
MF_CLASS = {
    "食費": "necessity", "日用品": "necessity", "通信費": "necessity",
    "水道・光熱費": "necessity", "交通費": "necessity", "健康・医療": "necessity",
    "住宅": "necessity", "税・社会保障": "necessity",
    "衣服・美容": "luxury", "趣味・娯楽": "luxury", "交際費": "luxury",
    "特別な支出": "luxury",
    "教養・教育": "investment",
    "現金・カード": "transfer",
    "収入": "income",
}

# 外食 is the one subcategory that overrides its parent: 食費 is a necessity,
# but eating out is the single line the necessity/luxury split exists to draw.
MF_MINOR_CLASS = {"外食": "luxury"}

# An inherited row names its bucket after MF's own subcategory, which means the
# same money can land in two buckets depending on which tier answered — the
# remittances split into `remittance` and `仕送り` doing exactly that. These are
# the collisions worth spelling out; anything not listed keeps MF's name, which
# is the honest label for a row nothing else could name.
BUCKET_ALIAS = {"仕送り": "remittance", "給与": "salary"}


def read_rules():
    """The rule table, longest match first.

    Sorted by match length so the specific rule wins: `振込 カ)アクメ` and
    `振込2 カ)アクメ` are different money, and a shorter rule that happened to
    be written first must not swallow the longer one.
    """
    f = VAULT / "Data" / "spend-categories.csv"
    if not f.exists():
        return []
    rules = []
    for r in csv.DictReader(f.open()):
        match = (r.get("match") or "").strip()
        if not match or match.startswith("#"):
            continue
        rules.append({"match": match,
                      "bucket": (r.get("bucket") or "").strip(),
                      "class": (r.get("class") or "").strip().lower(),
                      "fixed": (r.get("fixed") or "0").strip() == "1",
                      "note": (r.get("note") or "").strip()})
    return sorted(rules, key=lambda r: -len(r["match"]))


def classify(row, rules):
    """`(bucket, class, fixed, source)` for one row.

    Matched against the raw description as well as the cleaned merchant, which
    is what makes the Amazon rows reachable: they all share the merchant
    `Amazon` and differ only in `raw`, so a rule naming a product is the only
    way to say that the whey protein was food and the pizza oven was not.
    Case-folded because the same shop arrives as both `AMAZON.CO.JP` and
    `Amazon`, and two spellings of one rule is a rule that silently half-works.
    """
    hay = (row["merchant"] + "\n" + row["raw"]).lower()
    for rule in rules:
        if rule["match"].lower() in hay:
            return rule["bucket"], rule["class"], rule["fixed"], "rule"
    cls = MF_MINOR_CLASS.get(row["minor"]) or MF_CLASS.get(row["major"])
    if cls:
        name = row["minor"] or row["major"]
        return BUCKET_ALIAS.get(name, name), cls, False, "mf"
    return "", "", False, "none"


def read_spend():
    """Every row of the log, classified, oldest first.

    `calc=0` and `transfer=1` are Money Forward's own exclusions and are
    honoured — those are the rows where it correctly matched a card charge to
    an itemised source, and counting both sides is how a card bill becomes a
    second month of groceries. The rows it got *wrong* are the 振込 between
    accounts, which it left unflagged; those are caught by the rule table's
    `transfer` class instead, which is why that class exists.
    """
    f = VAULT / "Data" / "spend.csv"
    if not f.exists():
        return []
    rules = read_rules()
    rows = []
    for r in csv.DictReader(f.open()):
        date = (r.get("date") or "").strip()
        if not date:
            continue
        try:
            amount = int(r.get("amount") or 0)
        except ValueError:
            continue
        row = {"date": date, "merchant": (r.get("merchant") or "").strip(),
               "amount": amount, "account": (r.get("account") or "").strip(),
               "major": (r.get("major") or "").strip(),
               "minor": (r.get("minor") or "").strip(),
               "raw": (r.get("raw") or "").strip(),
               "counted": (r.get("calc") or "1").strip() == "1"
                          and (r.get("transfer") or "0").strip() == "0"}
        row["bucket"], row["cls"], row["fixed"], row["source"] = classify(row, rules)
        rows.append(row)
    return sorted(rows, key=lambda r: r["date"])


def spendable(rows):
    """The rows that are actually somebody's money leaving or arriving —
    MF's own exclusions dropped, and the transfers it missed dropped too."""
    return [r for r in rows if r["counted"] and r["cls"] != "transfer"]


def coverage(rows):
    """Per month: which accounts reported, and whether the primary one did.

    A month that the primary rail did not report is not a cheap month, it is a
    month before the card was linked — and the whole point of computing this is
    that the two are indistinguishable from the totals alone.
    """
    months = collections.defaultdict(collections.Counter)
    for r in rows:
        months[r["date"][:7]][r["account"]] += 1
    return {m: {"accounts": sorted(a), "full": a[PRIMARY] >= MIN_ROWS,
                "income": bool(set(a) & INCOME_ACCOUNTS)}
            for m, a in sorted(months.items())}


def monthly(rows):
    """Per month, per class totals as positive yen, plus what was inherited.

    Amounts come out of the log signed and go onto the page as magnitudes,
    because a bar chart of negative numbers is a puzzle rather than a reading.
    """
    out = collections.defaultdict(lambda: collections.defaultdict(int))
    for r in spendable(rows):
        out[r["date"][:7]][r["cls"] or "uncategorised"] += abs(r["amount"])
        if r["amount"] < 0:
            out[r["date"][:7]]["_by_" + r["source"]] += abs(r["amount"])
    return {m: dict(v) for m, v in sorted(out.items())}


def buckets(rows, months=None):
    """Totals per bucket within each class, biggest first.

    `months` limits it to a window — the page uses the covered months, so a
    bucket total is never the sum of a period the data does not cover.
    """
    out = collections.defaultdict(lambda: collections.defaultdict(int))
    for r in spendable(rows):
        if months and r["date"][:7] not in months:
            continue
        out[r["cls"] or "uncategorised"][r["bucket"] or r["merchant"]] += abs(r["amount"])
    return {c: sorted(([b, v] for b, v in d.items()), key=lambda p: -p[1])
            for c, d in out.items()}


def fixed_spending(rows, months=None):
    """The `fixed=1` buckets, with how many months each was actually seen in.

    Count of months rather than an average, because a subscription that
    appeared twice in eight months is a fact worth showing rather than a
    number worth dividing.
    """
    seen = collections.defaultdict(lambda: {"total": 0, "months": set(), "merchants": set()})
    for r in spendable(rows):
        if not r["fixed"] or r["amount"] >= 0:
            continue
        if months and r["date"][:7] not in months:
            continue
        got = seen[r["bucket"] or r["merchant"]]
        got["total"] += abs(r["amount"])
        got["months"].add(r["date"][:7])
        got["merchants"].add(r["merchant"])
    return sorted(({"bucket": b, "total": v["total"], "months": len(v["months"]),
                    "merchants": sorted(v["merchants"])}
                   for b, v in seen.items()), key=lambda d: -d["total"])


def unclassified(rows, limit=12):
    """Merchants no rule matched and MF could not name, biggest first.

    This is the maintenance signal for this slice, and it is ranked by yen for
    the same reason the rule table was written that way: attention is finite and
    a ¥200,000 gap and a ¥400 one are not the same problem.
    """
    agg = collections.defaultdict(int)
    for r in spendable(rows):
        if r["source"] == "none" and r["amount"] < 0:
            agg[r["merchant"]] += abs(r["amount"])
    return [[m, v] for m, v in sorted(agg.items(), key=lambda kv: -kv[1])[:limit]]


def classified(rows, months=None):
    """What share of outgoing money each tier accounted for, as yen."""
    out = {"rule": 0, "mf": 0, "none": 0}
    for r in spendable(rows):
        if r["amount"] < 0 and not (months and r["date"][:7] not in months):
            out[r["source"]] += abs(r["amount"])
    return out


def by_medium(rows):
    """Per month and rail: what the rail was charged, and what this site counts.

    **Two numbers, because they are two questions and only one of them is on
    the statement.** `counted` is what every other figure on these pages is
    built from — Money Forward's own exclusions honoured, transfers between
    your own accounts dropped. `charged` is every outgoing row on the rail,
    which is what the card issuer's app or the bank passbook will show you.

    The gap between them is split by **who said so**, which is the only split
    the data actually supports:

        moved       something classified `transfer` — an ATM withdrawal, a card
                    bill paid out of a bank, a 振込 between your own accounts.
                    ¥60,000 out of the bank is not ¥60,000 spent, it is ¥60,000
                    now in a wallet
        elsewhere   Money Forward's own flag fired and nothing here named the
                    row. That is the ¥3,210 Amazon charge whose purchase arrives
                    itemised from Amazon's own history

    **Money Forward will not say which of the two it means.** It writes
    `transfer=1` on the matched Amazon charge, on the card bill and on the cash
    withdrawal alike — one flag for "this money is already accounted for
    somewhere else", never a reason. So `elsewhere` is named after the evidence
    rather than the cause, because a label like "matched to an itemised source"
    would send you hunting for an Amazon order to explain a withdrawal.

    A rail whose two figures agree is fully reconciled; a gap is a number with
    a source attached, and only a gap neither of these accounts for is a
    discrepancy worth opening the app for.

    Transfers count as charged: money genuinely left that account, and it is on
    the statement you are checking this against.
    """
    out = collections.defaultdict(lambda: collections.defaultdict(
        lambda: {"charged": 0, "counted": 0, "moved": 0, "elsewhere": 0, "n": 0}))
    for r in rows:
        if r["amount"] >= 0:
            continue
        cell = out[r["date"][:7]][r["account"] or "—"]
        cell["charged"] += abs(r["amount"])
        cell["n"] += 1
        # `transfer` is checked before the flag, because it is the one of the
        # two that knows *why*: it comes from the rule table or from MF's own
        # 現金・カード category, both of which name the row. The bare flag is
        # only reached by rows nothing else could explain.
        if r["counted"] and r["cls"] != "transfer":
            cell["counted"] += abs(r["amount"])
        elif r["cls"] == "transfer":
            cell["moved"] += abs(r["amount"])
        else:
            cell["elsewhere"] += abs(r["amount"])
    return {m: dict(a) for m, a in sorted(out.items(), reverse=True)}


def rails(rows):
    """Every account that ever spent, biggest first — the table's columns."""
    agg = collections.Counter()
    for r in rows:
        if r["amount"] < 0:
            agg[r["account"] or "—"] += abs(r["amount"])
    return [a for a, _ in agg.most_common()]


def transactions(rows):
    """Every row a month's detail might list, trimmed to what it draws.

    `raw` is dropped and it is the reason this fits: it holds the whole product
    title of an Amazon order and is most of the file's 210 KB. It earns its
    place in the CSV — the rule table matches against it, which is how one
    Amazon row is food and the next is not — but the page never prints it.

    `on` is whether this row is inside every other total on the site, so the
    detail can show an excluded row greyed rather than hide it. Hiding it is
    what makes a month look like it is missing something.
    """
    return [{"date": r["date"], "merchant": r["merchant"], "amount": r["amount"],
             "account": r["account"], "bucket": r["bucket"] or r["merchant"],
             "cls": r["cls"] or "uncategorised",
             "on": r["counted"] and r["cls"] != "transfer"}
            for r in rows]


def capacity(rows):
    """What a month leaves over, across the months both sides were reported.

    Income and spending are averaged over the *same* months on purpose. The
    covered window opens in 2025-04 and the earning window only in 2026-04, so
    an average of one over its window minus the other over its own would divide
    a year of card spending by four months of salary and call the difference a
    surplus. The intersection is short — it is also the only honest window.

    The spread is returned alongside the mean because at this sample size the
    mean is the least interesting number here: one month can run deep negative
    and another solidly positive, and a goal funded out of "the average"
    is being funded out of a month that never happened.
    """
    cover = coverage(rows)
    months = [m for m, c in cover.items() if c["income"] and c["full"]]
    per = monthly(rows)
    out = []
    for m in months:
        got = per.get(m, {})
        spent = sum(got.get(k, 0) for k in
                    ("necessity", "luxury", "investment", "uncategorised"))
        out.append({"month": m, "in": got.get("income", 0), "out": spent,
                    "net": got.get("income", 0) - spent})
    n = len(out) or 1
    return {"months": [d["month"] for d in out], "per": out,
            "income": sum(d["in"] for d in out) // n,
            "spend": sum(d["out"] for d in out) // n,
            "surplus": sum(d["net"] for d in out) // n,
            "worst": min((d["net"] for d in out), default=0),
            "best": max((d["net"] for d in out), default=0)}


def read_goals():
    """`Data/goals.csv` — what the money is being aimed at.

    Every amount is yen, including the ones quoted in won: the row carries the
    converted figure and says in its note what rate converted it. A currency
    column would need a rate table, a rate table needs updating, and a stale
    rate is a wrong number that looks maintained.

    A blank `cost` is the normal state of a goal here rather than a missing
    field — three of these cannot be priced until somebody can phone a clinic.
    `blocked` is what has to happen before the number can exist, and it is the
    only thing on such a card worth reading.
    """
    f = VAULT / "Data" / "goals.csv"
    if not f.exists():
        return []
    yen = lambda v: int(float(v)) if (v or "").strip() else 0
    out = []
    for r in csv.DictReader(f.open()):
        name = (r.get("goal") or "").strip()
        if not name or name.startswith("#"):
            continue
        out.append({"goal": name, "kind": (r.get("kind") or "").strip(),
                    "status": (r.get("status") or "planned").strip(),
                    "cost": yen(r.get("cost")), "saved": yen(r.get("saved")),
                    "monthly": yen(r.get("monthly")), "by": (r.get("by") or "").strip(),
                    "estimate": (r.get("estimate") or "").strip() == "1",
                    "blocked": (r.get("blocked") or "").strip(),
                    "note": (r.get("note") or "").strip()})
    return out


def month_after(months):
    """The YYYY-MM `months` from now — for an ETA, which is a month and never
    a day. Nothing here is precise to a day, and printing one would say it is."""
    d = datetime.date.today()
    n = d.year * 12 + d.month - 1 + months
    return "%04d-%02d" % (n // 12, n % 12 + 1)


def goals(rows):
    """The goals, each with what it still needs and when that lands.

    `committed` is what the active goals already claim of a month; `spare` is
    what is left for everything else.

    ponytail: a goal without a payment plan of its own is projected as if the
    whole spare went to it, so two such goals both quote the same month. Split
    the spare across them when there are two funded that way — right now there
    is one, and a share column nobody maintains would be worse than the caveat.
    """
    cap = capacity(rows)
    gs = read_goals()
    committed = sum(g["monthly"] for g in gs if g["status"] == "active")
    spare = cap["surplus"] - committed
    for g in gs:
        g["remaining"] = max(g["cost"] - g["saved"], 0) if g["cost"] else None
        # Its own instalments if it has them, otherwise whatever a month leaves.
        g["rate"] = g["monthly"] or spare
        g["months"] = (math.ceil(g["remaining"] / g["rate"])
                       if g["remaining"] and g["rate"] > 0 else None)
        g["eta"] = month_after(g["months"]) if g["months"] else ""
        # A target date is only worth drawing against something the data can
        # date, so a goal with no cost gets no verdict rather than a cheerful
        # one. A bare year is the end of that year — "2027" is a plan to have it
        # done by then, and reading it as January would book eleven false months
        # of lateness.
        end = g["by"] + "-12" if len(g["by"]) == 4 else g["by"]
        g["late"] = bool(end and g["eta"] and g["eta"] > end)
    order = {"active": 0, "planned": 1, "done": 2}
    gs.sort(key=lambda g: (order.get(g["status"], 1), g["by"] or "9999"))
    return {"rows": gs, "capacity": cap, "committed": committed, "spare": spare}


def reviews():
    """The weekly financial reviews, newest first.

    One HTML fragment per review in `Data/finance-reviews/`, **named by its
    date** — the same call `pages/knowledge/` makes about filenames being ids.
    A review is several paragraphs of judgement, and the alternative was a
    quote-escaped, newline-escaped paragraph inside a CSV cell, which is a
    format that punishes whoever writes the next one.
    """
    d = VAULT / "Data" / "finance-reviews"
    if not d.is_dir():
        return []
    return [{"date": f.stem, "html": f.read_text().strip()}
            for f in sorted(d.glob("*.html"), reverse=True)]


def finance():
    """Everything the Finance pages draw, and the signal the build records.

    Asks: what am I spending, where does the money go, what did something cost, how
    much came in, am I saving, which month was expensive.

    Written for the question rather than the code, because this is what a
    lookup matches a person's words against — the `aka` column's job, done
    for a function. See `_evals/advice.py`.
    """
    rows = read_spend()
    cover = coverage(rows)
    covered = [m for m, c in cover.items() if c["full"]]
    return {"monthly": monthly(rows), "coverage": cover, "covered": covered,
            "goals": goals(rows), "reviews": reviews(),
            "medium": by_medium(rows), "rails": rails(rows),
            "tx": transactions(rows),
            "earning": [m for m, c in cover.items() if c["income"]],
            "buckets": buckets(rows, set(covered)),
            "fixed": fixed_spending(rows, set(covered)),
            "classified": classified(rows, set(covered)),
            "unclassified": unclassified(rows),
            "primary": PRIMARY,
            # The newest transaction, which is what "is the finance data stale"
            # actually means — not when the importer last ran over no new rows.
            "last": rows[-1]["date"] if rows else None,
            "rows": len(rows)}
