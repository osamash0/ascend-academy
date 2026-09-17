# Thesis build.
#
#   make            figures (if stale) + full document via latexmk
#   make quick      one pdflatex pass, no bibliography — fast prose preview
#   make figures    regenerate figure PDFs only
#   make check      verify the toolchain and that every \includegraphics resolves
#   make todos      list every outstanding \TODO with file and line
#   make wordcount  approximate body word count (excludes preamble and TODOs)
#   make clean      remove build artefacts, keep the PDF
#   make distclean  remove the PDF too
#
# latexmk handles the pdflatex/biber/pdflatex/pdflatex dance, including running
# only as many passes as cross-references actually need.

LATEXMK ?= latexmk
MAIN     = main
OUT      = build

# The figure PDFs are a build input, so the document depends on them.
FIGDIR   = figures
FIGSRC   = $(wildcard $(FIGDIR)/src/f*.puml)
FIGPDF   = $(patsubst $(FIGDIR)/src/%.puml,$(FIGDIR)/%.pdf,$(FIGSRC))

TEXFILES = $(MAIN).tex preamble.tex metadata.tex references.bib \
           $(wildcard chapters/*.tex) $(wildcard frontmatter/*.tex)

PYTHON  ?= python3

.PHONY: all quick figures check lint todos todos-count wordcount clean distclean help
.DEFAULT_GOAL := all

all: $(MAIN).pdf

$(MAIN).pdf: $(TEXFILES) $(FIGPDF)
	@command -v $(LATEXMK) >/dev/null || { \
	  echo "latexmk not found — see 'make check'"; exit 1; }
	$(LATEXMK) -pdf -bibtex- -interaction=nonstopmode -halt-on-error \
	  -outdir=$(OUT) $(MAIN).tex
	@cp $(OUT)/$(MAIN).pdf ./$(MAIN).pdf
	@echo
	@echo "  built ./$(MAIN).pdf"
	@$(MAKE) --no-print-directory todos-count

# Delegate to the figures Makefile, which owns the PlantUML invocation.
figures:
	@$(MAKE) --no-print-directory -C $(FIGDIR) figures

$(FIGDIR)/%.pdf: $(FIGDIR)/src/%.puml
	@$(MAKE) --no-print-directory -C $(FIGDIR) $*.pdf

# Fast loop while writing prose: skips biber, so citations render as [?].
quick:
	pdflatex -interaction=nonstopmode -halt-on-error -output-directory=$(OUT) $(MAIN).tex
	@cp $(OUT)/$(MAIN).pdf ./$(MAIN).pdf
	@echo "  quick build done (citations will show as [?])"

# Static checks that need no LaTeX toolchain: missing includes, missing figure
# PDFs, duplicate labels, dangling \cref, unbalanced braces/environments, and
# figures never discussed in the text.
lint:
	@$(PYTHON) scripts/lint_tex.py

check: lint
	@echo
	@echo "── toolchain ─────────────────────────────────────────────"
	@for c in pdflatex latexmk biber; do \
	  printf "  %-10s " $$c; \
	  command -v $$c >/dev/null && echo "OK" || echo "MISSING"; \
	done
	@echo "  (all three ship with MacTeX; if MISSING see README-thesis.md)"
	@echo
	@echo "── figures referenced vs present ─────────────────────────"
	@missing=0; \
	for f in $$(grep -ho '\\thesisfigure\(page\)\?{[^}]*}' chapters/*.tex \
	            | sed 's/.*{\([^}]*\)}/\1/' | sort -u); do \
	  if [ -f "$(FIGDIR)/$$f.pdf" ]; then \
	    printf "  ok       %s\n" "$$f"; \
	  else \
	    printf "  MISSING  %s\n" "$$f"; missing=1; \
	  fi; \
	done; \
	echo; \
	if [ $$missing -eq 1 ]; then \
	  echo "  some figures are missing — run 'make figures'"; exit 1; \
	else echo "  every referenced figure is present"; fi

todos:
	@grep -n '\\TODO{' $(MAIN).tex metadata.tex chapters/*.tex frontmatter/*.tex 2>/dev/null \
	  | sed 's/\\TODO{/→ /' | cut -c1-140 || echo "  no TODOs left"

todos-count:
	@n=$$(grep -ho '\\TODO{' $(MAIN).tex metadata.tex chapters/*.tex frontmatter/*.tex 2>/dev/null | wc -l | tr -d ' '); \
	 echo "  $$n \\TODO markers outstanding — 'make todos' to list them"

wordcount:
	@command -v texcount >/dev/null && \
	  texcount -inc -sum -q $(MAIN).tex || \
	  echo "texcount not found (ships with TeX Live)"

clean:
	rm -rf $(OUT)
	rm -f $(MAIN).aux $(MAIN).log $(MAIN).out $(MAIN).toc $(MAIN).lof $(MAIN).lot \
	      $(MAIN).bbl $(MAIN).bcf $(MAIN).blg $(MAIN).run.xml $(MAIN).fls \
	      $(MAIN).fdb_latexmk $(MAIN).synctex.gz

distclean: clean
	rm -f $(MAIN).pdf

help:
	@sed -n '2,20p' Makefile | sed 's/^# \?//'
