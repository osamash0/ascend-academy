"""A small synthetic deck that looks like a lecture: a large title, body lines
(one of them a broken line), and a three-part footer at 88% of page height,
like the SWT decks. Not a test module (no test_ prefix)."""
from pathlib import Path

import fitz

W, H = 842, 595
TITLES = ("Introduction", "Version Control", "Merge Conflicts", "Branching Models", "Release Planning", "Summary")


def make_deck(path: Path, n: int = 6) -> Path:
    doc = fitz.open()
    for i in range(1, n + 1):
        title = TITLES[(i - 1) % len(TITLES)]
        page = doc.new_page(width=W, height=H)
        page.insert_text((60, 110), title, fontsize=28)
        page.insert_text((60, 170), f"First point about {title.lower()}", fontsize=16)
        page.insert_text((60, 195), "continues here in lower case", fontsize=16)
        page.insert_text((60, 250), "Second point.", fontsize=16)
        page.insert_text((40, 530), "Lecturer", fontsize=9)
        page.insert_text((380, 530), "Softwaretechnik", fontsize=9)
        page.insert_text((790, 530), str(i), fontsize=9)
    doc.save(path)
    doc.close()
    return path
