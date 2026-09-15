#!/usr/bin/env python3
"""Generate a local, browsable site for the whole vault.

    python3 "$HOME/Workspace/Personal Projects/Vault/Websidian/build.py" && open "$HOME/Workspace/Personal Projects/Vault/Websidian/index.html"

Output only — the content under this folder is the source of truth and
`Websidian/index.html` is rewritten on every build. Not the same thing as
"Design Library/", which is a second application beside this one with its own
git remote; the two share only `Inbox/`, and nothing here is ever published.

The page is assembled from the lists below and stays a single self-contained
file: a `<script src>` would break the `file://` fallback, which is the whole
reason the redirect probe in `shell/head.html` exists.

Order is explicit rather than discovered. A file that is not listed is not in
the page, and reading the list tells you what the page is made of. For JS only
the two ends matter — `shell/sidebar.js` declares NOTES/META, `shell/capture.js`
boots — because everything between is function declarations, which hoist.
"""
import datetime
import json
import pathlib
import re
import shutil
import subprocess

from core.pages import collect, copy_referenced_assets, sections
from core.vault import (APP, ASSETS, OUT, REPO,                   # noqa: F401
                        VAULT, copy_asset)
from slices.activity.data import git_activity
from slices.projects.data import (project_activity, read_challenges,
                                  read_milestone_drafts, read_milestones,
                                  read_project_log, read_project_meta)
from slices.entities.data import VIA, read_entities
from slices.events.data import read_events, read_places
from slices.finance.data import finance
from slices.sleep.data import read_sleep
from slices.supplements.data import supplements
from slices.todo.data import read_cadence
from slices.work.data import read_work_log
from slices.people.data import misspelt_people, read_people
from slices.workout.data import read_workout
from slices.intake.data import (ingredient_conflicts, ingredient_table,   # noqa: F401
                                num, read_favorites, read_ingredients, read_intake,
                                read_measurements, read_phases, read_recipes, read_targets,
                                read_weight)

HERE = pathlib.Path(__file__).resolve().parent

CSS = [
    "shell/base.css",
    "shell/console.css",
    "shell/layout.css",
    "slices/pages/pages.css",
    "shell/controls.css",
    "slices/inbox/inbox.css",
    "shell/dashboard.css",
    "slices/events/map.css",
    "slices/projects/projects.css",
    "slices/intake/intake.css",
    "slices/workout/workout.css",
    "slices/work/work.css",
    "slices/finance/finance.css",
    "slices/todo/todo.css",
    "slices/supplements/supplements.css",
    "slices/sleep/sleep.css",
    "slices/entities/entities.css",
]

JS = [
    "shell/sidebar.js",
    "slices/activity/activity.js",
    "shell/readonly.js",
    "shell/compose.js",
    "shell/timeline.js",
    "slices/intake/intake.js",
    "slices/intake/quicklog.js",
    "slices/intake/today.js",
    "slices/intake/bind.js",
    "slices/home/home.js",
    "slices/projects/projects.js",
    "slices/people/people.js",
    "slices/events/map.js",
    "slices/events/events.js",
    "slices/entities/entities.js",
    "slices/workout/workout.js",
    "slices/work/work.js",
    "slices/finance/finance.js",
    "slices/todo/todo.js",
    "slices/todo/calendar.js",
    "slices/supplements/supplements.js",
    "slices/sleep/sleep.js",
    "slices/pages/pages.js",
    "shell/router.js",
    "shell/api.js",
    "slices/inbox/inbox.js",
    "shell/capture.js",
]


# The basemap ships inside the page like everything else. Only the group is
# wanted — the file keeps its own <svg> wrapper so it can be opened and looked
# at on its own, which a bare fragment could not be.
LAND = re.compile(r'<g class="ev-land">.*?</g>', re.S)
LAYER = re.compile(r'<g class="ev-layer" data-zoom="([\d.]+)" data-ox="(-?[\d.]+)"'
                   r' data-oy="(-?[\d.]+)">(.*?)</g>', re.S)


def basemap():
    """The land paths, or nothing. A missing basemap costs the map its
    background and no more, so it is not worth failing a build over."""
    f = HERE / "slices" / "events" / "basemap.svg"
    if not f.exists():
        return ""
    m = LAND.search(f.read_text())
    return m.group(0) if m else ""


def layers():
    """Every city-scale layer as {zoom, paths}, in file-name order.

    A glob rather than a list, because that is the whole promise of the layer
    idea: the world map is one projection and a layer is more paths in it, so
    adding Seoul is `tolayer.py` run once and a file dropped beside this one.
    Nothing else in the build learns about it, and `map.js` shows each layer at
    the tier its own `data-zoom` claims — which is what keeps a file drop from
    also being an edit.

    Taken apart here rather than passed through whole so the page can render a
    layer the same way it renders a pin or a name: one record, one element, one
    rule about when it is visible.

    `ox`/`oy` is the origin its coordinates were written against — see the note
    in `tolayer.py` about why they are not absolute.
    """
    out = []
    for f in sorted((HERE / "slices" / "events").glob("layer-*.svg")):
        m = LAYER.search(f.read_text())
        if m:
            out.append({"zoom": float(m.group(1)), "ox": float(m.group(2)),
                        "oy": float(m.group(3)), "paths": m.group(4).strip()})
    return out


def template():
    """The whole page, in source order. Kept as one string so the output is a
    single file with no external requests."""
    read = lambda p: (HERE / p).read_text()
    return (read("shell/head.html")
            + "<style>\n" + "".join(read(p) for p in CSS) + "</style>\n"
            + read("shell/body.html")
            + "<script>\n" + "".join(read(p) for p in JS) + "</script>\n")


# Everything the build already notices about its own health, and until now threw
# away. The readers detect every way a skill run can corrupt the data — they just
# said so once, to the terminal, to nobody. See "What maintenance watches" in
# README.md for what each signal means and who is supposed to react to it.
REPORT = HERE / "_evals" / "builds.jsonl"


def git_head():
    """The commit this build came from, and whether the tree was clean.

    The dirty flag is not decoration. Most builds during development run on
    uncommitted work, and without it a later reading of `git diff a..b` would
    confidently explain a regression that never lived in either commit. Scoped
    to this application so a file dropped in the shared Inbox — which belongs to
    the neighbour as often as to us — does not mark every build dirty.
    """
    def git(*args):
        try:
            return subprocess.run(("git",) + args, cwd=str(REPO), text=True,
                                  capture_output=True).stdout.strip()
        except OSError:
            return ""
    return git("rev-parse", "--short", "HEAD"), bool(git("status", "--porcelain",
                                                        "--", APP.name))


def record(signals):
    """Append one line, but only if these signals differ from the last ones.
    Returns whether it wrote.

    `serve.py` rebuilds on any page load with stale source, so a line per build
    would be hundreds of identical rows a day and nobody would ever read it.
    What survives instead is a change log — which is also the only shape the
    triage step can diff, since "what moved between these two builds" is the
    whole question.

    Comparison goes through JSON rather than the objects: `ingredient_conflicts()`
    returns tuples that come back from a round trip as lists, and comparing those
    directly would report a change on every single build.
    """
    blob = json.dumps(signals, ensure_ascii=False, sort_keys=True)
    try:
        lines = [l for l in REPORT.read_text().splitlines() if l.strip()]
        prev = json.loads(lines[-1])["signals"] if lines else None
    except (OSError, ValueError, KeyError):
        prev = None
    if prev is not None and json.dumps(prev, ensure_ascii=False, sort_keys=True) == blob:
        return False
    sha, dirty = git_head()
    entry = {"at": datetime.datetime.now().isoformat(timespec="seconds"),
             "sha": sha, "dirty": dirty, "signals": signals}
    try:
        with REPORT.open("a") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        return False
    return True


def changed_since(signals):
    """The signal names that moved, or None when there was nothing to move from.

    A first line is not four regressions — it is the first time anything was
    written down, and saying so is the difference between a build that looks
    alarming and one that looks new.
    """
    try:
        lines = [l for l in REPORT.read_text().splitlines() if l.strip()]
        if len(lines) < 2:
            return None
        prev = json.loads(lines[-2])["signals"]
    except (OSError, ValueError, KeyError):
        return None
    dump = lambda v: json.dumps(v, ensure_ascii=False, sort_keys=True)
    return sorted(k for k in signals if dump(signals[k]) != dump(prev.get(k)))


def main():
    shutil.rmtree(ASSETS, ignore_errors=True)
    ASSETS.mkdir(parents=True)
    notes, _ = collect()
    missing = copy_referenced_assets(notes)
    intake, unknown, nutrients = read_intake()
    events, events_unknown = read_events()
    workout, workout_unknown = read_workout()
    work, work_unknown = read_work_log()
    fin = finance()
    cadence, cadence_unknown = read_cadence()
    supps, supp_nutrients, supp_unknown = supplements()
    challenges, challenges_unknown = read_challenges()
    sleep, sleep_bad = read_sleep()
    measured, measured_notes, measured_unknown = read_measurements()
    people, entities = read_people(), read_entities()
    meta = {"activity": git_activity(), "targets": read_targets(),
            "projects": project_activity(),
            "projectmeta": read_project_meta(), "milestones": read_milestones(),
            "projectlog": read_project_log(),
            "challenges": challenges,
            "supplements": supps, "supplementNutrients": supp_nutrients,
            "supplementUnknown": supp_unknown,
            "sleep": sleep, "sleepUnknown": sleep_bad,
            "drafts": read_milestone_drafts(),
            "people": people, "events": events,
            "eventsUnknown": events_unknown, "basemap": basemap(),
            "places": read_places(), "layers": layers(),
            # Shipped rather than restated in JS: the value set is validated
            # against this dict, so a copy in the renderer could disagree with
            # what the build will accept.
            "entities": entities, "via": VIA,
            "workout": workout, "workoutUnknown": workout_unknown,
            "work": work, "workUnknown": work_unknown,
            "finance": fin,
            "cadence": cadence, "cadenceUnknown": cadence_unknown,
            "sections": sections(notes),
            "intake": intake, "intakeUnknown": unknown, "nutrients": nutrients,
            "favorites": read_favorites(),
            "weight": read_weight(), "recipes": read_recipes(),
            "phases": read_phases(), "measured": measured,
            "measuredNotes": measured_notes, "measuredUnknown": measured_unknown,
            "ingredients": ingredient_table(),
            "dupes": dict(zip(("collision", "twin"), ingredient_conflicts()))}
    page = (template().replace("__DATA__", json.dumps(notes, ensure_ascii=False))
                      .replace("__META__", json.dumps(meta, ensure_ascii=False)))
    (OUT / "index.html").write_text(page)
    print("%s — %d pages in %d folder(s), %d assets" % (
        OUT / "index.html", len(notes), len([s for s in sections(notes) if s.get("folder")]),
        len(list(ASSETS.iterdir()))))
    if missing:
        print("  broken image references, no such attachment: " + ", ".join(missing))

    # Row counts sit beside the pages count because they answer the same
    # question — how much content is there — and a skill run that appends 400
    # rows where 4 were expected shows up here and nowhere else.
    counts = {p.stem: max(sum(1 for _ in p.open()) - 1, 0)
              for p in sorted((APP / "Data").glob("*.csv"))}
    counts["pages"] = len(notes)
    signals = {"unknown": {"intake": unknown, "workout": workout_unknown,
                           "work": work_unknown, "events": events_unknown,
                           "cadence": cadence_unknown,
                           "challenges": challenges_unknown,
                           "measurements": measured_unknown,
                           "sleep": sleep_bad},
               "dupes": meta["dupes"], "missing_assets": missing, "rows": counts,
               "misspelt_people": misspelt_people(people, entities, events, work),
               "uncategorised_spend": [m for m, _ in fin["unclassified"][:6]]}
    if record(signals):
        moved = changed_since(signals)
        print("  recorded — %s" % (", ".join(moved) if moved else "first build"))


if __name__ == "__main__":
    main()
