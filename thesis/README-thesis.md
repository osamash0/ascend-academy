# Thesis build

LaTeX skeleton for *From Lecture Materials to Structured Educational Content:
Design and Implementation of an AI-Assisted Learning Platform*.

> ### ⚠ This skeleton has never been compiled
>
> No LaTeX toolchain exists on the machine where it was written, so it is
> verified **structurally only** — every `\input` target resolves, all 19 figure
> PDFs exist, no duplicate labels, no dangling `\cref`, balanced braces and
> environments (`make lint`). Expect to fix a handful of real compile errors on
> the first `make`. That is normal for an unbuilt skeleton; it is not a sign
> something is deeply wrong.

## 1. Finish installing MacTeX

`brew list --cask` reports `mactex-no-gui` as installed, but it isn't. The
6.9 GB payload downloaded to the Caskroom and the privileged installer step
never ran — there is no `/usr/local/texlive`, no `/Library/TeX/texbin`, and no
package receipt. MacTeX ships a `.pkg` that requires `sudo`, which Homebrew
cannot complete unattended.

The download is already done. Run the installer directly:

```bash
sudo installer -pkg /opt/homebrew/Caskroom/mactex-no-gui/2026.0324/mactex-20260324.pkg \
               -target /
```

Then open a new shell and confirm:

```bash
eval "$(/usr/libexec/path_helper)"   # or just restart your terminal
make -C thesis check                 # pdflatex / latexmk / biber should all say OK
```

If `pdflatex` still isn't found, add TeX to your `PATH`:

```bash
echo 'export PATH="/Library/TeX/texbin:$PATH"' >> ~/.zshrc
```

## 2. Build

```bash
make            # figures if stale, then the full document via latexmk
make quick      # one pdflatex pass, no bibliography — fast prose preview
make lint       # static checks, no LaTeX needed
make check      # lint + toolchain + figure availability
make todos      # every outstanding \TODO with file and line
make wordcount  # approximate body word count
make clean      # remove build artefacts, keep the PDF
```

Output lands at `thesis/main.pdf`; intermediates stay in `thesis/build/`.

## 3. Layout

```
thesis/
  main.tex                 class choice + document order — start here
  preamble.tex             all packages and the \thesisfigure macro
  metadata.tex             title-page data, in one place
  references.bib           software/spec citations; academic sources are yours to add
  frontmatter/             title page, declaration, abstract
  chapters/01..07 + appendix
  figures/                 19 vector PDFs + PlantUML sources (own Makefile)
  scripts/lint_tex.py      the static checker behind `make lint`
```

**Reparenting for a university template.** Most institutes supply a class or
style file. This skeleton keeps that swap cheap: change the class on one line in
`main.tex`, replace `preamble.tex` and `frontmatter/titlepage.tex`, and leave
every chapter untouched — chapter files contain no formatting decisions.

## 4. Two things that will bite you

**PDF 2.0 figure inclusion.** PlantUML emits PDF 2.0, and pdfTeX refuses to
`\includegraphics` a PDF newer than its own output version:

```
PDF inclusion: found PDF version <2.0>, but at most version <1.7> allowed
```

`preamble.tex` already raises the output version, which fixes this on TeX Live
2023+. If you still hit it, switch the figure pipeline to EPS: set
`PDF_FLAG = -teps` in `figures/Makefile` and add an `epstopdf` step (`epstopdf`
ships with TeX Live).

**`make lint` warns about unreferenced figures.** Seven currently have no
`\cref` in the text. That's expected while the prose is `\TODO` placeholders,
but a figure the text never discusses is a standard examiner objection — so keep
the warning list at zero before submitting.

## 5. Before submitting

- [ ] Fill every `\TODO` — `make todos` lists them; `\todosoff` in
      `metadata.tex` hides the markers so you can read the PDF looking for holes
- [ ] **Replace `frontmatter/declaration.tex`** with your institute's official
      wording. The placeholder is generic and almost certainly not what your
      examination regulations require. Check the rules on declaring AI-tool use
- [ ] **F19 (Results) is an empty scaffold.** Run
      `python -m backend.eval.run_eval` and fill it, or remove the figure and
      §Results entirely. Do not submit a placeholder results figure
- [ ] **F2 (Positioning) needs your related-work sources.** Its families come
      from the codebase, not a literature search; it carries an explicit
      "not a survey" caveat until you populate it
- [ ] Re-verify the appendix constants and the honesty ledger against current
      code — the codebase has moved since `docs/thesis/ARCHITECTURE_PRIMER.md`
      was written
- [ ] Confirm the RQ reframing with your supervisor. RQ2 and RQ3 are perception
      questions requiring participants, and no study was conducted — either
      scope them out or contribute a study design
- [ ] `make lint` clean, including zero unreferenced-figure warnings

## 6. Source of truth

Every architectural claim traces to code at revision `0be0081`, not to project
documentation. A systematic comparison found **12 documented claims that do not
hold**, including the repository's headline feature description. See
`docs/thesis/ARCHITECTURE_PRIMER.md` §6 for the ledger and
`figures/MANIFEST.md` for per-figure provenance.

**Do not cite `README.md` or `docs/` for any architectural claim.**
