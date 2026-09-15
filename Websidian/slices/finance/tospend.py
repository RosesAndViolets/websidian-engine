#!/usr/bin/env python3
"""Money Forward 家計簿 exports to `Data/spend.csv`.

    python3 slices/finance/tospend.py ~/Downloads/収入・支出詳細_*.csv

Run by hand when a new export is downloaded, never by the build — the same
arrangement `tonames.py` has, and for the same reason: the source is a file that
arrives occasionally from somewhere else, so making the build depend on it would
make the build depend on a download.

**Re-running is safe.** Every MF row carries a stable `ID`, so an export that
overlaps one already imported contributes nothing the second time. That is the
one thing the intake log cannot do, and it is worth saying out loud: this
importer is idempotent, so the answer to "did I already load 2025?" is to run it
again and look at the count.

What the columns mean, and why they survive as written:

    date      日付
    merchant  内容, with the card network's noise taken off — see NOISE below
    amount    金額（円）, signed: negative spent, positive received
    account   保有金融機関 — which rail it came down. The coverage guard is
              built entirely out of this column, so it is never normalised
    major     大項目, minor 中項目 — MF's own guess. Kept because it is the
              fallback when no rule matches, never because it is trusted
    transfer  振替 — MF's transfer flag, which is right about Amazon and PayPay
              card charges and wrong about 振込 between accounts. Both facts
              matter, so the flag is recorded and the rules correct it
    calc      計算対象 — rows MF was told to leave out of its own totals
    raw       内容 exactly as exported

`raw` is kept beside `merchant` because normalising is a guess and a guess with
the original next to it can be checked. It is also the whole value of the Amazon
rows: those arrive as full product titles, so `merchant` collapses them to
`Amazon` to make them aggregate while `raw` keeps the pizza oven a pizza oven.
"""
import csv
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
from core.vault import VAULT                                      # noqa: E402

# Everything the card network staples onto a merchant name. Each of these is a
# fact about the rail the money took, not about who was paid, and leaving them
# on splits one shop into three: セブン-イレブン, マスター国内利用 MZZ
# セブン-イレブン and セブン-イレブン/NFC would each need their own rule.
NOISE = [
    (re.compile(r"^(?:マスター国内利用|海外利用)\s+\S+\s+"), ""),  # card network + terminal
    (re.compile(r"\s*販売:.*$"), ""),                              # Amazon's seller suffix
    (re.compile(r"/NFC$"), ""),                                    # contactless terminal
    (re.compile(r"\s*[（(]ヘンサイヘンコウ.*$"), ""),               # 返済変更 — same shop, restated
    (re.compile(r"利用国[A-Z]{3}$"), ""),                          # foreign-use country tag
]

# The Amazon integration reports one row per *item*, not per charge, so its
# `内容` is a product title that will never be seen again. Collapsed to one
# merchant so it aggregates; `raw` keeps what was actually bought.
ITEMISED = {"Amazon.co.jp": "Amazon"}

FIELDS = ["date", "merchant", "amount", "account", "major", "minor",
          "transfer", "calc", "id", "raw"]


def clean(name):
    for pattern, to in NOISE:
        name = pattern.sub(to, name).strip()
    return name


def load(paths):
    """Every row of every export, keyed by MF's own id so overlaps collapse."""
    seen = {}
    for p in paths:
        # utf-8-sig: MF writes a BOM, and without this the first column is
        # named "﻿計算対象" and never matches anything.
        for r in csv.DictReader(open(p, encoding="utf-8-sig")):
            rid = (r.get("ID") or "").strip()
            date = (r.get("日付") or "").strip().replace("/", "-")
            if not rid or not date:
                continue
            account = (r.get("保有金融機関") or "").strip()
            raw = (r.get("内容") or "").strip()
            seen[rid] = {
                "date": date,
                "merchant": ITEMISED.get(account) or clean(raw) or "(blank)",
                "amount": (r.get("金額（円）") or "0").strip(),
                "account": account,
                "major": (r.get("大項目") or "").strip(),
                "minor": (r.get("中項目") or "").strip(),
                "transfer": (r.get("振替") or "0").strip(),
                "calc": (r.get("計算対象") or "1").strip(),
                "id": rid,
                "raw": raw,
            }
    return sorted(seen.values(), key=lambda r: (r["date"], r["id"]))


def main(argv):
    if not argv:
        print(__doc__.strip().splitlines()[2].strip())
        return 1
    rows = load(argv)
    out = VAULT / "Data" / "spend.csv"
    with out.open("w", newline="") as f:
        # csv writes CRLF unless told otherwise, and every other file under
        # Data/ is LF. test_build.py fails the mismatch rather than letting one
        # generated file disagree with the fifteen hand-written ones.
        w = csv.DictWriter(f, FIELDS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    accounts = {}
    for r in rows:
        got = accounts.setdefault(r["account"], [r["date"], r["date"]])
        got[0], got[1] = min(got[0], r["date"]), max(got[1], r["date"])
    print("%s — %d rows, %s .. %s" % (out, len(rows), rows[0]["date"], rows[-1]["date"]))
    for a, (lo, hi) in sorted(accounts.items(), key=lambda kv: kv[1][0]):
        print("  %-14s %s .. %s" % (a, lo, hi))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
