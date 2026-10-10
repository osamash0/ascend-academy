/**
 * A scripted stand-in for the tutor model — DEV/prototype only.
 *
 * Returns the exact wire shape the real backend endpoint will produce
 * (`{ parts: [...] }`, validated by protocol.parseTurn), so the UI, widgets
 * and protocol are real today and only this file is swapped for a network
 * call once the LLM side exists. Keyword routing is obviously not the
 * product; it's here so every widget path can be exercised by hand.
 */

type Lang = 'en' | 'de';

const L = (lang: Lang, en: string, de: string) => (lang === 'de' ? de : en);

function joinTurn(lang: Lang) {
  return {
    parts: [
      {
        type: 'text',
        text: L(
          lang,
          "Let's not just read about it. Predict it! Here are some students and their course enrollments. Notice Mia has no enrollment, and one enrollment has no student at all.",
          'Lass es uns nicht nur lesen, sondern vorhersagen! Hier sind Studierende und ihre Kurseinschreibungen. Mia hat keine Einschreibung, und eine Einschreibung hat gar keine Person.',
        ),
      },
      {
        type: 'widget',
        component: 'JoinPlayground',
        props: {
          joinType: 'LEFT',
          left: { name: 'students', columns: ['id', 'name'], rows: [[1, 'Ada'], [2, 'Ben'], [3, 'Mia'], [4, 'Noah']] },
          right: {
            name: 'enrollments',
            columns: ['student_id', 'course'],
            rows: [[1, 'DBS'], [1, 'Algo'], [2, 'DBS'], [null, 'Stats'], [5, 'Web']],
          },
          on: { left: 'id', right: 'student_id' },
          prompt: L(lang, 'Tap every row you think shows up in a LEFT JOIN.', 'Tippe jede Zeile an, die in einem LEFT JOIN vorkommt.'),
        },
      },
    ],
  };
}

function primaryKeyTurn(lang: Lang) {
  return {
    parts: [
      { type: 'text', text: L(lang, "Quick check first. It'll tell me where to start.", 'Erst ein kurzer Check, dann weiß ich, wo wir anfangen.') },
      {
        type: 'widget',
        component: 'ConceptCheck',
        props: {
          question: L(lang, 'Which column is the best primary key for a students table?', 'Welche Spalte ist der beste Primärschlüssel für eine Tabelle students?'),
          options: [
            { text: 'name', correct: false, why: L(lang, 'Two students can share a name, so it isn’t unique.', 'Zwei Studierende können gleich heißen – nicht eindeutig.') },
            { text: 'matriculation_no', correct: true, why: L(lang, 'Unique, never empty, and it doesn’t change: exactly what a primary key needs.', 'Eindeutig, nie leer und unveränderlich – genau das braucht ein Primärschlüssel.') },
            { text: 'email', correct: false, why: L(lang, 'Unique-ish, but people change emails. Keys should be stable.', 'Fast eindeutig, aber E-Mails ändern sich. Schlüssel sollten stabil sein.') },
            { text: 'semester', correct: false, why: L(lang, 'Hundreds of students share a semester.', 'Hunderte Studierende teilen sich ein Semester.') },
          ],
          hint: L(lang, 'A primary key must be unique for every row and should never change.', 'Ein Primärschlüssel muss für jede Zeile eindeutig sein und sollte sich nie ändern.'),
        },
      },
    ],
  };
}

function socraticTurn(lang: Lang) {
  return {
    parts: [
      {
        type: 'text',
        text: L(
          lang,
          'Good question. Before I explain: what do you already know about it? Even a guess helps me meet you where you are. (In this prototype, try asking about JOINs or primary keys.)',
          'Gute Frage! Bevor ich erkläre: Was weißt du schon darüber? Auch eine Vermutung hilft mir. (In diesem Prototyp: frag nach JOINs oder Primärschlüsseln.)',
        ),
      },
    ],
  };
}

export async function scriptedBrain(question: string, lang: string): Promise<unknown> {
  const lg: Lang = lang.startsWith('de') ? 'de' : 'en';
  // Feels like a model thinking — and gives Luna's "thinking" state its moment.
  await new Promise((r) => setTimeout(r, 1100 + Math.random() * 700));
  if (/join|verbund|verknüpf/i.test(question)) return joinTurn(lg);
  if (/primary|primär|schlüssel|key/i.test(question)) return primaryKeyTurn(lg);
  return socraticTurn(lg);
}
