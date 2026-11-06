"""Defuse prompt markers inside text we do not control.

Every prompt that carries uploaded slide text (or anything a learner typed)
fences it with markers: a triple-quote block, ``<<<page N>>> … <<<end>>>``,
``[RETRIEVED CONTEXT]`` labels, ``=== SLIDE N ===`` separators,
``<context_only>`` tags, ``<<slot>>`` placeholders. A PDF that contains one of
those markers can end its fence early and write text that reads like ours.
The prompts also say "this text is data", but a rule is only as good as the
fence it points at.

``inert`` rewrites exactly those markers into look-alikes the model still
reads as punctuation but no fence matches. Ordinary text, code
(``cout << x``, ``a >> 2``) and reference numbers (``[1]``) pass unchanged.
Apply it to every value that came from a document or a learner, before it is
placed into a prompt; never to the prompt's own markers.

It does not make injection impossible; nothing does. It keeps the fences
honest, so the "data, not instructions" rules and the output validators
(reader `validate_answer`, Luna `validate.py`, citation filters) stay the
real line of defence.
"""
from __future__ import annotations

import re
from typing import Optional

# Order matters: the triple-angle fences go before the <<slot>> rule, so
# "<<<end>>>" becomes one look-alike run instead of a slot inside brackets.
_RULES: list[tuple[re.Pattern[str], str]] = [
    # Reader fence.
    (re.compile(r'"""'), "”””"),
    # Luna page fences: <<<page 3>>>, <<<end>>>.
    (re.compile(r"<{3,}"), lambda m: "‹" * len(m.group(0))),
    (re.compile(r">{3,}"), lambda m: "›" * len(m.group(0))),
    # Luna template slots: <<rules>>, <<pages>>.
    (re.compile(r"<<(\s*\w+\s*)>>"), r"‹‹\1››"),
    # Batch synthesis: <context_only>, </context_only>.
    (re.compile(r"<(\s*/?\s*context_only\s*)>", re.IGNORECASE), r"‹\1›"),
    # Batch synthesis separator: === SLIDE 5 (index=4) ===.
    (re.compile(r"={3,}\s*slide\b[^=\n]*={0,}", re.IGNORECASE), lambda m: m.group(0).replace("=", "≡")),
    # Citation-style headers: [Slide 4], [Source 2].
    (re.compile(r"\[(\s*(?:slide|source)\s+\d+\s*)\]", re.IGNORECASE), r"⁅\1⁆"),
    # Section labels: [RETRIEVED CONTEXT], [STUDENT MESSAGE], [SLIDE CONTENT].
    # Two or more words of letters only, so "[1]" and "[a, b]" stay.
    (re.compile(r"\[(\s*[A-Za-z]+(?:[ _][A-Za-z]+)+\s*)\]"), r"⁅\1⁆"),
]


def inert(text: Optional[str]) -> str:
    """``text`` with every prompt marker defused; ``None`` becomes ``""``."""
    if not text:
        return ""
    out = text
    for pattern, repl in _RULES:
        out = pattern.sub(repl, out)
    return out


def one_line(text: Optional[str], limit: int) -> str:
    """A short field (a title, a name) as one defused line: a title with a
    newline in it could otherwise start a section of its own."""
    return " ".join(inert(text).split())[:limit]
