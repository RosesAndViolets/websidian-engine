#!/usr/bin/env python3
"""A pile of tagged points in, one tier of map labels out. Run by hand.

    python3 slices/events/tonames.py stations.json Data/stations.csv 8000 \
        --key name:en --spread 800

The companion to `tolayer.py`: that one turns polygons into something to look
at, this one turns points into something to read. Both write into the same Web
Mercator box and both take the tier as an argument, because a name and the
geometry under it are one tier or they never appear together.

Input is whatever Overpass returns for a node query — `elements` with `lat`,
`lon` and `tags`. See the query in README.md under "Adding a city to the map".

The one judgement here is what to do with a name that arrives several times.
A big interchange is half a dozen nodes, one per operator: Shibuya is five, and
five labels stacked on one spot is a smudge rather than five facts. So nodes
sharing a name are averaged into the middle of the complex. That is only true
while they really are one complex, which is what `--spread` checks — two
genuinely different places sharing a name would be averaged into a point that
is neither, so the script refuses rather than inventing a location, and you
split them by hand.
"""
import argparse
import csv
import json
import math
import pathlib


def metres(a, b):
    """Rough ground distance between two (lat, lon), good to a percent or so
    over the few hundred metres this is ever asked about."""
    (lat1, lon1), (lat2, lon2) = a, b
    dy = (lat2 - lat1) * 111_320
    dx = (lon2 - lon1) * 111_320 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("src", type=pathlib.Path, help="Overpass JSON of nodes")
    ap.add_argument("out", type=pathlib.Path)
    ap.add_argument("zoom", type=float, help="the tier these names belong to")
    ap.add_argument("--key", default="name:en",
                    help="tag to read the name from (default name:en)")
    ap.add_argument("--fallback", default="name",
                    help="tag to use where --key is missing (default name)")
    ap.add_argument("--kind", default="", metavar="NAME",
                    help="what these are, which decides the mark drawn at the "
                         "point — `station` gets the chip and the train. Blank "
                         "is a bare name, which is what a ward or a city wants")
    ap.add_argument("--spread", type=float, default=800, metavar="M",
                    help="how far apart nodes sharing a name may sit and still "
                         "be averaged into one label")
    a = ap.parse_args()

    # Grouped case-insensitively: OSM spells one station both `Minami-Senju`
    # and `Minami-senju`, and two spellings of one place is two labels drawn on
    # top of each other. The spelling kept is the commonest, ties going to the
    # first seen, so the file does not churn between runs.
    groups, spellings = {}, {}
    for e in json.loads(a.src.read_text())["elements"]:
        tags = e.get("tags") or {}
        name = (tags.get(a.key) or tags.get(a.fallback) or "").strip()
        if not name or e.get("lat") is None:
            continue
        key = name.casefold()
        groups.setdefault(key, []).append((e["lat"], e["lon"]))
        spellings.setdefault(key, []).append(name)

    rows, split = [], []
    for key, pts in sorted(groups.items()):
        seen = spellings[key]
        name = max(sorted(set(seen), key=seen.index), key=seen.count)
        mid = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        far = max(metres(p, mid) for p in pts)
        if far > a.spread:
            split.append((name, round(far)))
            continue
        rows.append({"name": name, "lat": round(mid[0], 5),
                     "lon": round(mid[1], 5), "zoom": "%g" % a.zoom,
                     "kind": a.kind})

    with a.out.open("w", newline="") as fh:
        w = csv.DictWriter(fh, ["name", "lat", "lon", "zoom", "kind"],
                           lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print("%s — %d names from %d points, %.0f KB"
          % (a.out, len(rows), sum(len(v) for v in groups.values()),
             a.out.stat().st_size / 1024))
    for name, far in split:
        print("  not written, two places share this name %d m apart: %s"
              % (far, name))


if __name__ == "__main__":
    main()
