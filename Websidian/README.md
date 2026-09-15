# Websidian — engine

This is the generic base, not a person's vault. It renders whatever HTML you
write under `pages/`, whatever rows land in `Data/*.csv`, and nothing else —
no personal facts, no attachments, no history. Clone it, add your own pages
and data, and it is a vault.

## What it is

A personal web application: pages are HTML fragments you write by hand or a
Claude Code session writes for you, captured through a shared `Inbox/` and
turned into rows in `Data/` by whatever skill owns that folder. The rendered
site is one self-contained `index.html` with no external requests, so it
still opens as `file://` if nothing is serving it.

Run it:

```
python3 Websidian/serve.py   ->  http://127.0.0.1:8765
```

or build it once without serving:

```
python3 Websidian/build.py
```

## What ships here, and what does not

**Ships:** the build (`build.py`, `serve.py`), the render pipeline
(`core/`, `shell/`, `slices/`), the test suite (`test_build.py`), and every
`Data/*.csv` as a header-only stub — the columns a reader expects, zero rows.
Four example pages under `pages/` show the conventions: a section needs an
`index.html` to be reachable, a project is a page under
`personal-projects/<status>/`, a capture in `Inbox/Work/` becomes a row in
`work-log.csv`.

**Does not ship:** any real capture, any real page beyond the four examples,
`_attachments/`, and the personal-history parts of the events map — the
public-domain world coastline (`slices/events/basemap.svg`) stayed, because it
is Natural Earth data with nothing personal in it; the layer SVGs that traced
actual visited neighbourhoods did not.

## Layout

Every `.py`/`.js`/`.css`/`.html`/`.svg` under `core/`, `shell/` and `slices/`,
plus the three files at the root. `test_readme_covers_the_layout` fails the
build if this tree and the files on disk disagree in either direction.

```
Websidian/
  README.md
  build.py
  core/
    pages.py
    vault.py
  serve.py
  shell/
    api.js
    base.css
    body.html
    capture.js
    compose.js
    console.css
    controls.css
    dashboard.css
    head.html
    layout.css
    readonly.js
    router.js
    sidebar.js
    timeline.js
  slices/
    activity/
      activity.js
      data.py
    entities/
      data.py
      entities.css
      entities.js
    events/
      basemap.svg
      data.py
      events.js
      map.css
      map.js
      tolayer.py
      tonames.py
    finance/
      data.py
      finance.css
      finance.js
      tospend.py
    home/
      home.js
    inbox/
      inbox.css
      inbox.js
    intake/
      bind.js
      data.py
      intake.css
      intake.js
      quicklog.js
      today.js
    pages/
      pages.css
      pages.js
    people/
      data.py
      people.js
    projects/
      data.py
      projects.css
      projects.js
    sleep/
      data.py
      sleep.css
      sleep.js
    supplements/
      data.py
      supplements.css
      supplements.js
    todo/
      calendar.js
      data.py
      todo.css
      todo.js
    work/
      data.py
      work.css
      work.js
    workout/
      data.py
      workout.css
      workout.js
  test_build.py
```

## Conventions a page relies on

- **The first `<h1>` is the title.** No frontmatter.
- **The folder is the section.** `pages/work/index.html` is Work Home;
  `pages/personal-projects/active/example.html` is an active project.
  Recategorising is `mv`.
- **`index.html` is a section's home page.** A folder with pages but no
  `index.html` fails `test_pages_hang_together` — the rail button would have
  nowhere to land.
- **The rail itself is declared, not discovered** — `SECTIONS` in
  `core/pages.py`. A folder with no matching entry there renders pages but
  never gets a rail button; a section with an entry but no pages simply does
  not appear (`sections()` drops empty rooms). Add or remove a room by
  editing that one list.
- **A page can host a generated block** — `<div data-slice="…">` — as long
  as the name is registered in `slices/pages/pages.js`'s `SLICES` map.
  `test_pages_hang_together` fails if a page names a slice nothing renders.

## Vendoring this into an instance

An instance is this engine plus its own `pages/`, its own `Data/*.csv` rows,
and whatever skills it runs to fill them — nothing here changes. Two are
possible without touching a line of this codebase:

- **Fewer sections.** Delete a folder under `pages/` and its entry in
  `SECTIONS`; the rail shrinks to match. The example vault this engine was
  cut from runs eight sections; a narrower instance might run four.
- **A different capture pipeline.** The example vault routes `Inbox/Work/`
  through a work-log skill and everything else through a page-writing one.
  Nothing here requires that particular pair — only that whatever writes
  `Data/*.csv` writes it with `csv.DictWriter(..., lineterminator="\n")`,
  which `test_data_files_are_lf` enforces on every build.

## Testing

```
python3 Websidian/test_build.py
```

Covers the two trust boundaries any client-supplied path crosses
(`serve.py`'s `editable_path`/`inside_inbox`), the readers that turn a CSV
into what a page shows, and the README-matches-the-tree check above.
Content-dependent checks that need a real vault's own data to mean anything —
map geography tied to real coordinates, nutrient-ceiling arithmetic, a
retrieval eval scored against real captures — travelled with the vault this
engine was cut from rather than with the engine itself.
