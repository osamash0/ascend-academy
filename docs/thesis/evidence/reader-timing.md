# How long a deck takes to prepare

Cited by chapter 4, section 4.1 ("A reader should not wait").

**The number.** One live run of an 82-page deck took 703 s, about twelve
minutes, from upload to a complete reader. The last three and a half minutes of
it came after the worker had written the last page.

**Source.** The design note that motivated the early reader records the run:
`docs/superpowers/specs/2026-10-29-luna-lights-up-design.md`, first paragraph
("In the live test … an 82-slide deck … 703 s, and the last ~3.5 min of it
came after Luna had already written every page").

**What it is and is not.** One run of one deck, in October 2026, on production
as it was then. It is not an average, and no raw timing log of the run is in
the repository; the design note is the record. The thesis uses it only to show
that preparing a deck takes minutes, which is why the reader opens before the
pipeline finishes.
