#!/usr/bin/env python3
"""Map geometry in, one detail layer out. Run by hand, never by the build.

    python3 slices/events/tolayer.py tokyo.geojson slices/events/layer-tokyo.svg 390 \
        --where area_ja=都区部 --class ward
    python3 slices/events/tolayer.py streets.json slices/events/layer-ginza.svg 8000 \
        --box 35.65728,139.74338,35.69322,139.78762

`basemap.svg` is Natural Earth 1:10m and stops being evidence somewhere around
scale 100 — by then its simplification is off by a tenth of the frame, so the
map fades it out and the names in `Data/places.csv` carry the rest. A layer is
how the picture comes back at those scales: the same Web Mercator 2048x2048 box,
the same units, just geometry fine enough to survive being looked at closely.

Which is why this is a second layer and not a second map. Everything already
agrees about what a coordinate means, so a layer adds paths and nothing else —
no projection to switch, no viewBox to reconcile, and the pins do not move when
it appears. Seoul is this script run again with a different file.

Reads a GeoJSON FeatureCollection or the JSON Overpass returns, because the
things worth drawing arrive as both and the difference is ten lines.

`zoom` is the tier the layer belongs to. Geometry is simplified to stay about
two pixels honest at OVERSHOOT times that, not at the tier itself, because the
wheel goes past a tier and the layer has to hold up when it does.

Every feature is sorted into a CLASS, which decides two things: whether it is
an area or a line, and what it is painted like — the CSS lives in map.css. The
whole class is written as one path with many subpaths rather than a path per
feature, which drops four thousand nodes to seven and takes a fifth off the
file. Nothing needs them separate; nothing ever asks this layer a question.

The output is a whole `<svg>` so it can be opened and looked at on its own;
`build.py` inlines the `<g>` inside it and ignores the wrapper, the same
arrangement `basemap.svg` has.
"""
import argparse
import json
import math
import pathlib

W = 2048                       # the box every coordinate in this app lives in
PX = 2                         # how wrong the geometry is allowed to look, in px
OVERSHOOT = 2                  # how far past its tier a layer must still hold up
MIN_RING = 4                   # an area smaller than this many px^2 is a speck

# What a feature is, tried in order. The first match wins, so the narrow cases
# sit above the broad ones. Only what the map actually draws is here — a tag
# nothing paints would be bytes shipped to be invisible.
BIG_ROAD = {"motorway", "trunk", "primary", "secondary", "tertiary",
            "motorway_link", "trunk_link", "primary_link", "secondary_link",
            "tertiary_link"}
CLASSES = [
    ("water",  lambda t: t.get("natural") == "water"
                         or t.get("waterway") == "riverbank"),
    ("stream", lambda t: t.get("waterway") in ("river", "canal")),
    ("green",  lambda t: t.get("leisure") in ("park", "garden")
                         or t.get("landuse") in ("grass", "forest", "cemetery",
                                                 "recreation_ground")),
    ("block",  lambda t: t.get("landuse") in ("retail", "commercial")),
    ("road",   lambda t: t.get("highway") in BIG_ROAD),
    ("lane",   lambda t: "highway" in t),
]
# Closed and filled; everything else is an open line with a stroke.
AREAS = {"ward", "water", "green", "block"}
# Paint order, because SVG has no z-index and document order is all there is.
ORDER = ["ward", "block", "green", "water", "stream", "lane", "road"]


def classify(tags):
    for name, hit in CLASSES:
        if hit(tags):
            return name
    return None


def project(lon, lat):
    """Decimal degrees -> the box. The same formula as evProject in map.js."""
    s = math.sin(math.radians(max(-85.0511, min(85.0511, lat))))
    return ((lon + 180) / 360 * W,
            (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * W)


def simplify(pts, tol):
    """Douglas-Peucker, iteratively — a ward traced at full resolution is deep
    enough to blow the recursion limit, and the stack version is the same
    algorithm with the call stack written down."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        (x0, y0), (x1, y1) = pts[a], pts[b]
        dx, dy = x1 - x0, y1 - y0
        span = math.hypot(dx, dy)
        far, best = 0, 0.0
        for i in range(a + 1, b):
            x, y = pts[i]
            # Distance to the segment, or to the endpoint when the segment is a
            # point — a closed ring hands us exactly that case at the top.
            d = (abs(dy * x - dx * y + x1 * y0 - y1 * x0) / span if span
                 else math.hypot(x - x0, y - y0))
            if d > best:
                far, best = i, d
        if best > tol:
            keep[far] = True
            stack += [(a, far), (far, b)]
    return [p for p, k in zip(pts, keep) if k]


def area(pts):
    """Twice the shoelace area, unsigned. Only ever compared to a threshold."""
    return abs(sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1]
                   for i in range(len(pts)))) / 2


def trim(pts, box):
    """The runs of a line that are inside `box`, each keeping one point of
    overhang so it reaches the edge instead of stopping short of it.

    Overpass hands back whole ways that merely touch the box, and a single
    avenue can trail five kilometres past it — bytes for geometry nobody asked
    for, drawn outside the ground rect where it reads as a stray scratch. Only
    lines are trimmed: an area is closed, and cutting a ring without sewing it
    back up would turn a park into a wedge.
    """
    if not box:
        return [pts]
    x0, y0, x1, y1 = box
    inside = lambda p: x0 <= p[0] <= x1 and y0 <= p[1] <= y1
    runs, cur = [], []
    for i, p in enumerate(pts):
        if inside(p):
            if not cur and i:
                cur.append(pts[i - 1])
            cur.append(p)
        elif cur:
            cur.append(p)
            runs.append(cur)
            cur = []
    return runs + ([cur] if cur else [])


def features(src, where, forced):
    """(class, list of coordinate rings) per feature, from either input shape.

    GeoJSON carries its tags in `properties` and its rings nested by polygon;
    Overpass carries them in `tags` with one flat `geometry` per way. Past this
    function nothing knows which one it read.
    """
    doc = json.loads(src.read_text())
    key, val = (where.split("=", 1) if where else (None, None))
    out = []
    for f in doc.get("features") or doc.get("elements") or []:
        tags = f.get("properties") or f.get("tags") or {}
        if key and str(tags.get(key)) != val:
            continue
        kind = forced or classify(tags)
        if not kind:
            continue
        geom = f.get("geometry")
        if isinstance(geom, dict):                       # GeoJSON
            if geom["type"] == "Polygon":
                rings = list(geom["coordinates"])
            elif geom["type"] == "MultiPolygon":
                rings = [r for poly in geom["coordinates"] for r in poly]
            else:
                rings = [geom["coordinates"]]
            rings = [[(p[0], p[1]) for p in r] for r in rings]
        else:                                            # Overpass
            rings = [[(p["lon"], p["lat"]) for p in geom or []]]
        out.append((kind, rings))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("src", type=pathlib.Path,
                    help="a GeoJSON FeatureCollection, or Overpass JSON")
    ap.add_argument("out", type=pathlib.Path)
    ap.add_argument("zoom", type=float, help="the tier this layer belongs to")
    ap.add_argument("--where", default="", metavar="KEY=VALUE",
                    help="keep only features whose tag matches")
    ap.add_argument("--class", dest="forced", default="", metavar="NAME",
                    help="put every feature in this class instead of sorting "
                         "them by tag; %s are areas" % "/".join(sorted(AREAS)))
    ap.add_argument("--box", default="", metavar="LAT,LON,LAT,LON",
                    help="the area this layer covers. Drawn as the ground under "
                         "it, so where the data stops is visible rather than "
                         "looking like empty countryside")
    ap.add_argument("--source", default="", help="credit line for the comment")
    a = ap.parse_args()

    tol = PX / (a.zoom * OVERSHOOT)
    # Round no finer than a tenth of what was just thrown away. Any more digits
    # are bytes spent recording the exact position of a corner that moved.
    dec = max(0, math.ceil(-math.log10(tol / 10)))
    got = features(a.src, a.where, a.forced)
    if not got:
        raise SystemExit("nothing matched")

    box = None
    if a.box:
        y1, x1, y2, x2 = [float(v) for v in a.box.split(",")]
        (bx0, by0), (bx1, by1) = project(x1, y1), project(x2, y2)
        box = (min(bx0, bx1), min(by0, by1), max(bx0, bx1), max(by0, by1))

    # Everything is written relative to an origin near the middle of the layer,
    # and the origin is handed to map.js to put back.
    #
    # Not a size trick — a precision one. A coordinate here is around 1819, and
    # the browser rasterises the composed matrix in single precision: at scale
    # 19000, `19000 * 1819` lands past 2^25, where the float's own step is
    # bigger than the pixel being asked for, and the subtraction that puts a
    # road back near the origin loses its low bits. The map then draws itself
    # sixteen million pixels off screen. Numbers near zero never get near that,
    # which is why a layer may be zoomed into as far as anyone likes.
    kinds = [k for k, _ in got]
    all_pts = [project(lon, lat) for _, rings in got for r in rings for lon, lat in r]
    ox, oy = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2) if box else (
        (min(p[0] for p in all_pts) + max(p[0] for p in all_pts)) / 2,
        (min(p[1] for p in all_pts) + max(p[1] for p in all_pts)) / 2)

    drawn, kept = {}, 0
    for kind, rings in got:
        closed = kind in AREAS
        for ring in rings:
            projected = [project(lon, lat) for lon, lat in ring]
            for run in ([projected] if closed else trim(projected, box)):
                pts = simplify(run, tol)
                if len(pts) < (4 if closed else 2):
                    continue
                if closed and area(pts) * a.zoom * a.zoom < MIN_RING:
                    continue
                kept += 1
                steps = ["%s %s" % (round(x - px, dec), round(y - py, dec))
                         for (px, py), (x, y) in zip(pts, pts[1:])]
                drawn.setdefault(kind, []).append(
                    "M%s %s" % (round(pts[0][0] - ox, dec), round(pts[0][1] - oy, dec))
                    + "l" + ",".join(steps) + ("z" if closed else ""))

    body = []
    if box:
        body.append('<rect class="ev-ground" x="%s" y="%s" width="%s" height="%s"/>'
                    % (round(box[0] - ox, dec), round(box[1] - oy, dec),
                       round(box[2] - box[0], dec), round(box[3] - box[1], dec)))
    for kind in ORDER:
        if drawn.get(kind):
            body.append('<path class="ev-%s" d="%s"/>' % (kind, "".join(drawn[kind])))

    a.out.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d">\n'
        '<!-- %s\n     Web Mercator in a %dx%d box, the same one basemap.svg uses.\n'
        '     Douglas-Peucker at %g units — about %d px at scale %g, which is %g\n'
        '     times this layer\'s tier, because the wheel goes past a tier.\n'
        '     Generated by tolayer.py; edit the source data and run it again\n'
        '     rather than editing this.\n'
        '     Coordinates are relative to the origin below; map.js adds it back.\n'
        '-->\n'
        '<g class="ev-layer" data-zoom="%g" data-ox="%s" data-oy="%s">%s</g>\n</svg>\n'
        % (W, W, a.source or "generated layer", W, W, tol, PX,
           a.zoom * OVERSHOOT, OVERSHOOT, a.zoom,
           round(ox, dec), round(oy, dec), "".join(body)))
    print("%s — %d rings in %d classes (%s), %.0f KB"
          % (a.out, kept, len(drawn), " ".join(k for k in ORDER if k in drawn),
             a.out.stat().st_size / 1024))


if __name__ == "__main__":
    main()
