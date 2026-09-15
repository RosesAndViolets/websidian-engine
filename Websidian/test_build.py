#!/usr/bin/env python3
"""python3 Websidian/test_build.py — the checks that matter if the logic breaks.

Covers the two trust boundaries (any path the browser supplies), the readers
that turn files into what the page shows, and whether README.md still describes
the folder it claims to. Rendering is eyeballed in the browser; these are the
parts that fail silently.
"""
import csv
import json
import math
import pathlib
import re
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import build
import serve

VAULT = build.VAULT


def test_editable_path():
    """The save/edit boundary: .html inside this app's pages/, nothing else.

    Paths arrive relative to REPO now that two applications live side by side,
    so the guard has to reject the neighbour's files as firmly as it rejects
    `../` — and markdown is no longer editable at all.
    """
    assert serve.editable_path("Websidian/pages/work/index.html")
    # A page nested a second level deep — projects are grouped by status folder.
    assert serve.editable_path("Websidian/pages/personal-projects/active/example.html")
    for bad in ["../.ssh/id_rsa", "Inbox/x.html",
                "Websidian/pages/../../etc/hosts", "Websidian/build.py",
                "Websidian/pages/nope.html", "Websidian/shell/base.css"]:
        assert serve.editable_path(bad) is None, bad
    # Creating a page drops only the "already there" requirement — the same
    # boundary still has to refuse everything above.
    assert serve.editable_path("Websidian/pages/personal-projects/new.html",
                               must_exist=False)
    for bad in ["../evil.html", "Websidian/pages/../../evil.html", "Websidian/shell/x.html"]:
        assert serve.editable_path(bad, must_exist=False) is None, bad


def test_inside_inbox():
    """The move/unstage boundary."""
    assert serve.inside_inbox("") == serve.INBOX
    assert serve.inside_inbox("../Notes/Life lessons.md") is None
    assert serve.inside_inbox("../../etc", must_exist=False) is None
    assert serve.inside_inbox("Work")


def test_safe_name():
    assert serve.safe_name("../../evil.txt") == "evil.txt"
    assert serve.safe_name("a/b/c.png") == "c.png"
    assert serve.safe_name("テスト — probe.txt") == "テスト — probe.txt"
    assert serve.safe_name("") == "dropped"


def test_clean_folder():
    """One guard, every caller: drop, note and mkdir all route through it."""
    assert serve.clean_folder("Design Library") == "Design Library"
    assert serve.clean_folder("Shoot/raw") == "Shoot/raw", "dropped folders keep structure"
    assert serve.clean_folder("") == ""
    for bad in ["../../etc", "/etc", "a/../../b"]:
        assert serve.clean_folder(bad) is None, bad


def test_events_place_on_the_map():
    """A coordinate is the one event field nothing else can sanity-check.

    A wrong date reads wrong, a wrong name reads wrong — a transposed lat/lon
    just puts the pin somewhere plausible-looking and says nothing. So the
    ranges are checked here, along with the rule that half a coordinate is no
    coordinate: placing a row with only a latitude would sit it on the Greenwich
    meridian, which is a lie the map tells confidently.
    """
    from slices.events.data import KINDS, read_events

    rows, unknown = read_events()
    assert not unknown, "events.csv uses a kind no glyph exists for: %s" % unknown
    for e in rows:
        assert e["kind"] in KINDS, "%s: %r" % (e["title"], e["kind"])
        assert (e["lat"] is None) == (e["lon"] is None), \
            "%s: half a coordinate is not a location" % e["title"]
        if e["lat"] is not None:
            assert -90 <= e["lat"] <= 90, "%s: lat %s" % (e["title"], e["lat"])
            assert -180 <= e["lon"] <= 180, "%s: lon %s" % (e["title"], e["lon"])

    # The basemap and the pins have to agree about what a coordinate means, and
    # they are projected by different languages in different files. These are
    # the numbers the JS in slices/events/map.js must reproduce.
    svg = (VAULT / "slices" / "events" / "basemap.svg").read_text()
    assert 'viewBox="0 0 2048 2048"' in svg, "map.js hard-codes this box as EV_W"
    assert '<g class="ev-land">' in svg, "build.basemap() looks for exactly this group"
    assert build.basemap().startswith('<g class="ev-land">')

    def mercator(lat, lon):                       # the same formula as evProject
        s = math.sin(math.radians(max(-85.0511, min(85.0511, lat))))
        return ((lon + 180) / 360 * 2048,
                (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * 2048)
    x, y = mercator(36.5613, 136.6562)            # Kanazawa
    assert round(x, 1) == 1801.4 and round(y, 1) == 800.3, (x, y)
    assert mercator(0, 0) == (1024.0, 1024.0), "the origin is the middle of the box"



def test_layers_land_where_their_names_are():
    """A detail layer is geometry projected by `tolayer.py`, in a different
    language and on a different day from the labels it sits under. Nothing at
    runtime compares them — `map.js` shows both and lets you look — so a layer
    generated with a swapped lat/lon, a stale box or the wrong tier draws a
    confident, wrong city and the page reports nothing.

    Two things are checked, and they are the two that fail silently. The tier,
    because a layer whose `data-zoom` matches no label simply never appears:
    the names and the coastline under them are one tier by construction, and
    the file drop that adds Seoul has to honour that or it is invisible rather
    than broken. And the extent, because a layer is only ever looked at through
    the frame of its own labels — so every name at its tier has to fall inside
    the geometry's box, and that box has to be roughly the size of the thing it
    claims to be rather than a hemisphere or a dot.
    """
    from slices.events.data import read_places

    layers = build.layers()
    if not layers:
        return                            # the map is allowed to have no layers
    places = read_places()
    tiers = {q["zoom"] for q in places}

    def mercator(lat, lon):
        s = math.sin(math.radians(max(-85.0511, min(85.0511, lat))))
        return ((lon + 180) / 360 * 2048,
                (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * 2048)

    def points(d):
        """Every vertex of one `d`, which tolayer.py writes as an absolute move
        and then relative steps."""
        for sub in d.split("M")[1:]:
            head, _, rest = sub.partition("l")
            x, y = map(float, head.split())
            yield x, y
            for step in rest.rstrip("z").split(","):
                dx, dy = map(float, step.split())
                x, y = x + dx, y + dy
                yield x, y

    for layer in layers:
        assert layer["zoom"] in tiers, (
            "a layer at zoom %g has no names in places.csv at that zoom, so "
            "nothing will ever show it" % layer["zoom"])
        # Coordinates are written around the layer's own origin — see the note
        # in tolayer.py — so putting it back is also a check that the origin
        # travelled with them.
        pts = [p for d in re.findall(r' d="([^"]+)"', layer["paths"])
               for p in points(d)]
        assert pts, "layer at zoom %g drew nothing" % layer["zoom"]
        xs = [p[0] + layer["ox"] for p in pts]
        ys = [p[1] + layer["oy"] for p in pts]
        box = (min(xs), min(ys), max(xs), max(ys))

        # Big enough to be a city, small enough not to be a continent. A frame
        # at this tier is EV_VW/zoom units wide, so the geometry should be that
        # order of size — a swapped lat/lon lands far outside both bounds.
        frame = 1000 / layer["zoom"]
        for span in (box[2] - box[0], box[3] - box[1]):
            assert frame / 20 < span < frame * 4, (
                "layer at zoom %g spans %.3f units; a frame there is %.3f, so "
                "this is not the projection map.js reads" % (
                    layer["zoom"], span, frame))

        # At least one name of this tier has to fall inside it. Not every name:
        # a layer covering four square kilometres shares its tier with every
        # station in the city, and demanding it hold all of them would forbid
        # ever drawing one neighbourhood. One is enough to prove the two were
        # projected the same way, which is the thing that fails silently.
        named = [q for q in places if q["zoom"] == layer["zoom"]]
        assert named, "no names at zoom %g" % layer["zoom"]
        inside = [q for q in named
                  if box[0] <= mercator(q["lat"], q["lon"])[0] <= box[2]
                  and box[1] <= mercator(q["lat"], q["lon"])[1] <= box[3]]
        assert inside, (
            "the layer at zoom %g holds none of the %d names at its tier, so "
            "either it is somewhere else or it was projected differently"
            % (layer["zoom"], len(named)))


def test_build_report_records_only_change():
    """serve.py rebuilds on any page load with stale source, so a line per build
    would be hundreds of identical rows a day and the file would never be read.
    Only a change earns a line — which is also the only shape "what moved between
    these two builds" can be asked of.
    """
    import tempfile
    keep = build.REPORT
    try:
        with tempfile.TemporaryDirectory() as d:
            build.REPORT = pathlib.Path(d) / "builds.jsonl"
            sig = {"unknown": {"intake": [], "workout": [], "work": []},
                   "dupes": {"collision": [], "twin": []},
                   "missing_assets": [], "rows": {"pages": 3}}
            assert build.record(sig) is True, "the first observation is always a line"
            assert build.changed_since(sig) is None, "a first line is not a regression"
            assert build.record(sig) is False, "an unchanged build must add nothing"

            moved = {**sig, "missing_assets": ["gone.png"]}
            assert build.record(moved) is True
            assert build.changed_since(moved) == ["missing_assets"], \
                "only the signal that actually moved is named"

            # ingredient_conflicts() returns tuples, which come back from a JSON
            # round trip as lists. Comparing those directly reports a change on
            # every build, which is the one bug that makes the whole file useless.
            twinned = {**moved, "dupes": {"collision": [("계란", "egg")], "twin": []}}
            assert build.record(twinned) is True
            assert build.record(twinned) is False, "a tuple and its JSON list are one signal"

            lines = build.REPORT.read_text().splitlines()
            assert len(lines) == 3, "three changes, three lines"
            assert json.loads(lines[-1])["signals"]["dupes"]["collision"] == [["계란", "egg"]]
    finally:
        build.REPORT = keep


def test_rejection_detail_never_carries_the_note():
    """The rejection log records why a capture was refused, not what was in it.

    `text` is the note, and serve.log sits beside the Inbox the note was headed
    for — a second copy accumulating in a file nobody prunes. Every other field
    is an identifier and is exactly what makes a refusal diagnosable later.
    """
    body = json.dumps({"path": "Websidian/pages/x.html", "text": "the note itself",
                       "folder": "Intake", "create": True}).encode()
    d = serve.request_detail({}, body)
    assert "text" not in d, "the note body must never reach the log"
    assert d["path"] == "Websidian/pages/x.html"
    assert d["folder"] == "Intake"
    # A drop names its file in headers instead, percent-encoded on the wire.
    assert serve.request_detail({"X-Filename": "%E3%83%86%E3%82%B9%E3%83%88.png"},
                                b"")["X-Filename"] == "テスト.png"
    # And carries raw bytes as its body — not JSON, and not a reason to raise.
    assert serve.request_detail({}, b"\x89PNG\r\n\x1a\n") == {}
    # Nothing unbounded reaches the log.
    assert len(serve.request_detail(
        {}, json.dumps({"folder": "x" * 900}).encode())["folder"]) == 200


def test_read_intake():
    """The join is the whole consistency story: grams × reference, and an
    ingredient the reference doesn't know must surface, not vanish into a zero."""
    log, ref = VAULT / "Data" / "intake.csv", VAULT / "Data" / "ingredients.csv"
    keep = log.read_text(), ref.read_text()
    ref.write_text("ingredient,kcal,protein,fat,carbs,basis,added\n"
                   "chicken (raw),215,18.5,15,0,test,2026-08-02\n"
                   "oil,884,0,100,0,test,2026-08-02\n"
                   "typo'd,,,,,test,2026-08-02\n")
    log.write_text("when,meal,ingredient,grams\n"
                   "2026-08-02 19:30,dinner,chicken (raw),250\n"
                   "2026-08-02 19:30,dinner,oil,30\n"
                   "2026-08-01 08:00,breakfast,not in the reference,100\n"
                   "2026-08-02 19:30,dinner,typo'd,50\n")
    try:
        rows, unknown, nutrients = build.read_intake()
        assert nutrients == ["kcal", "protein", "fat", "carbs"], \
            "nutrients are the ingredient columns, in order, minus the descriptive ones"
        assert [r["when"] for r in rows] == ["2026-08-01 08:00", "2026-08-02 19:30"], "oldest first"
        dinner = rows[1]
        assert dinner["kcal"] == round(215 * 2.5 + 884 * .3), "grams scale off 100 g"
        assert dinner["protein"] == round(18.5 * 2.5)
        assert dinner["fat"] == round(15 * 2.5 + 30)
        assert len(dinner["items"]) == 3, "every ingredient stays visible in the breakdown"
        assert unknown == ["not in the reference"], "unmatched names are reported"
        assert rows[0]["kcal"] == 0, "and score zero rather than guessing"
        assert dinner["items"][2]["kcal"] == 0, "blank macros read as 0, not a crash"
        # a new column becomes a nutrient with no code change — that is the
        # whole extensibility promise of the meters
        ref.write_text("ingredient,kcal,sodium,basis,added\n"
                       "salt,0,38758,test,2026-08-02\n")
        rows2, _, nutrients2 = build.read_intake()
        assert nutrients2 == ["kcal", "sodium"]
    finally:
        log.write_text(keep[0])
        ref.write_text(keep[1])


def test_a_bullet_knows_which_rail_it_came_from():
    """Unrecognised is the job, and that direction is the point.

    `work-log.csv` is written by two skills: `/vault-work` files the job and
    `/vault-log` files a coding session into the same columns. Only `topic`
    separates them, so the Work page needs a rule — and the rule has to fail
    towards showing too much. A job topic that quietly stopped appearing leaves
    a page that looks complete and is not; a personal topic that turns up on it
    is a mistake anybody spots in a second.
    """
    from slices.work.data import rail_of

    projects = {"websidian", "voice-trainer"}
    assert rail_of("websidian", projects) == "Personal Projects"
    assert rail_of("finance", projects) == "Finance"
    assert rail_of("supplements", projects) == "Health"
    # The job: named threads and, crucially, anything nobody has classified.
    assert rail_of("rag", projects) == "Work"
    assert rail_of("a-thread-coined-next-year", projects) == "Work"
    assert rail_of("", projects) == "Work"

    # The live file must still hold a job to show, or the rule has eaten it.
    from slices.work.data import read_work_log
    rows, _ = read_work_log()
    if rows:
        assert any(r["rail"] == "Work" for r in rows), \
            "every bullet was filed off the Work rail — the project slugs are eating them"

    # And a project session must not be in this file at all any more. The rail
    # was the stopgap; `project-log.csv` is where a coding session goes, and a
    # row landing back here means /vault-log wrote to the wrong book.
    from slices.projects.data import read_project_meta
    slugs = {s.rsplit("/", 1)[-1] for s in read_project_meta()}
    stray = sorted({r["topic"] for r in rows if r["topic"] in slugs})
    assert not stray, (
        "work-log.csv holds project sessions under %s — those belong in "
        "Data/project-log.csv, keyed by project slug" % ", ".join(stray))


def test_a_session_is_filed_by_project_and_day():
    """`project-log.csv` groups before it returns, and that is not a convenience.

    A session produces a dozen bullets and a project earns a milestone every few
    days. Threaded onto the milestone spine one bullet at a time, the footnotes
    would outnumber the text within a week — so the day is the unit, decided in
    the reader rather than in the renderer, because every consumer wants it that
    way and the alternative is three places re-deriving the same grouping.
    """
    from slices.projects.data import read_project_log

    log = read_project_log()
    for slug, days in log.items():
        assert "/" in slug, "%r is not a project page slug" % slug
        assert list(days) == sorted(days), "%s: days came back unsorted" % slug
        for date, bullets in days.items():
            assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", date), \
                "%s: %r is not a date" % (slug, date)
            assert bullets, "%s %s: a day with no bullets should not be a key" % (slug, date)

    # Every project it files against must be a real project, or the page that
    # would draw it does not exist and the rows are invisible.
    from slices.projects.data import read_project_meta
    unknown = set(log) - set(read_project_meta())
    assert not unknown, "project-log.csv files against no such project: " + str(sorted(unknown))


def test_entities_resolve():
    """`Data/entities.csv` is only worth having if a reference lands on one row.

    Four ways it stops doing that, all silent: an id written twice, a link to
    something that was renamed away, a kind nothing reads, and — the one that
    actually bites — two rows of the same kind answering to the same words.

    That last check is deliberately per kind. A place and a trip to it share
    vocabulary honestly: 가나자와 means both, and either answer is useful. Two
    *trips* both called "the business trip" is the failure this file exists to
    prevent, and the day a second trip is added is the day someone would have
    pasted that alias onto it without thinking.
    """
    import re as _re
    from slices.entities.data import KINDS, read_entities

    rows = read_entities()
    assert rows, "Data/entities.csv read as empty"

    ids = [e["id"] for e in rows]
    assert len(ids) == len(set(ids)), "duplicate id: " + str(
        sorted({i for i in ids if ids.count(i) > 1}))
    for e in rows:
        assert _re.fullmatch(r"[a-z0-9][a-z0-9-]*", e["id"]), \
            "%r is not a slug — ids get typed and grepped by hand" % e["id"]
        assert e["kind"] in KINDS, "%s: kind %r is not in KINDS" % (e["id"], e["kind"])
        if e["when"]:
            for part in [p for p in e["when"].split("..") if p]:
                assert _re.fullmatch(r"\d{4}-\d{2}-\d{2}", part), \
                    "%s: when is %r, want a date or start..end" % (e["id"], e["when"])

    # A link is either an id, which must resolve, or a person's name, which is
    # allowed not to be in people.csv at all — `events.csv` already made that
    # call for the same reason: a study session has three attendees and a
    # leaving do has forty. Slug shape tells them apart, and since ids are
    # lowercase-only, no name written the way a person writes it collides.
    for e in rows:
        for rel in e["related"]:
            if _re.fullmatch(r"[a-z0-9][a-z0-9-]*", rel):
                assert rel in set(ids), \
                    "%s: related %r looks like an id but resolves to nothing" % (e["id"], rel)

    # A provenance mark is worth nothing if a typo silently becomes a third
    # value: `infered` would render as unrecorded and read as recorded.
    from slices.entities.data import VIA
    for e in rows:
        for rel, via in e["via"].items():
            assert via in VIA, "%s: related %s is marked %r, want one of %s" % (
                e["id"], rel, via, ", ".join(sorted(VIA)))

    seen = {}
    for e in rows:
        for alias in [e["name"]] + e["aka"]:
            key = (e["kind"], alias.strip().lower())
            if seen.get(key) == e["id"]:
                raise AssertionError(
                    "%s lists %r twice — its name is already matched, drop the aka"
                    % (e["id"], alias))
            assert key not in seen, \
                "%s and %s are both %ss answering to %r — a query cannot pick" % (
                    seen.get(key), e["id"], e["kind"], alias)
            seen[key] = e["id"]


def test_an_edge_says_how_it_was_made():
    """The mark rides on the link, and a link without one stays unrecorded.

    Every consumer of `related` takes a plain list of refs, so the parser has to
    hand back exactly what it always did no matter what is written after the
    colon — the id gate, `misspelt_people` and the retrieval index all break in
    silence rather than loudly if a `:said` leaks through into a ref.
    """
    from slices.entities.data import edges

    refs, via = edges("kanazawa:said; acme:inferred; 田中さん")
    assert refs == ["kanazawa", "acme", "田中さん"], refs
    # The unmarked one is absent, not defaulted — reading `.get(ref)` as None is
    # what makes "nobody wrote this down" a state the page can print.
    assert via == {"kanazawa": "said", "acme": "inferred"}, via

    assert edges("") == ([], {})
    assert edges(None) == ([], {})
    # Spacing is however the person typed it, and an empty mark is no mark.
    assert edges(" kanazawa : said ;; acme: ") == (["kanazawa", "acme"],
                                                    {"kanazawa": "said"})


def test_a_near_miss_on_a_name_is_the_one_unknown_worth_reporting():
    """Three kinds of unrecognised name, and only the middle one is a problem.

    `related`, `events.people` and `work-log.people` all take a name as written,
    and a name with no row in `people.csv` is deliberately fine — a leaving do
    has forty attendees. The cost of that freedom is that a misspelling hides
    inside it: 田中太郎 and 田中太朗 both read as ordinary, and the person is
    silently two people from then on. Being *close* to a known name is the only
    thing separating the two cases, so it is the only thing reported.

    Not gated anywhere, and this test does not look at the live vault. Two real
    people can have names a character apart, and a triage pass over the vault's
    own signals carries the same check so answering it stays a judgement
    rather than a blocked commit.
    """
    from slices.people.data import misspelt_people

    people = [{"name": "田中太朗", "category": "Coworker", "keywords": ["同期", "taro"]},
              {"name": "鈴木さん", "category": "Coworker", "keywords": []}]
    ent = lambda *rel: {"related": list(rel)}
    who = lambda *names: {"people": list(names)}

    # Exact on the name, and exact on a keyword, because that is where the
    # aliases anyone bothers to write actually land.
    assert misspelt_people(people, [ent("田中太朗")], [who("taro")], []) == []
    # Slug-shaped values in `related` are entity ids and gated as ids elsewhere.
    assert misspelt_people(people, [ent("example-project", "example-org")], [], []) == []
    # Strangers: nobody wrote them down, and nothing here says they should.
    assert misspelt_people(people, [], [who("片岡"), who("林")], []) == []

    # One kanji out, wherever it is written.
    slip = [("田中太郎", "田中太朗")]
    assert misspelt_people(people, [ent("田中太郎")], [], []) == slip
    assert misspelt_people(people, [], [who("田中太郎")], []) == slip
    assert misspelt_people(people, [], [], [who("田中太郎")]) == slip


def test_knowledge_is_anchored():
    """A knowledge entry must be attached to something of the vault owner's.

    This is the whole filter between an accumulated record and a folder of
    articles that could have been read anywhere. "What a DAG is" has nothing to
    put in `related`; "the DAG I built in AgentOps" has AgentOps. Enforced here
    rather than intended, because the failure is not visible on the page — a
    general-interest write-up renders exactly as well as an anchored one and
    only stops being findable, later, by a question about your own work.

    The page and its row are joined by the filename alone, in both directions:
    a page with no row would draw an empty block, and a row with no page would
    be a link that resolves to nothing.
    """
    from core.pages import collect
    from slices.entities.data import read_entities

    pages, _ = collect()
    rows = {e["id"]: e for e in read_entities() if e["kind"] == "knowledge"}
    slugs = {p["slug"].split("/", 1)[1] for p in pages
             if p["category"] == "knowledge" and not p["home"]}

    assert not slugs - set(rows), \
        "knowledge pages with no entities.csv row: " + str(sorted(slugs - set(rows)))
    assert not set(rows) - slugs, \
        "knowledge rows with no page: " + str(sorted(set(rows) - slugs))
    for e in rows.values():
        assert e["related"], \
            "%s: a knowledge entry must anchor to a project, event, topic or person" % e["id"]


def test_readme_covers_the_layout():
    """"Remember to update the README" is a promise; this is the mechanism.

    Every source file the site is assembled from must appear in the layout table,
    and the table may not list files that no longer exist. A rename that skips
    the README fails here rather than leaving a map that quietly stops matching
    the territory.
    """
    browse = build.APP
    readme = (browse / "README.md").read_text()
    on_disk = {str(p.relative_to(browse)) for d in ("core", "shell", "slices")
               for p in (browse / d).rglob("*")
               if p.is_file() and p.suffix in (".py", ".js", ".css", ".html", ".svg")}
    on_disk |= {"build.py", "serve.py", "test_build.py", "README.md"}

    # Walk the tree by indentation — two spaces per level — so a name only has to
    # be written once, under its folder, the way it reads on screen.
    tree = re.search(r"```\n(Websidian/\n.*?)```", readme, re.S)
    assert tree, "the Layout section must hold a fenced tree starting with Websidian/"
    documented, stack = set(), []
    for line in tree.group(1).splitlines():
        if not line.strip():
            continue
        name = line.strip().split()[0]
        stack = stack[:(len(line) - len(line.lstrip())) // 2]
        if name.endswith("/"):
            stack.append(name.rstrip("/"))
        else:
            documented.add("/".join(stack[1:] + [name]))   # drop the Websidian/ root
    missing = sorted(on_disk - documented)
    assert not missing, "not in the Websidian/README.md tree: " + ", ".join(missing)
    phantom = sorted(documented - on_disk)
    assert not phantom, "in the Websidian/README.md tree but gone: " + ", ".join(phantom)

    # The lists in build.py are what actually renders, so a file can be present
    # and documented and still be dead. Catch that too.
    listed = set(build.CSS) | set(build.JS)
    front = {f for f in on_disk if f.endswith((".css", ".js"))}
    # basemap.svg is data the build inlines, not a file in either list.
    orphan = sorted(front - listed)
    assert not orphan, "never rendered — absent from CSS/JS in build.py: " + ", ".join(orphan)


def test_data_files_are_lf():
    """Every data file is LF, and this is why it keeps needing saying.

    Python's csv module writes CRLF by default, so any script that reads a file,
    changes one cell and writes it back hands you a file where *every* line has
    changed. It happened to milestones.csv and again to events.csv, and both
    times the real edit was invisible inside a whole-file diff — which matters
    most for the one case that has to stay reviewable: a repair.

    `.gitattributes` normalises on the way in, and any writer that touches a
    row (serve.py's endpoints, a skill) has to pass an explicit lineterminator;
    this fails if something writes one anyway.
    """
    csvs = sorted((VAULT / "Data").glob("*.csv"))
    bad = [str(p.relative_to(VAULT)) for p in csvs if b"\r\n" in p.read_bytes()]
    assert not bad, ("CRLF in %s — something wrote these with csv's default "
                     "lineterminator. Pass lineterminator='\\n'." % ", ".join(bad))


def test_no_row_has_more_cells_than_the_header():
    """An unquoted comma in free text, which reads as a normal row forever after.

    `agentops-mcp-server` shipped with a bare `Planned, not built: …` in `note`.
    The reader took `note` as "Planned", `added` as the rest of the sentence and
    dropped the date off the end — and every page rendered it without complaint,
    because a short note and an odd date are both things a row is allowed to
    have. Nothing else here would ever have caught it.

    Only *extra* cells fail. A short row is how a trailing empty column is
    written by hand and `DictReader` fills it with None, which every reader in
    the vault already treats as blank.
    """
    ragged = []
    for p in sorted((VAULT / "Data").glob("*.csv")):
        with p.open(newline="") as fh:
            rows = list(csv.reader(fh))
        if not rows:
            continue
        width = len(rows[0])
        ragged += ["%s line %d: %d cells, header has %d — quote the free text"
                   % (p.name, i, len(r), width)
                   for i, r in enumerate(rows[1:], 2) if len(r) > width]
    assert not ragged, "\n".join(ragged)


def test_the_bundle_parses():
    """One SyntaxError anywhere blanks the whole site, silently.

    Every JS file is concatenated into a single <script>, so a stray character
    in any of them throws before a line runs: no rail, no page, no error the
    build ever mentions. `test_no_duplicate_top_level_names` covers one way that
    happens. This covers the rest — in practice a backtick inside a template
    literal, because several slices carry a stylesheet in one and a backtick in
    a CSS comment ends the string.

    Needs node, which nothing else here requires. Without it the check says so
    instead of passing quietly, because a check that silently does nothing is
    worse than no check at all.
    """
    import os
    import shutil as sh
    import subprocess
    import tempfile

    node = sh.which("node")
    if not node:
        print("(skipped — no node, the bundle was not parsed)", end=" ")
        return

    # Keep the offsets so a failure names a file and a line in it, rather than
    # a line number in a 700 KB blob nobody can navigate.
    starts, bundle = {}, ""
    for rel in build.JS:
        starts[bundle.count("\n") + 1] = rel
        bundle += (VAULT / rel).read_text()

    path = tempfile.mkstemp(suffix=".js")[1]
    try:
        pathlib.Path(path).write_text(bundle)
        p = subprocess.run([node, "--check", path], capture_output=True, text=True)
    finally:
        os.unlink(path)
    if p.returncode == 0:
        return

    where, err = "", (p.stdout + p.stderr)
    m = re.search(r"\.js:(\d+)", err)
    if m:
        line = int(m.group(1))
        at = max((s for s in starts if s <= line), default=1)
        where = "\n  -> %s line %d" % (starts[at], line - at + 1)
    raise AssertionError("the page will come up blank — the bundle does not parse:"
                         + where + "\n" + err.strip())


def test_the_map_groups_a_place_and_dates_its_window():
    """The two bits of the events map that are arithmetic rather than markup.

    `evCut` was wrong the first time in exactly the way that never shows up in
    Europe: `Date.parse('2026-08-08T00:00:00')` reads local, `toISOString()`
    writes UTC, so in JST every window silently reached a day further back than
    it said. Run under TZ=Asia/Tokyo, because a check that would have passed in
    the timezone the bug needs is not a check.

    `evGroup` is the other half — two events at one address are one pin holding
    both, and the row indices it hands back are what the timeline entries below
    the map click through.
    """
    import os
    import shutil as sh
    import subprocess

    node = sh.which("node")
    if not node:
        print("(skipped — no node, the map's arithmetic was not run)", end=" ")
        return

    src = "".join((VAULT / rel).read_text()
                  for rel in ("slices/events/map.js", "slices/events/events.js"))
    # Both files register listeners at the top level. Stubbing the two calls is
    # enough to load them; nothing else in either runs until something asks.
    script = ("globalThis.document = {addEventListener(){}};\n"
              "globalThis.addEventListener = () => {};\n" + src + """
const rows = [{lat: 35.7, lon: 139.8}, {lat: null, lon: null},
              {lat: 35.7, lon: 139.8}, {lat: 36.5, lon: 136.6}];
console.log(JSON.stringify({
  cut: ['', '0', '7', '365'].map(d => evCut('2026-08-08', d)),
  groups: evGroup(rows).map(g => g.map(e => e.row))}));
""")
    p = subprocess.run([node, "-e", script], capture_output=True, text=True,
                       env={**os.environ, "TZ": "Asia/Tokyo"})
    assert p.returncode == 0, "the events map would not load:\n" + p.stderr.strip()
    got = json.loads(p.stdout)
    assert got["cut"] == ["", "2026-08-08", "2026-08-01", "2025-08-08"], \
        "the window is off by a day — %s" % got["cut"]
    assert got["groups"] == [[0, 2], [3]], \
        "one address should be one pin holding both events — %s" % got["groups"]


def test_the_sakura_is_the_same_tree_twice():
    """The tree has to be the *same* tree every time it is drawn.

    That is the whole reason it is seeded rather than random: a silhouette you
    recognise across visits is a thing you can read a change in, and one that
    reshuffles on every render is wallpaper. Nothing on the page would show the
    loss — each tree looks fine on its own — so the property is checked here
    instead: two draws of one slug are byte-identical, two slugs are not, and
    one blossom is one milestone.
    """
    import shutil as sh
    import subprocess

    node = sh.which("node")
    if not node:
        print("(skipped — no node, the sakura was not drawn)", end=" ")
        return

    src = (VAULT / "slices/projects/projects.js").read_text()
    # Everything below `sakura` reads the DOM or the timeline; the drawing is
    # self-contained above it, so the file is cut rather than stubbed whole.
    script = (src.split("function projectProgress")[0] + """
globalThis.esc = s => String(s);
globalThis.NOTES = [];
const ms = n => Array.from({length: n}, (_, i) => ({date: '2026-01-0' + (i % 9),
                                                   title: 'm' + i}));
globalThis.META = {projects: {a: {total: 60}, b: {total: 60}},
                   milestones: {a: ms(7), b: ms(7)}};
// The filter ids carry a per-render counter, which is the one thing that is
// *meant* to differ between two draws. Everything else has to match.
const draw = s => sakura(s, false).replace(/sak\\d+/g, '');
console.log(JSON.stringify({a1: draw('a'), a2: draw('a'), b: draw('b')}));
""")
    p = subprocess.run([node, "-e", script], capture_output=True, text=True)
    assert p.returncode == 0, "the sakura would not draw:\n" + p.stderr.strip()
    got = json.loads(p.stdout)
    assert got["a1"] == got["a2"], \
        "the tree changed between two renders of the same project — it is not seeded"
    assert got["a1"] != got["b"], \
        "two projects drew the same tree — the seed is not the slug"
    assert got["a1"].count("<g class=\"l") == 7, \
        "seven milestones should be seven blossoms, got %d" \
        % got["a1"].count("<g class=\"l")


def test_no_duplicate_top_level_names():
    """Every JS file is concatenated into one scope, so two of them declaring
    the same name is not a shadowing bug — it is a SyntaxError that throws
    before a single line runs, and the whole site comes up blank.

    Nothing else notices: build.py is happy, the page is served, and the only
    symptom is an empty rail. A `const ago` in the workout slice and another in
    sidebar.js cost exactly that, so the collision is caught here instead.
    """
    # Top-level declarations only: these files never indent their outermost
    # scope, so column zero is what "shared scope" means here.
    decl = re.compile(r"^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)", re.M)
    seen, clashes = {}, []
    for rel in build.JS:
        for name in decl.findall((VAULT / rel).read_text()):
            if name in seen:
                clashes.append(f"{name} in {rel} and {seen[name]}")
            seen[name] = rel
    assert not clashes, "declared twice in one scope: " + "; ".join(clashes)


def test_no_class_is_owned_by_two_files():
    """The stylesheet's version of the same hazard, and it fails more quietly.

    Every CSS file is concatenated in build.CSS order, so two files writing a
    rule for the same bare class is not a merge — the later one wins on every
    property it names, wherever that class is used. `.prog` was a dashboard row
    in shell/dashboard.css and an 8px progress rail in projects.css, and the
    long term goals on the Global Home rendered as a grey stripe with the text
    hanging out of it, on a page projects.css has nothing to do with.

    Only bare selectors count — exactly `.x`, or `.x:hover`. A slice reaching
    into a shell class through a parent (`.record .macros .bar i`) is scoped on
    purpose and is how the shell is meant to be extended; the collision is
    specifically two files claiming the unqualified name.
    """
    bare = re.compile(r"^\.([A-Za-z][\w-]*)(?::[\w-]+(?:\([^)]*\))?)*$")
    owns, clashes = {}, []
    for rel in build.CSS:
        text = re.sub(r"/\*.*?\*/", "", (VAULT / rel).read_text(), flags=re.S)
        for group in re.findall(r"([^{}]+)\{", text):
            for sel in group.split(","):
                m = bare.match(sel.strip())
                if not m:
                    continue
                cls, was = m.group(1), owns.get(m.group(1))
                if was and was != rel:
                    clashes.append(f".{cls} in {rel} and {was}")
                owns[cls] = rel
    assert not clashes, ("two files style the same class, and the later one "
                         "silently wins: " + "; ".join(sorted(set(clashes))))


def test_pages_hang_together():
    """Renaming a page is a `mv`, which is the point — and also how a link dies.

    Nothing else would notice: a dead `#/n/…` href just falls through to the
    dashboard, so the page looks fine and the link quietly goes nowhere. Three
    of these were left behind by one afternoon of reorganising.
    """
    import urllib.parse
    from core.pages import collect, sections
    pages, by = collect()

    dead = [(n["slug"], urllib.parse.unquote(h))
            for n in pages for h in re.findall(r'href="#/n/([^"]+)"', n["html"])
            if urllib.parse.unquote(h) not in by]
    assert not dead, "links to pages that do not exist: " + str(dead)

    # Every page is dated, and `ago()` is handed an ISO date or it prints
    # "Invalid Date" in the panel beside every title.
    undated = [n["slug"] for n in pages
               if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", n.get("edited", ""))]
    assert not undated, "pages with no usable edited date: " + str(undated)

    # A page at the root of pages/ has no folder above it, and a slug with no
    # slash used to rsplit back to itself. The panel walks parents upward to
    # open the folds around the page you are on, so a self-parent hangs the tab.
    selfish = [n["slug"] for n in pages if n["parent"] == n["slug"]]
    assert not selfish, "pages that are their own parent: " + str(selfish)

    # A slice placeholder with no entry in the JS registry renders an apology.
    js = (VAULT / "slices" / "pages" / "pages.js").read_text()
    # Registry entries are `name: <arrow fn>`; some take the page record.
    known = set(re.findall(r"(\w+):\s*\(?[\w\s,]*\)?\s*=>", js))
    used = {s for n in pages for s in re.findall(r'data-slice="(\w+)"', n["html"])}
    assert not used - known, "no such slice: " + str(sorted(used - known))

    # Every rail section must be reachable: a folder needs an index.html to land
    # on unless it declares a route of its own.
    homeless = [s["label"] for s in sections(pages)
                if s.get("folder") and not s.get("route")
                and not any(p["category"] == s["folder"] and p["home"] for p in pages)]
    assert not homeless, "rail sections with no index.html: " + str(homeless)

    # And every page must sit in a folder the rail actually offers.
    known_folders = {s.get("folder") for s in sections(pages)}
    stranded = [p["slug"] for p in pages if p["category"] and p["category"] not in known_folders]
    assert not stranded, "pages in a folder that is not a section: " + str(stranded)


def test_staged_type():
    """The panel's file view reads the Inbox, so a dropped file must be shown
    and never executed. .html is the one that matters: served as text/html on
    this origin, a file someone dropped would run as a page in it.
    """
    assert serve.staged_type("shot.png") == "image/png"
    assert serve.staged_type("2026-08-03 — lunch.md").startswith("text/plain")
    assert serve.staged_type("notes.csv").startswith("text/plain")
    assert serve.staged_type("page.html").startswith("text/plain")
    assert serve.staged_type("export.zip") == "application/octet-stream"
    assert serve.staged_type("noextension") == "application/octet-stream"


def test_home_widgets_have_renderers():
    """A widget in WIDGETS names a function; a typo there renders nothing.

    The board would still draw, still save, still list the widget as added —
    the card would just be missing, which is exactly the kind of failure the
    browser does not report.
    """
    js = "".join((VAULT / p).read_text() for p in build.JS)
    registry = re.search(r"const WIDGETS = \{(.*?)\n\};", js, re.S)
    assert registry, "slices/home/home.js must declare WIDGETS"
    named = re.findall(r"',\s*(\w+)\]", registry.group(1))
    assert named, "no render functions found in WIDGETS"
    for fn in named:
        assert re.search(r"\bfunction %s\(" % fn, js), "WIDGETS names a missing " + fn


def test_milestone_detail_carries_the_decisions():
    """A milestone's detail is the only place a *rejected* path survives.

    The tree, the timeline and `git log` between them record what was reached.
    None of them records what was tried and abandoned, what a subagent claimed
    and did not deliver, or what was proposed and turned down — and in six
    months that is the half worth having, because it is the half that stops the
    same dead end being walked into twice.

    So the account has a fixed shape, and `# What was dropped` is a section of
    it rather than something remembered when there happens to be something to
    say. An entry with nothing to put there says "nothing" in as many words:
    that is a fact about the work, and a heading quietly missing is not.

    Only rows from the day the shape was set, because the twelve before it were
    written to the old four and backfilling a rejected path nobody recorded
    would be inventing one.

    The rest of this is about the file the row points at. `detail` names a
    fragment now rather than holding prose, which introduces exactly one new way
    to fail silently: a row whose file is missing renders as a closed line, and
    a closed line is also what a milestone that needs no defending looks like.
    The two are indistinguishable on the page, so they are told apart here.
    """
    import csv as _csv
    from slices.projects.data import PARTS, read_milestone_parts

    START = "2026-08-08"
    WANT = ["Before", "The goal", "What changed", "What was dropped", "Long run"]
    f = VAULT / "Data" / "milestones.csv"
    checked, names = 0, {}
    for r in _csv.DictReader(f.open()):
        detail = (r.get("detail") or "").strip()
        where = "%s — %r" % (r.get("date"), r.get("title"))
        if not detail:
            continue
        assert detail.endswith(".html") and "/" not in detail, \
            "%s: detail must name a file in Data/milestones/, got %r" % (where, detail)
        assert (VAULT / "Data" / "milestones" / detail).exists(), \
            "%s: Data/milestones/%s does not exist — the entry would open onto " \
            "nothing, and look exactly like one that needs no account" % (where, detail)
        assert detail not in names, \
            "%s and %s point at the same file" % (where, names[detail])
        names[detail] = where

        parts, counts = read_milestone_parts(detail)
        assert parts.get("account"), \
            "%s: %s has no <section data-part=\"account\">" % (where, detail)
        assert set(parts) <= set(PARTS), \
            "%s: unknown part(s) %s" % (where, sorted(set(parts) - set(PARTS)))
        # A count that says 3 over a pane holding 5 is worse than no count.
        for part, mark in PARTS.items():
            if mark and parts.get(part):
                assert counts.get(part) == parts[part].count(mark), where

        if (r.get("date") or "") < START:
            continue
        checked += 1
        got = re.findall(r"<h4>(.*?)</h4>", parts["account"])
        assert got == WANT, \
            "%s: the account's sections are %s, expected %s" % (where, got, WANT)
    # Nothing to check yet is a pass, but a silent one would hide the day this
    # stopped running because the column was renamed.
    print("(%d of %d)" % (checked, len(names)), end=" ")


def test_a_draft_belongs_to_a_project_and_only_one_of_them():
    """The open draft is where a session's rejected paths live until they earn a
    milestone — so a draft that silently belongs to nothing loses exactly the
    content it exists to protect.

    Nothing on the page says so. A misspelt filename produces no bud, no error
    and no row; the tree looks exactly like a project with no work in progress,
    which is a state it is also allowed to be in. The two are told apart here.

    One draft per project is the other half, and it is what makes the bud safe:
    the tree can show at most one, so the thing we spent this whole design
    avoiding — a second, softer tier that accumulates until the drawing means
    nothing — cannot happen by construction rather than by discipline.
    """
    import csv as _csv
    from slices.projects.data import PARTS, read_milestone_drafts

    d = VAULT / "Data" / "milestones" / "_drafts"
    if not d.is_dir():
        print("(no drafts)", end=" ")
        return

    known = {(r.get("project") or "").strip()
             for r in _csv.DictReader((VAULT / "Data" / "projects.csv").open())}
    known |= {n.slug for n in build.read_pages()} if hasattr(build, "read_pages") else set()

    drafts = read_milestone_drafts()
    files = sorted(d.glob("*.html"))
    assert len(drafts) == len(files), \
        "a draft file parsed to nothing — it needs at least one <section data-part=…>"

    for slug, draft in drafts.items():
        assert known and slug in known, \
            "_drafts/%s.html is not a project — %r matches no row in projects.csv, " \
            "so it draws no bud and reports no error" % (slug.replace("/", "--"), slug)
        assert set(draft["parts"]) <= set(PARTS), \
            "%s: unknown part(s) %s" % (slug, sorted(set(draft["parts"]) - set(PARTS)))
        assert draft["since"], \
            "%s: the account section needs data-since=\"YYYY-MM-DD\" — it is what " \
            "the bud's hover reports, and an undated draft cannot go stale visibly" % slug

    # The filename *is* the uniqueness guarantee; this proves the mapping is
    # one-to-one rather than trusting that it looks like it.
    assert len({s for s in drafts}) == len(files), "two files claim one project"
    print("(%d draft%s)" % (len(files), "" if len(files) == 1 else "s"), end=" ")


def test_project_history():
    """The history ships as a flat run of days and the page indexes into it, so
    the start date is load-bearing: shift it by one and every commit is dated
    wrong on the tree, with nothing to give it away.
    """
    import datetime
    import slices.projects.data as pdata
    # This checkout's own first commit has not happened yet the very first
    # time this runs — pre-commit runs before the commit it is gating exists —
    # so there is genuinely no history anywhere to draw a calendar from. Not a
    # failure, the same way a project with no `.git` at all is not one.
    root = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(pdata.REPO),
                          capture_output=True)
    if root.returncode != 0:
        return
    # REPOS ships empty in a fresh instance — see the comment beside it — so
    # this exercises the mechanism against the one repository guaranteed to
    # exist: whichever one this test is running inside of.
    keep = pdata.REPOS
    pdata.REPOS = {"engine-self-test": pdata.REPO}
    try:
        acts = pdata.project_activity()
    finally:
        pdata.REPOS = keep
    assert acts, "no project repository resolved — .git is gone from this checkout"
    for slug, a in acts.items():
        start = datetime.date.fromisoformat(a["start"])
        assert start.weekday() == 6, f"{slug}: grid must start on a Sunday"
        assert len(a["counts"]) == (datetime.date.today() - start).days + 1, \
            f"{slug}: one square per day, ending today"
        assert sum(a["counts"]) == a["total"], f"{slug}: total must match the petals"
        # The date the progress bar measures from — the root commit, which is
        # older than the calendar's window and so is not covered by the above.
        assert datetime.date.fromisoformat(a["first"]) <= datetime.date.today(), \
            f"{slug}: first commit is not a past date"

    # The blossom eye is coloured by the recency ramp, one class per step, and a
    # step with no rule behind it is not a broken build — it is a flower that
    # silently comes out the palest pink. The JS emits `l${step}`; the CSS has
    # to answer for every step the JS can produce.
    js = (VAULT / "slices" / "projects" / "projects.js").read_text()
    css = (VAULT / "slices" / "projects" / "projects.css").read_text()
    steps = set(re.findall(r"age < \d+ \? (\d)", js)) | {"1"}
    # Matched on the step class rather than the whole rule: which shape inside the
    # blossom carries the ramp has moved once already, from the lobes to the eye,
    # and pinning the element would fail the next time the flower is redrawn.
    flat = css.replace("\n", "")
    for s in sorted(steps):
        assert re.search(r"\.l%s\b[^{]*\{[^}]*--ramp-%s\)" % (s, s), flat), \
            "no ramp fill for blossom step l%s in projects.css" % s


def test_activity_scope():
    """Recent activity is what was logged, not what was built.

    The filter is per commit: one that touches the shell, a slice or the build
    is development and must not appear at all, even though it also moved pages.
    Filtering only the file list is what let a refactor read as though a page
    had been written.
    """
    from slices.activity.data import APP_SOURCE, CONTENT, content_of

    # An inbox run, or a model writing rows: content only, so it counts.
    assert content_of(["Websidian/Data/intake.csv"]) == ["Websidian/Data/intake.csv"]
    assert content_of(["Websidian/pages/work/index.html", "Websidian/Data/weight.csv"]) == [
        "Websidian/pages/work/index.html", "Websidian/Data/weight.csv"]

    # A development commit is dropped whole, however many pages it also moved —
    # filtering the file list alone is what let a refactor read as a page edit.
    assert content_of(["Websidian/slices/home/home.js",
                       "Websidian/pages/work/index.html"]) == []
    for src in ("Websidian/shell/base.css", "Websidian/core/pages.py",
                "Websidian/build.py", "Websidian/README.md", "Websidian/test_build.py"):
        assert content_of([src, "Websidian/Data/intake.csv"]) == [], src

    # Neither content nor application: the neighbouring app, or a stray file.
    assert content_of(["Design Library/build.py", ".gitignore"]) == []

    for commit in build.git_activity(limit=60):
        assert commit["files"], "a commit with no content files must be dropped"
        assert len(commit["files"]) <= 8
        for f in commit["files"]:
            assert f.startswith(CONTENT) and not f.startswith(APP_SOURCE), f


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok  ", name)
    print("\nall checks passed")
