"""Recent edits, read from git rather than frontmatter."""
import subprocess

from core.vault import APP, REPO

# What counts as *content*: pages you wrote, data that was logged, attachments.
CONTENT = tuple(f"{APP.name}/{d}/" for d in ("pages", "Data", "_attachments"))

# ...and what counts as the application itself. A commit that touches any of
# these is development, however many pages it also happens to move.
APP_SOURCE = tuple(f"{APP.name}/{d}" for d in
                   ("shell/", "slices/", "core/", "_evals/",
                    "build.py", "serve.py", "test_build.py", "README.md"))


def content_of(files):
    """The content files of a commit, or nothing if it is a development commit.

    Split out from the log walk so it can be tested against a file list — the
    repository's own history is all development so far, which would make an
    assertion over real commits pass by being empty.
    """
    if any(f.startswith(APP_SOURCE) for f in files):
        return []
    return [f for f in files if f.startswith(CONTENT)]


def git_activity(limit=60):
    """Content activity: what was logged into the vault, not what was built.

    Frontmatter `updated:` is bulk-set and lies; git doesn't. git runs at REPO
    and prints paths relative to it, so the filters carry this application's
    folder name.

    The rule is per commit, not per file, and that is the whole point. Filtering
    files alone let a refactor that happened to touch one page appear as though
    a page had been written — the subject line said "rebuild the sidebar" and
    the card called it activity. A commit that touches the shell, the slices or
    the build is development and is dropped entirely, however much content it
    also moved. What survives is the sessions that only wrote content: an inbox
    run adding rows to intake.csv, a page edited in the browser, notes added by
    a model. During heavy development that is legitimately nothing.
    """
    fmt = "%x00%h%x1f%ad%x1f%s"
    r = subprocess.run(["git", "log", f"-{limit}", "--date=short", f"--format={fmt}",
                        "--name-only"], cwd=str(REPO), capture_output=True, text=True)
    out = []
    for chunk in r.stdout.split("\x00")[1:]:
        head, _, files = chunk.partition("\n")
        h, date, subject = head.split("\x1f")
        content = content_of([f for f in files.strip().splitlines() if f])
        if not content:
            continue
        out.append({"hash": h, "date": date, "subject": subject.split("\n")[0],
                    "files": content[:8], "more": max(0, len(content) - 8)})
    return out


# 항목 -> the English the vault's own notes use. Korean is kept in the tooltip.
