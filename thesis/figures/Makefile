# Thesis figure build.
#
#   make            build any figure whose source is newer than its PDF
#   make all        PDF (for LaTeX) + SVG (for the review gallery)
#   make check      fail loudly if any figure failed to render
#   make fonts      fail loudly if any figure PDF has a font that is not embedded
#   make clean      remove generated PDFs and SVGs
#
# PlantUML is a single jar — no Homebrew needed, which matters because brew is
# unreliable on this machine. Point PLANTUML_JAR at yours, or drop the jar at
# the default path below:
#
#   curl -fsSL -o ~/.local/share/plantuml/plantuml.jar \
#     https://github.com/plantuml/plantuml/releases/latest/download/plantuml.jar
#
# Verified with PlantUML 1.2026.8 + OpenJDK 22: -tpdf emits vector PDF with zero
# raster content, but it only REFERENCES Helvetica: no font is embedded, so bold
# and italic vanish in viewers without the font, and submission checks that
# require embedded fonts fail. Every PDF is therefore rewritten once by
# Ghostscript (pdfwrite), which embeds a subset of each font. Install it with
#
#   brew install ghostscript
#
# Verified with Ghostscript 10.08.0: page size unchanged, fonts embedded.
#
# FALLBACK: pdfTeX refuses to \includegraphics a PDF newer than its supported
# version. Current MacTeX handles PDF 2.0 fine; if yours complains, switch
# PDF_FLAG to -teps and add an epstopdf step (epstopdf ships with TeX Live).

PLANTUML_JAR ?= $(HOME)/.local/share/plantuml/plantuml.jar
JAVA         ?= java
# headless + no Dock icon: without these, every render launches a GUI-capable
# JVM on macOS that flashes a Java icon and steals focus from whatever the
# user is typing in. A full rebuild did that 19 times in a row.
JAVA_OPTS    ?= -Djava.awt.headless=true -Dapple.awt.UIElement=true
PLANTUML      = $(JAVA) $(JAVA_OPTS) -jar $(PLANTUML_JAR) -nometadata
PDF_FLAG     ?= -tpdf
GS           ?= gs
GS_FLAGS      = -q -dSAFER -dBATCH -dNOPAUSE -sDEVICE=pdfwrite \
                -dCompatibilityLevel=1.7 -dPDFSETTINGS=/prepress \
                -dEmbedAllFonts=true -dSubsetFonts=true -dAutoRotatePages=/None

SRCDIR  = src
SOURCES = $(wildcard $(SRCDIR)/f*.puml)
PDFS    = $(patsubst $(SRCDIR)/%.puml,%.pdf,$(SOURCES))
SVGS    = $(patsubst $(SRCDIR)/%.puml,%.svg,$(SOURCES))

# _style.iuml is included by every figure, so a style change rebuilds all.
STYLE = $(SRCDIR)/_style.iuml

.PHONY: all figures svg check fonts clean list
.DEFAULT_GOAL := figures

figures: $(PDFS)
all: $(PDFS) $(SVGS)
svg: $(SVGS)

%.pdf: $(SRCDIR)/%.puml $(STYLE) | guard
	@$(PLANTUML) $(PDF_FLAG) -o "$(CURDIR)" $<
	@test -s $@ || { echo "FAILED to render $@ — run 'make check'"; exit 1; }
	@$(GS) $(GS_FLAGS) -sOutputFile=$@.embed $@ && mv $@.embed $@ \
	  || { rm -f $@ $@.embed; echo "FAILED to embed fonts in $@"; exit 1; }
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

# pdffonts prints one row per font; column 5 ("emb") must be "yes" on every row.
fonts:
	@bad=0; for f in $(PDFS); do \
	  pdffonts $$f | awk 'NR>2 && $$(NF-4) != "yes" {print FILENAME": "$$1; e=1} END {exit e}' FILENAME=$$f || bad=1; \
	done; \
	if [ $$bad = 1 ]; then echo "*** FONTS NOT EMBEDDED — run: make -B figures ***"; exit 1; \
	else echo "all $(words $(PDFS)) figure PDFs embed every font"; fi

guard:
	@test -f "$(PLANTUML_JAR)" || { \
	  echo "PlantUML jar not found at $(PLANTUML_JAR)."; \
	  echo "Download it, or run: make PLANTUML_JAR=/path/to/plantuml.jar"; exit 1; }
	@command -v $(GS) >/dev/null || { \
	  echo "Ghostscript ($(GS)) not found; it embeds the fonts. brew install ghostscript"; exit 1; }

list:
	@echo "$(words $(SOURCES)) figures:"; for f in $(SOURCES); do echo "  $$f"; done

clean:
	rm -f $(PDFS) $(SVGS)
