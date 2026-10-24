import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import i18n from '@/i18n';
import LibraryScreen from '../../screens/LibraryScreen';
import * as shelf from '../../mocks/shelf';
import { resetNotes } from '../../mocks/notes';
import { resetReanchors } from '../../mocks/reanchor';

/*
 * The One Library shelf, in German. File names, page titles, notes and the
 * authored summaries are the student's own (demo data stays English);
 * everything around them is chrome, and none of it may be left in English.
 */

/* "Filter", "Space" and "Spaces" are left out: German says them the same way. */
const ENGLISH_CHROME = [
  'Library',
  'Everything',
  'Reading',
  'Shared',
  'Your words',
  'Your shelf',
  'Select',
  'Select all',
  'Selection',
  'selected',
  'Sort',
  'Recently opened',
  'Added',
  'Group by Space',
  'Search your Library',
  'Pick up where you left off',
  'Continue reading',
  'Bring something in',
  'Bring in your first file',
  'Drop to bring it in',
  'Reading your pages',
  'Writing your summary',
  'Developing',
  'Couldn’t read this file',
  'Only you',
  'Draft in',
  'Shared in',
  'Shared to',
  'Try again',
  'More for',
  'Remove',
  'Removed',
  'Keep them',
  'Undo',
  'Done',
  'Share',
  'Share to',
  'Publish',
  'Publish drafts',
  'Published',
  'Take back',
  'Take it back',
  'Keep it shared',
  'Back to only you',
  'Open in',
  'Choose a Space',
  'Looking for your Spaces',
  'Left as they are',
  'still being prepared',
  'already in a Space',
  'drafted in',
  'Brought in',
  'Understood',
  'Landed',
  'Where this page is',
  'you own it',
  'you edit it',
  'you’re a member',
  'Guided',
  'Open',
  'Endorsed',
  'Sample pages',
  'Nothing shared yet',
  'Nothing left to read',
  'Nothing on your shelf',
  'Nothing written yet',
  'Needs a new home',
  'Find it a new home',
  'Your work is safe',
  'New note',
  'Not filed in a Space yet',
  'Read',
  'Recall',
  'answers',
  'answer',
  'pages',
  'is ready',
  'It becomes a draft',
  'Open Space',
  'Contribution',
];

/*
 * The shared top bar and the mobile nav are not this shelf's; this checks the
 * shelf under them. Dialogs and toasts are portals into the body, so they are
 * read too.
 */
const said = () => {
  const root = document.body.cloneNode(true) as HTMLElement;
  root.querySelectorAll('header.sticky, nav').forEach((n) => n.remove());
  const attrs = [...root.querySelectorAll<HTMLElement>('[aria-label],[title],[placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  );
  /* Text node by text node: `textContent` runs "12 pages" into the next word, hiding it from a whole-word match. */
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: string[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode.textContent ?? '');
  return [...texts, ...attrs].join('\n');
};
const leftover = () => {
  const all = said();
  return ENGLISH_CHROME.filter((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(all));
};
const rawKeys = () => said().match(/\b(?:library|studio)\.[a-z][\w.]*/g) ?? [];
const clean = () => {
  expect(leftover()).toEqual([]);
  expect(rawKeys()).toEqual([]);
};

const open = async (path = '/v4/library') => {
  const r = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/v4/library" element={<LibraryScreen />} />
      </Routes>
      <Toaster />
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Bibliothek' }, { timeout: 3000 });
  await screen.findByRole('tab', { name: /^Alles/ }, { timeout: 3000 });
  return r;
};
const box = (name: RegExp) => screen.findByRole('checkbox', { name }, { timeout: 3000 });
const bar = () => screen.getByRole('group', { name: 'Auswahl' });

let into: typeof Element.prototype.scrollIntoView;
beforeEach(async () => {
  shelf.__reset();
  resetNotes();
  resetReanchors();
  into = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = () => {};
  await act(() => i18n.changeLanguage('de'));
});
afterEach(async () => {
  vi.useRealTimers(); // a test that fakes the clock never leaks it into the next
  shelf.__reset();
  localStorage.clear();
  Element.prototype.scrollIntoView = into;
  await act(() => i18n.changeLanguage('en'));
});

describe('the One Library shelf, in German', () => {
  it('the page, its filters, Continue and its covers say nothing in English', async () => {
    await open();
    expect(screen.getByText('Was du hinzugefügt, daraus gemacht und geteilt hast.')).toBeInTheDocument();
    for (const name of [/^Alles/, /^Am Lesen/, /^Geteilt/, /^Deine Worte/]) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('tablist', { name: 'Filter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auswählen…' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dein Regal' })).toBeInTheDocument();
    // Continue: one link, with where you stopped.
    const cont = screen.getByRole('link', { name: /^Weiterlesen: Normalization\.pdf, Seite 6 von 12/ });
    expect(cont).toHaveTextContent('Mach da weiter, wo du aufgehört hast · Seite 6 von 12');
    // A cover with progress, a cover without (a draft Lesson tile), a private page.
    const list = screen.getByRole('list', { name: 'Dein Regal' });
    const names = within(list)
      .getAllByRole('link')
      .map((a) => a.getAttribute('aria-label') ?? '');
    expect(names).toContain('Normalization.pdf, Geteilt in Database Systems, Gelesen 6/12, Gewusst 9/31, 2 Antworten, 1 Notiz');
    expect(names.some((n) => n.startsWith('Design process — my notes.pdf, Nur du, Gelesen 4/12'))).toBe(true);
    expect(names.some((n) => /^Change of Basis, Entwurf in /.test(n) && !/Gelesen/.test(n))).toBe(true);
    expect(within(list).getAllByText('Beispielseiten').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 Seite').length).toBeGreaterThan(0);
    expect(screen.getAllByText('12 Seiten').length).toBeGreaterThan(0);
    clean();
  });

  it('the first cell and an empty shelf invite in German', async () => {
    await open();
    expect(screen.getByLabelText('Etwas hinzufügen')).toBeInTheDocument();
    expect(screen.getByText('PDF, PPTX oder ein Foto – hier ablegen oder klicken')).toBeInTheDocument();
    clean();
  });

  it('bringing files in: developing, ready, failed, retry; and a big shelf offers search, sort and groups', async () => {
    await open();
    const input = screen.getByLabelText('Etwas hinzufügen') as HTMLInputElement;
    const files = ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf', 'e.pdf', 'f.pdf'].map(
      (n) => new File(['x'], n, { type: 'application/pdf' }),
    );
    /*
     * The mock settles a brought-in file after 3.3 s of wall-clock time. These
     * timers are made on a fake clock that is then dropped, so they never fire:
     * the files stay developing until the test settles them by hand.
     */
    vi.useFakeTimers();
    fireEvent.change(input, { target: { files } });
    vi.useRealTimers();
    // The six, and the one upload the seed is still preparing.
    expect(await screen.findAllByText('Wird vorbereitet…')).toHaveLength(7);
    expect(screen.getAllByText('Deine Seiten werden gelesen…').length).toBeGreaterThan(0);
    // A big shelf: search, sort and grouping.
    expect(screen.getByRole('searchbox', { name: 'In deiner Bibliothek suchen' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'In deiner Bibliothek suchen   /');
    const sort = screen.getByRole('combobox', { name: 'Sortieren' });
    expect(within(sort).getByRole('option', { name: 'Zuletzt geöffnet' })).toBeInTheDocument();
    expect(within(sort).getByRole('option', { name: 'Hinzugefügt' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nach Space gruppieren' }));
    expect(screen.getByRole('heading', { name: 'Nur du' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nach Space gruppieren' }));
    clean();

    const [a, b] = shelf.getItems().filter((i) => i.broughtIn).map((i) => i.id).reverse();
    act(() => shelf.settleDeveloping(a, false));
    expect(await screen.findByText('Wir konnten dieses Material nicht lesen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Noch mal versuchen' })).toBeInTheDocument();
    act(() => shelf.settleDeveloping(b, true));
    await waitFor(() => expect(screen.getByRole('status', { name: '' })).toBeInTheDocument());
    clean();

    // A search nothing answers to.
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(await screen.findByText('Nichts in deinem Regal passt zu „zzz“.')).toBeInTheDocument();
    clean();
  });

  it('a cover that becomes ready is announced, and says so, in German', async () => {
    await open();
    const input = screen.getByLabelText('Etwas hinzufügen') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'Ready.pdf', { type: 'application/pdf' })] } });
    const [id] = shelf.getItems().filter((i) => i.broughtIn).map((i) => i.id);
    act(() => shelf.settleDeveloping(id, true));
    await waitFor(() => expect(said()).toContain('Ready.pdf ist bereit'));
    clean();
  });

  it('every filter, the quiet lines, and Your words with its orphan', async () => {
    await open();
    for (const name of [/^Am Lesen/, /^Geteilt/, /^Alles/]) {
      fireEvent.click(screen.getByRole('tab', { name }));
      clean();
    }
    fireEvent.click(screen.getByRole('tab', { name: /^Deine Worte/ }));
    expect(await screen.findByRole('heading', { name: 'Deine Worte' })).toBeInTheDocument();
    expect(
      screen.getByText('Jede Notiz und jede Antwort, nach der du gefragt hast, weiterhin an ihrer Seite.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/^Antwort ·/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Notiz ·/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Seite \d+/).length).toBeGreaterThan(0);
    expect(await screen.findByRole('heading', { name: 'Braucht einen neuen Platz' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Neues Zuhause finden' }).length).toBeGreaterThan(0);
    expect(screen.getByText(/^Die Lektion, an der das hing, wurde entfernt/)).toBeInTheDocument();
    clean();

    fireEvent.click(screen.getByRole('button', { name: /Neue Notiz/ }));
    expect(await screen.findByPlaceholderText('Schreib es auf, solange es frisch ist …')).toBeInTheDocument();
    clean();
  });

  it('the quiet lines: nothing shared, nothing left to read', async () => {
    // Everything private and unread: nothing is shared.
    for (const i of shelf.getItems()) if (i.share.kind !== 'private') shelf.unshare(i.id);
    await open('/v4/library?f=shared');
    expect(await screen.findByText(/^Noch nichts geteilt\./)).toBeInTheDocument();
    clean();
  });

  it('nothing left to read, when everything is shared and read through', async () => {
    for (const i of shelf.getItems()) {
      if (i.stage === 'developing') shelf.settleDeveloping(i.id, true);
    }
    for (const i of shelf.getItems()) {
      if (i.share.kind === 'private') shelf.share(i.id, 's-dbs', 'member', 'open');
      if (i.share.kind === 'draft') shelf.publish(i.id);
      shelf.markRead(i.id, i.pageCount);
    }
    await open('/v4/library?f=reading');
    expect(await screen.findByText('Nichts mehr zu lesen. Hier ist alles durchgelesen.')).toBeInTheDocument();
    clean();
  });

  it('Select, its bar, Share to…, Publish drafts and Remove with Undo, all in German', async () => {
    await open('/v4/library?select=1');
    const user = userEvent.setup();
    await user.click(await box(/Design process/));
    await user.click(await box(/Normalization\.pdf/));
    expect(bar()).toHaveTextContent('2 ausgewählt');
    expect(screen.getByRole('status', { name: 'Anzahl der Auswahl' })).toHaveTextContent('2 ausgewählt');
    clean();

    await user.click(within(bar()).getByRole('button', { name: 'Teilen in…' }));
    const dialog = await screen.findByRole('dialog', { name: '2 Materialien teilen' });
    expect(dialog).toHaveTextContent('Bleiben unverändert: 1 ist schon in einem Space.');
    expect(within(dialog).getByRole('radiogroup', { name: 'Spaces' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: /^Database Systems · Geführt · du bist Mitglied$/ }));
    expect(dialog).toHaveTextContent('Es kommt als dein Beitrag, mit deinem Namen.');
    clean();
    await user.click(within(dialog).getByRole('button', { name: 'In Database Systems teilen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('1 geteilt · 1 ist schon in einem Space')).toBeInTheDocument();
    clean();

    await user.click(await box(/Axioms cheat sheet/));
    await user.click(within(bar()).getByRole('button', { name: 'Entwürfe veröffentlichen' }));
    expect(await screen.findByText('1 Entwurf veröffentlicht')).toBeInTheDocument();
    clean();

    await user.click(within(bar()).getByRole('button', { name: 'Entfernen' }));
    const confirm = await screen.findByRole('dialog', { name: '1 aus deiner Bibliothek entfernen?' });
    expect(confirm).toHaveTextContent('Die Auswahl verlässt dein Regal. Du kannst das einige Sekunden lang rückgängig machen.');
    expect(within(confirm).getByRole('button', { name: 'Behalten' })).toBeInTheDocument();
    clean();
    await user.click(within(confirm).getByRole('button', { name: '1 entfernen' }));
    expect(await screen.findByText('1 entfernt')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Rückgängig' })).toBeInTheDocument();
    expect(within(bar()).getByRole('button', { name: 'Alle auswählen' })).toBeInTheDocument();
    expect(within(bar()).getByRole('button', { name: 'Fertig' })).toBeInTheDocument();
    clean();
  });

  it('a cover’s menu: Share, the sheet with where the page stands, Publish, Open in, Take back', async () => {
    await open();
    const user = userEvent.setup();
    // A private page: Share, and the sheet says where it stands.
    await user.click(screen.getByRole('button', { name: /^Mehr zu Design process/ }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Entfernen…' })).toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: 'Teilen' }));
    const sheet = await screen.findByRole('dialog', { name: /^Design process — my notes\.pdf teilen$/ });
    expect(within(sheet).getByRole('list', { name: 'Wo diese Seite steht' })).toBeInTheDocument();
    for (const w of ['Hinzugefügt', 'Verstanden', 'Geteilt', 'Angekommen']) {
      expect(within(sheet).getByText(w)).toBeInTheDocument();
    }
    await user.click(within(sheet).getByRole('radio', { name: 'Intro to Linear Algebra · Offen · er gehört dir' }));
    expect(sheet).toHaveTextContent('Daraus wird eine Lektion als Entwurf in Intro to Linear Algebra.');
    clean();
    await user.click(within(sheet).getByRole('button', { name: 'In Intro to Linear Algebra teilen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await screen.findAllByText('Entwurf in Intro to Linear Algebra')).length).toBeGreaterThan(0);
    clean();
    await user.keyboard('{Escape}');

    // A draft: Publish, Take back.
    await user.click(screen.getByRole('button', { name: /^Mehr zu Axioms cheat sheet/ }));
    const draftMenu = await screen.findByRole('menu');
    await user.click(within(draftMenu).getByRole('menuitem', { name: /^In .* veröffentlichen$/ }));
    expect(await screen.findByText(/^In .* geteilt$/)).toBeInTheDocument();
    clean();

    // Shared: Open in…, and Take back to only you, with its confirm.
    await user.click(screen.getByRole('button', { name: /^Mehr zu Normalization\.pdf/ }));
    const sharedMenu = await screen.findByRole('menu');
    expect(within(sharedMenu).getByRole('menuitem', { name: 'In Database Systems öffnen' })).toBeInTheDocument();
    await user.click(within(sharedMenu).getByRole('menuitem', { name: 'Wieder nur für dich' }));
    const back = await screen.findByRole('dialog', { name: 'Normalization.pdf zurücknehmen?' });
    expect(back).toHaveTextContent('Es verlässt Database Systems. Deine Seite und deine Worte bleiben.');
    clean();
    await user.click(within(back).getByRole('button', { name: 'Zurücknehmen' }));
    expect(await screen.findByText('Wieder nur für dich')).toBeInTheDocument();
    clean();
  });
});
