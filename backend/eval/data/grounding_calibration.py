"""Arc 4 calibration pairs, moved verbatim from
tests/unit/test_quiz_grounding_real_decks.py in Arc 8 so the Deck Lab can fit
the semantic threshold on them.

Held-out protocol (Arc 8, pre-registered): the semantic threshold is fitted
ONLY on these pairs (calibration decks), then the probe
(grounding_probe.py, disjoint decks) is scored once at that threshold.
Neither set may be edited because of a score; tests/unit/test_semantic_calibration.py
pins both by sha256.

Each pair: (1-based slide, stem, grounded key, ungrounded key). The grounded
key is stated on that slide; the ungrounded key is copied from a different
slide of the same deck or carries a number that is not on the slide.
"""
from __future__ import annotations

from backend.eval.data.grounding_probe import CALIBRATION_DECKS, DE_OFF_TOPIC, EN_OFF_TOPIC

DBS_DECK, SR_DECK = CALIBRATION_DECKS

DBS_PAIRS = [
    (19, "Which problem arises when each advisor keeps their own client data?",
     "Redundancy through double client entries", "Waste of physical storage through multiply saved data"),
    (24, "How many records did AT&T store in 2015?", "1.9 trillion records", "3.4 trillion records"),
    (26, "Why is searching a 10 Gbyte CSV file slow?",
     "On average 10/2 Gbyte will be read", "The DBMS distributes the file over a server cluster"),
    (30, "What happens to data when every software manages its own formats?",
     "Data are saved redundantly", "Users must know the internal representation of the data"),
    (31, "What do applications lack without data independence?",
     "They must know the internal representation and storage media", "Data are saved redundantly in many formats"),
    (16, "Which task does a DBMS take over for multi-user operation?",
     "Transaction management and access control", "Redundancy through double client entries"),
    (35, "Which systems surround database systems in IT infrastructures?",
     "Batch and data stream systems", "Text processing and accounting software"),
    (11, "What does a database management system manage?",
     "Access to one or more databases", "Batch and data stream systems"),
]
SR_PAIRS = [
    (3, "Was ermöglicht ein Prozess auf einem Ein-Prozessor-System?",
     "Quasi-parallele Ausführung", "Zeitscheiben im Millisekundenbereich"),
    (4, "Was besitzen Threads im Gegensatz zu Prozessen nicht?",
     "Eine eigene Ressourcenumgebung wie einen Speicherbereich", "Einen eigenen Befehlszähler und Stack im Kernteil"),
    (7, "Wodurch wird der Ablauf beim Multitasking gesteuert?",
     "Durch Zeitscheiben", "Durch die Prozesstabelle im Hauptspeicher"),
    (14, "Wie nennt man die Zeit, nach der das Betriebssystem neu zuteilt?", "Zeitscheibe", "Prozesskontrollblock"),
    (17, "Was ist eine Prozesstabelle?",
     "Eine Liste von Prozesskontrollblöcken", "Eine exakte Kopie des Elternprozesses"),
    (18, "Was erzeugt der Systemaufruf fork()?",
     "Eine exakte Kopie des ausführenden Prozesses als Kindprozess", "Eine Liste von Prozesskontrollblöcken"),
    (24, "In welchem Zustand wartet ein Prozess auf ein Ereignis?",
     "Blockiert", "In der Prozesstabelle im Hauptspeicher"),
    (16, "Was besitzt jeder Prozess, das vor dem Zugriff anderer Prozesse geschützt ist?",
     "Einen eigenen Adressraum", "Eine eigene Zeitscheibe"),
    (26, "Wo werden Prozesse verwaltet, die auf ein Ereignis warten?",
     "In ereignisspezifischen Warteschlangen", "In der Prozesstabelle im Hauptspeicher"),
    (27, "Welcher Programmfehler kann zur Deaktivierung eines Prozesses führen?",
     "Divide by Zero", "Ein Deadlock zwischen zwei Semaphoren"),
    (28, "Was gehört zur Buchführung über Prozesse?",
     "Verwaltung der Prozesstabelle", "Präemptives Multitasking mit Zeitscheiben"),
]

# (deck file name, pairs, off-topic distractors)
CALIBRATION_SETS = ((DBS_DECK, DBS_PAIRS, EN_OFF_TOPIC), (SR_DECK, SR_PAIRS, DE_OFF_TOPIC))
