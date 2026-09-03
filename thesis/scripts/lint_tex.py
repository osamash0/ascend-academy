#!/usr/bin/env python3
"""Static checks on the thesis sources that do not require a LaTeX toolchain.

Catches the errors that are tedious to find in a 200-page compile log, and the
one an examiner notices: a figure that is never discussed in the text.

Run via `make lint`. Exits non-zero on problems, zero on warnings alone.

Note on labels: figures are included through the \\thesisfigure macro, whose
third argument becomes the \\label. A naive search for \\label{} therefore
reports every figure cross-reference as undefined, so the macro's third
argument is parsed as a label definition here. preamble.tex is skipped for
label extraction because its macro bodies contain \\label{#3}, not real labels.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIGDIR = ROOT / "figures"
TOTAL_FIGURES = 19

FIG_MACRO_FILE = re.compile(r"\\thesisfigure(?:page)?\{([^}]+)\}\s*\{")
FIG_MACRO_LABEL = re.compile(r"\\thesisfigure(?:page)?\{[^}]*\}\s*\{.*?\}\s*\{([^}]+)\}", re.S)


def strip_comments(text: str) -> str:
    return re.sub(r"(?<!\\)%.*", "", text)


def tex_files() -> list[pathlib.Path]:
    return sorted(
        list(ROOT.glob("*.tex"))
        + list((ROOT / "chapters").glob("*.tex"))
        + list((ROOT / "frontmatter").glob("*.tex"))
    )


def main() -> int:
    files = tex_files()
    problems: list[str] = []
    warnings: list[str] = []

    figures: set[str] = set()
    labels: dict[str, list[str]] = {}
    refs: dict[str, list[str]] = {}

    for path in files:
        body = strip_comments(path.read_text())
        rel = path.relative_to(ROOT)

        for m in re.finditer(r"\\(?:input|include)\{([^}]+)\}", body):
            if not (ROOT / (m.group(1) + ".tex")).exists():
                problems.append(f"{rel}: missing \\input/\\include target {m.group(1)}.tex")

        figures.update(m.group(1) for m in FIG_MACRO_FILE.finditer(body))

        if path.name != "preamble.tex":
            for m in re.finditer(r"\\label\{([^}]+)\}", body):
                labels.setdefault(m.group(1), []).append(path.name)
            for m in FIG_MACRO_LABEL.finditer(body):
                labels.setdefault(m.group(1), []).append(path.name)

        for m in re.finditer(r"\\[Cc]refs?\{([^}]+)\}|\\ref\{([^}]+)\}", body):
            for group in m.groups():
                if group:
                    for one in group.split(","):
                        refs.setdefault(one.strip(), []).append(path.name)

        if body.count("{") != body.count("}"):
            problems.append(
                f"{rel}: brace imbalance ({body.count('{')} open, {body.count('}')} close)"
            )
        for env in set(re.findall(r"\\begin\{(\w+\*?)\}", body)):
            opened = len(re.findall(r"\\begin\{" + re.escape(env) + r"\}", body))
            closed = len(re.findall(r"\\end\{" + re.escape(env) + r"\}", body))
            if opened != closed:
                problems.append(
                    f"{rel}: environment '{env}' unbalanced ({opened} begin, {closed} end)"
                )

    for fig in sorted(figures):
        if not (FIGDIR / f"{fig}.pdf").exists():
            problems.append(f"figure PDF missing: figures/{fig}.pdf — run 'make figures'")

    for label, where in labels.items():
        if len(where) > 1:
            problems.append(f"duplicate \\label{{{label}}} in {where}")

    for ref, where in refs.items():
        if ref not in labels:
            problems.append(f"\\cref to undefined label '{ref}' in {sorted(set(where))}")

    # An unreferenced float is the classic examiner objection: the figure exists
    # but the text never discusses it. Warn, don't fail — prose is still being
    # written.
    for label in sorted(labels):
        if label.startswith(("fig:", "tab:")) and label not in refs:
            warnings.append(f"never referenced in text: {label}")

    if len(figures) < TOTAL_FIGURES:
        warnings.append(
            f"only {len(figures)} of {TOTAL_FIGURES} available figures are used"
        )

    print(
        f"files {len(files)}  ·  figures wired {len(figures)}/{TOTAL_FIGURES}  ·  "
        f"labels {len(labels)}  ·  cross-refs {len(refs)}"
    )
    if warnings:
        print("\nwarnings (not blocking):")
        for w in warnings:
            print(f"  · {w}")
    if problems:
        print("\nPROBLEMS:")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("\nno structural problems found")
    return 0


if __name__ == "__main__":
    sys.exit(main())
