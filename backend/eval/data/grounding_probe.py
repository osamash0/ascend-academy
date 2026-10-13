"""Grounding verifier drop-risk probe — hand-written pairs over real slides.

Why: SUPPORT_THRESHOLD (services/parser/quiz_grounding.py) was calibrated on
pairs whose grounded keys stayed close to the slide's own wording, and whose
ungrounded keys were copied from other slides. A model paraphrases, and a
model hallucinates on-topic. This set measures the two errors the
calibration could not see:
  false drop  — a correct, PARAPHRASED answer is rejected
  false keep  — an ON-TOPIC answer the cited slide does not state is accepted

Writing rule (fixed before any pair was scored; pairs are not tuned to the scorer):
  1. Decks differ from the calibration decks: 07 DBS Transactions (EN) and
     05 SR Speicherverwaltung (DE).
  2. The stem is a student's question in plain words.
  3. paraphrased: states a fact the cited slide states, reworded. It may keep
     the slide's technical terms (System R, MMU, Basisregister), but no three
     consecutive words of it appear consecutively on the slide (casefolded,
     punctuation ignored).
  4. hallucinated: a plausible, on-topic claim in the deck's vocabulary that
     the cited slide does NOT state, written freehand (not a sentence lifted
     from another slide). No digits, so the digit gate cannot catch it for
     free. Rule 3's three-word limit applies to it too.
  5. Distractors are off-topic, as in the calibration, so the ambiguity gate
     cannot mask the raw support score.
  6. Any later edit is logged below with its reason and the scores before
     and after. Never edit a pair because of its score.
Rules 1, 3 and 4 are checked in tests/unit/test_grounding_probe_set.py.

Change log:
  2026-10-11  initial 16 pairs (8 EN, 8 DE), written before any scoring.
"""
from __future__ import annotations

from dataclasses import dataclass

PROBE_DECK_EN = "07 DBS Transactions.pdf"
PROBE_DECK_DE = "05__SR_Speicherverwaltung_v02_06.05.2026.pdf"
PROBE_DECKS = (PROBE_DECK_EN, PROBE_DECK_DE)
# The decks SUPPORT_THRESHOLD was calibrated on; the probe must not reuse them.
CALIBRATION_DECKS = ("00 DBS Introduction.pdf", " 03__SR_Prozesse_v07_27.04.2025.pdf")

EN_OFF_TOPIC = ("Photosynthesis in chloroplasts", "Plate tectonics", "Baroque counterpoint")
DE_OFF_TOPIC = ("Photosynthese in Chloroplasten", "Plattentektonik", "Barocker Kontrapunkt")


@dataclass(frozen=True)
class ProbePair:
    deck: str
    slide: int  # real 1-based deck slide number, as the quiz prompt cites it
    stem: str
    paraphrased: str  # grounded on `slide`, reworded (rule 3)
    hallucinated: str  # on-topic, NOT stated on `slide` (rule 4)
    language: str  # "en" | "de": picks the off-topic distractors


def _en(slide: int, stem: str, paraphrased: str, hallucinated: str) -> ProbePair:
    return ProbePair(PROBE_DECK_EN, slide, stem, paraphrased, hallucinated, "en")


def _de(slide: int, stem: str, paraphrased: str, hallucinated: str) -> ProbePair:
    return ProbePair(PROBE_DECK_DE, slide, stem, paraphrased, hallucinated, "de")


PROBE_PAIRS: tuple[ProbePair, ...] = (
    # 07 DBS Transactions
    _en(7, "In one sentence, what is a database transaction?",  # slide: definition of a transaction
        "An ordered series of operations taking the database from one consistent state into another",
        "A single SQL statement that the DBMS executes without any locking"),
    _en(11, "What does atomicity guarantee for a transaction?",  # slide: ACID, atomicity first
        "It runs completely or has no effect whatsoever",
        "Transactions are always executed on a separate replica server"),
    _en(13, "Who first formalised transactions, and where?",  # slide: history, System R / Jim Gray
        "Jim Gray, in the System R project",
        "Edgar Codd, in the relational prototype Ingres"),
    _en(14, "What can go wrong when several travel agencies book the same flight at once?",  # slide: scenarios
        "One seat may be sold to more than one customer",
        "The flight database refuses all bookings until the agencies synchronise their clocks"),
    _en(19, "Which anomalies can a non-serializable schedule cause?",  # slide: list of sync problems
        "Lost updates, dirty reads and phantoms",
        "Deadlocks, livelocks and starvation of the transaction manager"),
    _en(29, "What is allowed under the read uncommitted isolation level?",  # slide: weakest level
        "Values not yet committed can be accessed, and no locks are taken",
        "Every read places a shared lock that is held until commit"),
    _en(32, "What is the simplest way to avoid every synchronization problem?",  # slide: solution 1, serial
        "Running transactions in sequence, never concurrently",
        "Giving every transaction the isolation level read committed"),
    _en(35, "What makes a schedule serializable?",  # slide: schedule properties
        "An interleaving whose effect equals that of some serial execution",
        "An interleaving in which no transaction ever reads a value written by another one"),
    # 05 SR Speicherverwaltung
    _de(5, "Wozu dient der Schutz in der Speicherverwaltung?",  # Folie: Aufgaben der Speicherverwaltung
        "Er begrenzt, worauf ein Prozess im physischen Speicher zugreifen darf",
        "Er verschlüsselt den Hauptspeicher jedes Prozesses"),
    _de(7, "Was ist der Nachteil der einzelnen zusammenhängenden Zuteilung?",  # Folie: Single Continuous Allocation
        "Sie verschwendet Speicherplatz und erlaubt nur ein Programm gleichzeitig",
        "Sie erfordert eine mehrstufige Seitentabelle pro Programm"),
    _de(9, "Welches Problem entsteht bei der partitionierten Zuteilung?",  # Folie: Partitioned Allocation
        "Der Arbeitsspeicher wird zerstückelt",
        "Programme müssen vor dem Start in Segmente zerlegt werden"),
    _de(12, "Welche Hardware braucht die verschiebbare partitionierte Zuteilung?",  # Folie: Relocatable
        "Ein Basisregister für die Verschiebung, ergänzt um ein Grenzregister für den Schutz",
        "Einen Translation Lookaside Buffer für die Verschiebung"),
    _de(15, "Welche Einschränkung haben feste Speicherbereiche?",  # Folie: Probleme fester Speicherbereiche
        "Der adressierbare Raum kann nicht größer als der Hauptspeicher sein",
        "Sie verhindern, dass zwei Prozesse gleichzeitig rechnen"),
    _de(19, "Was ist der TLB?",  # Folie: Implementierung Seitentabelle (2)
        "Ein schneller Hardware-Zwischenspeicher für Seitenübersetzungen innerhalb der MMU",
        "Eine Tabelle auf der Festplatte, die ausgelagerte Seiten protokolliert"),
    _de(21, "Warum verwendet man mehrstufige Seitentabellen?",  # Folie: Mehrstufige Seitentabelle
        "Weil eine einzige Tabelle zu umfangreich wird und sich über viele Seiten erstreckt",
        "Weil jede Stufe einen eigenen Prozessorkern bedient"),
    _de(29, "Was zeigt das Validitätsbit in der Seitentabelle an?",  # Folie: Validitätsbit
        "Ob die Seite gerade im Hauptspeicher liegt; fehlt sie, folgt eine Seitenfehler-Unterbrechung",
        "Ob die Seite seit dem letzten Zugriff verändert wurde"),
)
