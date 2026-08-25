# Thesis figure build.
#
#   make            build any figure whose source is newer than its PDF
#   make all        PDF (for LaTeX) + SVG (for the review gallery)
#   make check      fail loudly if any figure failed to render
#   make clean      remove generated PDFs and SVGs
#
# PlantUML is a single jar — no Homebrew needed, which matters because brew is
# unreliable on this machine. Point PLANTUML_JAR at yours, or drop the jar at
# the default path below:
#
#   curl -fsSL -o ~/.local/share/plantuml/plantuml.jar \
#     https://github.com/plantuml/plantuml/releases/latest/download/plantuml.jar
#
# Verified with PlantUML 1.2026.7 + OpenJDK 22: -tpdf emits valid PDF 2.0 with
# embedded fonts and zero raster content.
#
# FALLBACK: pdfTeX refuses to \includegraphics a PDF newer than its supported
# version. Current MacTeX handles PDF 2.0 fine; if yours complains, switch
# PDF_FLAG to -teps and add an epstopdf step (epstopdf ships with TeX Live).

PLANTUML_JAR ?= $(HOME)/.local/share/plantuml/plantuml.jar
JAVA         ?= java
PLANTUML      = $(JAVA) -jar $(PLANTUML_JAR) -nometadata
PDF_FLAG     ?= -tpdf

SRCDIR  = src
SOURCES = $(wildcard $(SRCDIR)/f*.puml)
PDFS    = $(patsubst $(SRCDIR)/%.puml,%.pdf,$(SOURCES))
SVGS    = $(patsubst $(SRCDIR)/%.puml,%.svg,$(SOURCES))

# _style.iuml is included by every figure, so a style change rebuilds all.
STYLE = $(SRCDIR)/_style.iuml

.PHONY: all figures svg check clean list
.DEFAULT_GOAL := figures

figures: $(PDFS)
all: $(PDFS) $(SVGS)
svg: $(SVGS)

%.pdf: $(SRCDIR)/%.puml $(STYLE) | guard
	@$(PLANTUML) $(PDF_FLAG) -o "$(CURDIR)" $<
	@test -s $@ || { echo "FAILED to render $@ — run 'make check'"; exit 1; }
	@echo "  PDF  $@"

%.svg: $(SRCDIR)/%.puml $(STYLE) | guard
	@$(PLANTUML) -tsvg -o "$(CURDIR)" $<
	@echo "  SVG  $@"

# Render everything in one JVM and surface any PlantUML error lines. Much
# faster than per-file invocation, and the only way to see *all* failures at
# once rather than stopping at the first.
check: | guard
	@echo "Rendering all $(words $(SOURCES)) figures and checking for errors…"
	@$(PLANTUML) -tsvg -o "$(CURDIR)" $(SOURCES) 2>&1 | tee /tmp/puml-check.log; \
	 if grep -q "Error line" /tmp/puml-check.log; then \
	   echo "*** FIGURE ERRORS ***"; grep "Error line" /tmp/puml-check.log; exit 1; \
	 else echo "all $(words $(SOURCES)) figures render clean"; fi

guard:
	@test -f "$(PLANTUML_JAR)" || { \
	  echo "PlantUML jar not found at $(PLANTUML_JAR)."; \
	  echo "Download it, or run: make PLANTUML_JAR=/path/to/plantuml.jar"; exit 1; }

list:
	@echo "$(words $(SOURCES)) figures:"; for f in $(SOURCES); do echo "  $$f"; done

clean:
	rm -f $(PDFS) $(SVGS)
