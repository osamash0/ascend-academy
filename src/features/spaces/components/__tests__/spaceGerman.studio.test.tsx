import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import StudioCanvasScreen from '../../screens/StudioCanvasScreen';
import { Peek } from '../../studio/components/Peek';
import { OriginalPage } from '../../studio/components/OriginalPage';
import type { Region } from '../../studio/geometry';
import type { CanvasBlock, SourcePage } from '../../studio/types';
import * as shelf from '../../mocks/shelf';
import { STUDIO_ANSWERS } from '../../mocks/studio-answers';
import { STUDIO_CANVAS } from '../../mocks/studio-canvas';

/*
 * The Studio canvas (a page of your Library), in German.
 *
 * What the page *says* is the student's own or authored demo data: the
 * paragraphs and summaries of the sample deck, the scripted answers (their
 * questions, their quiz options, their step labels) and the questions offered
 * as chips. All of that stays English and is taken out before looking.
 * Everything around it is chrome, and none of it may be left in English.
 */

/* "Zoom" and "Space" are left out: German says them the same way. */
const ENGLISH_CHROME = [
  'Back to Library',
  'Library',
  'Breadcrumb',
  'Sample pages',
  'Recall',
  'Reveal term',
  'revealed',
  'Knew it',
  'Not yet',
  'to try again',
  'Try again',
  'Start over',
  'Use light theme',
  'Use dark theme',
  'Learn',
  'Source',
  'Show source',
  'Showing',
  'Pages',
  'Your notes',
  'Page',
  'page',
  'Previous',
  'Next',
  'Depth',
  'Gist',
  'Summary',
  'Full',
  'Ask',
  'Answering',
  'Answer removed',
  'Answer added',
  'Undo',
  'Added below',
  'In this preview',
  'Rest on a paragraph',
  'to recall',
  'Back on',
  'Canvas updates',
  'The source file was removed',
  'Couldn’t',
  'Pin',
  'Close',
  'Edited by you',
  'not in your version',
  'Not in your version',
  'Add to your version',
  'Back to',
  'From your question',
  'Remove this answer',
  'Reset',
  'Pick a left',
  'Broken by',
  'Holds on',
  'left side',
  'right side',
  'Row',
  'Start with',
  'Begin with',
  'is inside the set',
  'Nothing else fires',
  'superkey',
  'Not a key',
  'Step',
  'Every relation',
  'Split it',
  'Check',
  'isn’t here',
];

/** Every string in the scripted catalogue and the sample deck: demo data, long enough to cut out whole. */
const demoStrings = (() => {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (v.length >= 8) out.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(STUDIO_ANSWERS.map(({ match: _match, ...rest }) => rest));
  walk(STUDIO_CANVAS);
  return [...out].sort((a, b) => b.length - a.length);
})();

/** A label that ends in a quoted piece of the page ("Zurück zu: <its first words>"): only the chrome in front counts. */
const CHROME_THEN_DEMO = /^((?:Zurück zu(?: \(bearbeitet\))?|Nicht in deiner Version|Zu deiner Version hinzufügen)): .*$/s;

const said = () => {
  const root = document.body.cloneNode(true) as HTMLElement;
  // The sample deck's paragraphs and the answers' prose: the student's and the author's own words.
  root.querySelectorAll('.studio-prose').forEach((n) => n.remove());
  // The contents rail names a page by its heading, which is the deck's own; "Deine Notizen" and "Seite 3" are ours.
  root.querySelectorAll('nav .line-clamp-2').forEach((n) => {
    if (!/^(Deine Notizen|Seite \d+)$/.test(n.textContent ?? '')) n.remove();
  });
  const attrs = [...root.querySelectorAll<HTMLElement>('[aria-label],[title],[placeholder],[alt]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder', 'alt'].map((a) => (el.getAttribute(a) ?? '').replace(CHROME_THEN_DEMO, '$1')),
  );
  let all = [root.textContent ?? '', ...attrs].join('\n');
  // What the announcer quotes: the paragraph an answer went under, and the question.
  all = all.replace(/„[^“]*“/g, '„“').replace(/\(zu: .*\)/g, '(zu: )');
  for (const s of demoStrings) all = all.split(s).join(' ');
  return all;
};
const leftover = () => {
  const all = said();
  return ENGLISH_CHROME.filter((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(all));
};
const rawKeys = () => said().match(/\b(?:library|studio|states)\.[a-z][\w.]*/g) ?? [];
const clean = () => {
  expect(leftover()).toEqual([]);
  expect(rawKeys()).toEqual([]);
};

const NAME = 'Normalization.pdf';
/** Moves the clock, or waits it out when a test runs on real time (the exit animations need it). */
const run = (ms = 600) =>
  act(async () => {
    if (vi.isFakeTimers()) vi.advanceTimersByTime(ms);
    else await new Promise((r) => setTimeout(r, ms));
  });
const mount = async (path = '/v4/library/m/m-norm') => {
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/v4/library/m/:materialId" element={<StudioCanvasScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  await run(700);
  return utils;
};
const ask = async (q: string) => {
  const input = screen.getByRole('textbox', { name: 'Frag etwas zu diesem Material' });
  fireEvent.change(input, { target: { value: q } });
  fireEvent.submit(input.closest('form')!);
  await run(700);
};
const section = (c: HTMLElement, page: number) =>
  c.querySelector<HTMLElement>(`[data-view="clean"][data-page-anchor="${page}"]`)!;

beforeEach(async () => {
  shelf.__reset();
  shelf.saveCanvas('m-norm', STUDIO_CANVAS);
  await act(() => i18n.changeLanguage('de'));
  vi.useFakeTimers();
});
afterEach(async () => {
  vi.useRealTimers();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  await act(() => i18n.changeLanguage('en'));
});

describe('the Studio canvas, in German', () => {
  it('Learn: the masthead, the contents, the pager, the composer and where this page stands', async () => {
    // A note of your own above page 1 sits on "page 0": the rail and the page call it Deine Notizen.
    shelf.saveCanvas('m-norm', {
      ...STUDIO_CANVAS,
      blocks: [{ id: 'w-0', origin: 'written', markdown: 'First, a word of my own.' }, ...STUDIO_CANVAS.blocks],
    });
    await mount();
    expect(screen.getByRole('link', { name: 'Zurück zur Bibliothek' })).toHaveAttribute('href', '/v4/library');
    expect(within(screen.getByRole('navigation', { name: 'Navigationspfad' })).getByRole('link', { name: 'Bibliothek' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: NAME })).toBeInTheDocument();
    // The switch: two faces of one Material.
    const sw = screen.getByRole('switch', { name: 'Quelle zeigen' });
    expect(sw).toHaveTextContent('Lernen');
    expect(sw).toHaveTextContent('Quelle');
    expect(screen.getByText('Lernansicht wird angezeigt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrufen' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Design verwenden$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^(Teilen|Geteilt)/ })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Wo diese Seite steht' })).toBeInTheDocument();
    // The contents rail, with the notes above page 1.
    const rail = screen.getByRole('navigation', { name: 'Seiten dieses Materials' });
    expect(within(rail).getByText('Seiten')).toBeInTheDocument();
    expect(within(rail).getByText('Deine Notizen')).toBeInTheDocument();
    // Pages, and the markers on the paragraphs.
    expect(screen.getByRole('group', { name: 'Seite' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vorherige Seite' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nächste Seite' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Quelle zeigen, Seite 2' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('S. 2').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Seite 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Deine Notizen', { selector: 'section' })).toBeInTheDocument();
    expect(screen.getAllByText('Seite 2').length).toBeGreaterThan(0);
    // The composer, and the hint above it.
    const input = screen.getByRole('textbox', { name: 'Frag etwas zu diesem Material' });
    expect(input).toHaveAttribute('placeholder', 'Frag etwas zu diesem Material…');
    expect(screen.getByRole('button', { name: 'Fragen' })).toBeInTheDocument();
    expect(
      screen.getByText(/^(Verweil auf einem Absatz, um die Quelle zu sehen, drück S oder frag unten · R zum Abrufen|Wieder auf Seite \d+)$/),
    ).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Änderungen an deiner Version' })).toBeInTheDocument();
    clean();
  });

  it('asking: the answer is woven in, announced in German, removed and put back', async () => {
    const { container } = await mount();
    await ask('What is a functional dependency?');
    await run(100);
    expect(screen.getByRole('status', { name: 'Änderungen an deiner Version' })).toHaveTextContent(
      /^Antwort unter „.+“ hinzugefügt \(zu: What is a functional dependency\?\)$/,
    );
    expect(screen.getByText('Aus deiner Frage')).toBeInTheDocument();
    clean();
    fireEvent.click(screen.getByRole('button', { name: 'Antwort entfernen' }));
    await run(500);
    expect(screen.getByText('Antwort entfernt')).toBeInTheDocument();
    clean();
    fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
    await run(500);
    expect(screen.getByRole('button', { name: 'Antwort entfernen' })).toBeInTheDocument();
    // A question the preview has no answer for: said honestly, in German.
    await ask('zzz');
    expect(
      screen.getByText('In dieser Vorschau kann ich ein paar Fragen zu diesem Material beantworten – probier eine davon:'),
    ).toBeInTheDocument();
    clean();
    expect(container.querySelectorAll('[data-block-id^="ans-"]').length).toBe(1);
  });

  it('a playable Check, and steps: Prüfen, Noch mal versuchen, Weiter', async () => {
    await mount();
    await ask('Quiz me on Armstrong’s axioms');
    const group = screen.getByRole('group', { name: /^You know X/ });
    const check = within(group).getByRole('button', { name: 'Prüfen' });
    expect(check).toBeDisabled();
    fireEvent.click(within(group).getByRole('radio', { name: /Transitivity/ }));
    fireEvent.click(check);
    await run(300);
    expect(within(group).getByRole('button', { name: 'Noch mal versuchen' })).toBeInTheDocument();
    clean();
    fireEvent.click(within(group).getByRole('button', { name: 'Noch mal versuchen' }));
    await run(300);
    expect(within(group).getByRole('button', { name: 'Prüfen' })).toBeInTheDocument();
    // The steps: Step 1 of 3, and the way through.
    const steps = screen.getByRole('group', { name: /^Why transitivity/ });
    expect(within(steps).getByText('Schritt 1 von 3')).toBeInTheDocument();
    expect(within(steps).getByRole('button', { name: 'Vorheriger Schritt' })).toBeDisabled();
    fireEvent.click(within(steps).getByRole('button', { name: 'Nächster Schritt' }));
    await run(300);
    expect(within(steps).getByText('Schritt 2 von 3')).toBeInTheDocument();
    clean();
  });

  it('the dependency table, the closure and the BCNF split say their words in German', async () => {
    // The steps swap with an exit animation: this one runs on the real clock.
    vi.useRealTimers();
    await mount();
    // The table: a verdict, a role per column, a row to add.
    await ask('What is a functional dependency?');
    expect(screen.getByRole('button', { name: 'Zurücksetzen' })).toBeInTheDocument();
    expect(screen.getByText(/^(Gilt für diese Zeilen|Verletzt durch die Zeilen \d+ und \d+)$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zeile' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /: (linke Seite|rechte Seite|nicht in der Abhängigkeit)$/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/^Zeile 1, /).length).toBeGreaterThan(0);
    clean();
    fireEvent.click(screen.getByRole('button', { name: 'Zeile' }));
    expect(screen.getAllByLabelText(/^Zeile \d+, /).length).toBeGreaterThan(0);
    clean();

    // The closure, stepped to its end.
    await ask('What is the closure of {Title, Year}?');
    const closure = screen.getByRole('group', { name: /^Compute / });
    expect(within(closure).getByText('Starte mit')).toBeInTheDocument();
    expect(within(closure).getByText('Fang mit der Startmenge selbst an.')).toBeInTheDocument();
    const next = within(closure).getByRole('button', { name: 'Nächster Schritt' });
    fireEvent.click(next);
    expect(await within(closure).findByText(/^Die Menge enthält .+, also greift .+ und fügt .+ hinzu\./, undefined, { timeout: 5000 })).toBeInTheDocument();
    clean();
    for (let i = 0; i < 4; i++) {
      fireEvent.click(next);
      await run(500);
    }
    expect(await within(closure).findByText(/Nichts greift mehr – fertig\./, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(within(closure).getByText(/ist ein Superschlüssel\.$/)).toBeInTheDocument();
    clean();

    // BCNF: the reason for a split, then the verdict.
    await ask('Split this relation into BCNF');
    const bcnf = screen.getByRole('group', { name: /^Split Studios/ });
    expect(await within(bcnf).findByText(/Teile die Relation: Alles, was .+ bestimmt, kommt in eine Relation, der Rest bleibt bei /, undefined, { timeout: 5000 })).toBeInTheDocument();
    clean();
    const step = within(bcnf).getByRole('button', { name: 'Nächster Schritt' });
    for (let i = 0; i < 6 && !step.hasAttribute('disabled'); i++) {
      fireEvent.click(step);
      await run(500);
    }
    expect(await within(bcnf).findByText(/^Jede Relation ist in BCNF\. \d+ Aufteilungen?, nichts geht verloren/, undefined, { timeout: 5000 })).toBeInTheDocument();
    clean();
  }, 60000);

  it('Recall: blanks, Gewusst / Noch nicht, the ring and the footer', async () => {
    const { container } = await mount();
    const toggle = screen.getByRole('button', { name: 'Abrufen' });
    fireEvent.click(toggle);
    await run(50);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: 'Abrufen, Seite 6: 0 von 1 gewusst' })).toBeInTheDocument();
    clean();
    const block = container.querySelector<HTMLElement>('[data-view="clean"] [data-block-id="s-p6-1"]')!;
    fireEvent.click(within(block).getByRole('button', { name: 'Begriff aufdecken, Seite 6' }));
    await run(50);
    // Revealed: say whether you knew it.
    expect(within(block).getByRole('button', { name: 'Gewusst' })).toBeInTheDocument();
    clean();
    fireEvent.click(within(block).getByRole('button', { name: 'Noch nicht' }));
    await run(50);
    expect(screen.getByText('1 Begriff zum Wiederholen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Noch mal versuchen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Von vorn beginnen' })).toBeInTheDocument();
    expect(block.querySelector('[aria-label$=", aufgedeckt"]')).not.toBeNull();
    clean();
    // Try again opens it again; a seen term you never marked can be asked again.
    fireEvent.click(screen.getByRole('button', { name: 'Noch mal versuchen' }));
    await run(50);
    fireEvent.click(within(block).getByRole('button', { name: 'Begriff aufdecken, Seite 6' }));
    await run(4500);
    expect(within(block).getByRole('button', { name: /, aufgedeckt – markiere, ob du ihn gewusst hast$/ })).toBeInTheDocument();
    clean();
    // In Source, Recall rests, and says why.
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await run(400);
    expect(screen.getByRole('button', { name: 'Abrufen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Abrufen' })).toHaveAttribute('title', 'Abrufen funktioniert in der Lernansicht');
    clean();
  });

  it('the Depth dial: Kern, Zusammenfassung, Volltext and Seite', async () => {
    const { container } = await mount();
    const dial = () => screen.getByRole('radiogroup', { name: 'Tiefe für Seite 6' });
    expect(within(dial()).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Kern',
      'Zusammenfassung',
      'Volltext',
      'Seite',
    ]);
    clean();
    for (const depth of ['Kern', 'Volltext', 'Seite', 'Zusammenfassung']) {
      fireEvent.click(within(dial()).getByRole('radio', { name: depth }));
      await run(700);
      expect(within(dial()).getByRole('radio', { name: depth })).toHaveAttribute('aria-checked', 'true');
      clean();
    }
    // At Seite the page itself sits in Learn, with its chrome.
    fireEvent.click(within(dial()).getByRole('radio', { name: 'Seite' }));
    await run(700);
    expect(within(section(container, 6)).getByLabelText('Quellseite 6')).toBeInTheDocument();
    expect(within(section(container, 6)).getByRole('img', { name: `Seite 6 von ${NAME}` })).toBeInTheDocument();
    clean();
  });

  it('Quelle: the page as it is, what is missing, and the way back', async () => {
    await mount();
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await run(400);
    expect(screen.getByRole('switch', { name: 'Quelle zeigen' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Quelle wird angezeigt')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^Quellseite \d+$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Seite \d+ · Quelle$/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: new RegExp(`^Seite \\d+ von ${NAME}$`) }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Zurück zu: / }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^\d+ (Teil fehlt|Teile fehlen) in deiner Version$/).length).toBeGreaterThan(0);
    clean();
    // A first click offers, a second adds.
    fireEvent.click(screen.getAllByRole('button', { name: /^Nicht in deiner Version: / })[0]);
    expect(screen.getByRole('button', { name: /^Zu deiner Version hinzufügen: / })).toBeInTheDocument();
    expect(screen.getByText('Zu deiner Version hinzufügen')).toBeInTheDocument();
    clean();
  });

  it('Peek: the source page beside a paragraph, Pin, Ganze Seite and its dialog', async () => {
    await mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'Quelle zeigen, Seite 2' })[0]);
    const peek = screen.getByRole('complementary', { name: 'Quellseite' });
    expect(peek).toHaveTextContent(`Quelle · ${NAME} · Seite 2`);
    expect(within(peek).getByRole('img', { name: `Seite 2 von ${NAME}` })).toBeInTheDocument();
    expect(within(peek).getByRole('button', { name: 'Anheften' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(peek).getByRole('button', { name: 'Schließen' })).toBeInTheDocument();
    clean();
    fireEvent.click(within(peek).getByRole('button', { name: 'Ganze Seite' }));
    await run(400);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(`${NAME} · Seite 2`)).toBeInTheDocument();
    expect(within(dialog).getByText('Die Quellseite, die ausgewählte Stelle ist umrandet.')).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Zoom' })).toBeInTheDocument();
    clean();
  });

  it('Peek says when the source is gone or the page will not load; the page marks what you edited', () => {
    const region: Region = {
      page: { materialId: 'm', page: 2, width: 100, height: 140, imageUrl: '/p2.png' } as Region['page'],
      box: null,
    };
    const props = {
      materialName: 'N.pdf',
      pinned: false,
      onTogglePin() {},
      onClose() {},
      onFullPage() {},
      onPointerEnter() {},
      onPointerLeave() {},
    };
    const gone = render(<Peek region={region} {...props} sourceRemoved />);
    expect(screen.getByText('Die Quelle wurde entfernt. Die Lernansicht funktioniert weiterhin.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ganze Seite' })).toBeNull();
    clean();
    gone.unmount();

    render(<Peek region={region} {...props} sourceRemoved={false} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('Wir konnten diese Seite nicht laden.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Noch mal versuchen' })).toBeInTheDocument();
    clean();
  });

  it('a page you edited, with a figure and a part your version lacks, and a whole page', () => {
    const page: SourcePage = {
      materialId: 'm',
      page: 4,
      width: 720,
      height: 405,
      imageUrl: '/p4.webp',
      geometry: 'page',
      blocks: [
        { id: 'a', page: 4, bbox: [0.1, 0.1, 0.6, 0.2], kind: 'heading', text: 'Functional dependencies', readingOrder: 0 },
        { id: 'f', page: 4, bbox: [0.1, 0.5, 0.4, 0.6], kind: 'figure', text: '', readingOrder: 1 },
        { id: 'g', page: 4, bbox: [0.1, 0.7, 0.4, 0.8], kind: 'paragraph', text: 'Left out of the summary', readingOrder: 2 },
      ],
    };
    const blocks: CanvasBlock[] = [
      {
        id: 'c-a',
        origin: 'extracted',
        markdown: '### Functional dependencies',
        source: { materialId: 'm', page: 4, blockIds: ['a'] },
        edited: true,
      },
    ];
    render(
      <OriginalPage page={page} blocks={blocks} morph={false} materialName="N.pdf" onRegion={() => {}} onInclude={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Zurück zu (bearbeitet): Functional dependencies' })).toBeInTheDocument();
    expect(screen.getByText('Von dir bearbeitet')).toBeInTheDocument();
    expect(screen.getByText('1 Teil fehlt in deiner Version')).toBeInTheDocument();
    expect(screen.getByText('1 Abbildung fehlt in deiner Version')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zurück zur Lernansicht' })).toBeInTheDocument();
    clean();
  });

  it('Share, on a page that is only yours, opens the sheet in German', async () => {
    await mount('/v4/library/m/m-design-notes');
    expect(screen.getByRole('heading', { name: /^Design process/ })).toBeInTheDocument();
    expect(screen.getByText('Beispielseiten in dieser Vorschau')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Teilen' }));
    await run(700);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    clean();
  });

  it('a Material that is not there, and one that will not load, say so in German', async () => {
    const gone = await mount('/v4/library/m/nope');
    expect(screen.getByText('Dieses Material gibt es hier nicht')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zurück zur Bibliothek' })).toHaveAttribute('href', '/v4/library');
    clean();
    gone.unmount();

    window.history.replaceState({}, '', '/?mock=error');
    await mount();
    expect(screen.getByText('Dieses Material konnte nicht geladen werden')).toBeInTheDocument();
    clean();
  });

  it('while it loads, the way to the Material is announced in German', async () => {
    window.history.replaceState({}, '', '/?mock=loading');
    render(
      <MemoryRouter initialEntries={['/v4/library/m/m-norm']}>
        <Routes>
          <Route path="/v4/library/m/:materialId" element={<StudioCanvasScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(document.querySelector('[aria-busy="true"]')?.getAttribute('aria-label')).not.toMatch(/Loading/);
    clean();
  });
});
