import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import LandingScreen from '../landing/LandingScreen';
import { Figures } from '../landing/Figures';
import type { Landing } from '../landing/types';
import { SendSheet } from '../landing/SendToSpace';
import { AnsweredHere } from '../landing/AnsweredHere';
import { ledeKey } from '../landing/copy';
import { dbsLanding, friendsLanding } from '../mocks/landing';

/*
 * How it's landing — the owner's door, on fixtures (spec
 * docs/superpowers/specs/2026-10-26-how-its-landing-design.md §5, §7).
 */

Element.prototype.scrollIntoView = vi.fn();

// One test hands the door a variant of the fixture; every other test reads the fixtures as they are.
const fixture = vi.hoisted(() => ({ override: null as Landing | null }));
vi.mock('../mocks/landing', async (importOriginal) => {
  const m = await importOriginal<typeof import('../mocks/landing')>();
  return { ...m, landingFor: (id: string) => fixture.override ?? m.landingFor(id) };
});

const door = (spaceId: string) =>
  render(
    <MemoryRouter>
      <LandingScreen spaceId={spaceId} />
    </MemoryRouter>,
  );

const HOTSPOT = /On page 12, 41 people opened Explain or asked/;
const TRAP = /78% said page 9 had clicked, then 61% of them missed its checkpoint/;

afterEach(() => {
  fixture.override = null;
  void i18n.changeLanguage('en');
});

describe('the owner’s door', () => {
  it('opens on Luna naming the one page, with the one action beside her', () => {
    door('s-dbs');
    expect(screen.getByRole('heading', { level: 1, name: 'How it’s landing' })).toBeInTheDocument();
    // Two pages need the owner; Luna counts them and says where to start, the button carries the page.
    expect(screen.getByText('2 pages are asking for you. Start with Normalization.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open page 12' })).toHaveAttribute('href', '/v4/space/s-dbs/lesson/l-s-dbs-4/faces?page=12');
    // The Space's name rides on the way back; nothing announces the title.
    expect(screen.getByRole('link', { name: 'Database Systems' })).toHaveAttribute('href', '/v4/space/s-dbs');
  });

  it('with one page asking, Luna says one, and that the rest is landing', () => {
    fixture.override = { ...dbsLanding, insights: dbsLanding.insights.filter((i) => i.id !== 'i-dbs-trap-9') };
    door('s-dbs');
    expect(screen.getByText('Normalization has one page asking for you. The rest is landing.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open page 12' })).toBeInTheDocument();
  });

  it('says how the Space is going in three figures', () => {
    door('s-dbs');
    expect(screen.getByText('131')).toBeInTheDocument();
    expect(screen.getByText('of 184 members read this week')).toBeInTheDocument();
    expect(screen.getByText('71%')).toBeInTheDocument();
    expect(screen.getByText('78%')).toBeInTheDocument();
  });

  it('a figure with nothing to say shows a dash, never a percent, and no bar for that week', () => {
    const quiet: Landing = {
      ...dbsLanding,
      figures: { ...dbsLanding.figures, landing: { value: null, history: [null, null, 40, null, 55, 60, null, null] } },
    };
    const { container } = render(<Figures landing={quiet} accent="#06b6d4" />);
    const column = screen.getByText('of pages are landing').parentElement!;
    expect(column.querySelector('dd')).toHaveTextContent(/^–$/);
    expect(column.textContent).not.toContain('%');
    // The other two keep their numbers.
    expect(screen.getByText('78%')).toBeInTheDocument();
    expect(screen.getByText('131')).toBeInTheDocument();
    // Three weeks drew a bar; the five with nothing to say kept their slot and drew none.
    const bars = container.querySelectorAll('svg')[1].querySelectorAll('rect');
    expect(bars).toHaveLength(3);
  });

  it('draws every Lesson as its pages, and a lit page opens that page', () => {
    door('s-dbs');
    expect(screen.getByRole('link', { name: 'Page 12 of Normalization' })).toHaveAttribute('href', '/v4/space/s-dbs/lesson/l-s-dbs-4/faces?page=12');
    expect(screen.getByRole('link', { name: 'Page 9 of Relational Algebra' })).toHaveAttribute('href', '/v4/space/s-dbs/lesson/l-s-dbs-5/faces?page=9');
    expect(screen.getByRole('link', { name: 'Page 18 of SQL' })).toBeInTheDocument();
    // A Lesson's readers are not counted again under the figures.
    expect(screen.queryByText(/\d+ readers?$/)).toBeNull();
    // Lessons too few have been through are named once, below the map, not drawn.
    expect(screen.getByText('Integrity, Transactions, Query Processing, and Index Structures: too few readers yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Integrity' })).toBeNull();
  });

  it('a finding says its page, not its Lesson again', () => {
    door('s-dbs');
    expect(screen.getByRole('button', { name: /^People stay a median of 3 s on page 5 before moving on\.$/ })).toBeInTheDocument();
  });

  it('a finding opens in place onto what people asked, never word for word', async () => {
    door('s-dbs');
    const finding = screen.getByRole('button', { name: HOTSPOT });
    expect(finding).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(finding);
    expect(finding).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Help-seeking this concentrated/)).toBeInTheDocument();
    expect(screen.getByText('What people asked on page 12')).toBeInTheDocument();
    expect(screen.getByText('41 people asked · shown as themes, never word for word')).toBeInTheDocument();
    expect(screen.getByText(/Why a BCNF split can lose a dependency/)).toBeInTheDocument();
    // One finding open at a time.
    fireEvent.click(screen.getByRole('button', { name: TRAP }));
    expect(finding).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(screen.queryByText('What people asked on page 12')).toBeNull());
  });

  it('the trap page opens onto clicked against missed', () => {
    door('s-dbs');
    fireEvent.click(screen.getByRole('button', { name: TRAP }));
    expect(screen.getByText('Clicked vs. missed on page 9')).toBeInTheDocument();
    expect(screen.getByText('Said clicked, missed it')).toBeInTheDocument();
    expect(screen.getByText('33 people')).toBeInTheDocument();
  });

  it('people waiting come before the map, without a count', () => {
    door('s-dbs');
    const questions = screen.getByRole('heading', { level: 2, name: 'Questions for you' });
    const lessons = screen.getByRole('heading', { level: 2, name: 'Lessons' });
    expect(questions.compareDocumentPosition(lessons) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Only the waiting ones; the answered one waits behind a fold.
    expect(screen.queryByText('Does cardinality mean the number of rows?')).toBeNull();
    // No dots between who, when and where.
    const row = screen.getByText(/Why does the BCNF split on page 12/).closest('li')!;
    expect(row.textContent).not.toContain('·');
  });

  it('an answer moves the question under the Answered fold', () => {
    door('s-dbs');
    const row = screen.getByText(/Why does the BCNF split on page 12/).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Answer' }));
    fireEvent.change(within(row).getByLabelText('Write an answer'), { target: { value: 'Losing it is the point.' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Answer for everyone' }));
    expect(screen.queryByText(/Why does the BCNF split on page 12/)).toBeNull();
    const fold = screen.getByRole('button', { name: 'Answered' });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(fold);
    expect(screen.getByText(/Why does the BCNF split on page 12/)).toBeInTheDocument();
    expect(screen.getByText('Losing it is the point.')).toBeInTheDocument();
    expect(screen.getAllByText('Answered for everyone')).toHaveLength(2);
  });

  it('with nobody waiting, the questions row is not there', () => {
    fixture.override = { ...dbsLanding, questions: dbsLanding.questions.filter((q) => q.answer) };
    door('s-dbs');
    expect(screen.queryByRole('heading', { level: 2, name: 'Questions for you' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Answered' })).toBeInTheDocument();
  });

  it('under the floor it says so once, with no figures and no light', () => {
    door('s-friends');
    expect(screen.getByText('A few people have been reading. Patterns show once five people have been through a page.')).toBeInTheDocument();
    // No count: in a group of six, "4 people" is nearly who.
    expect(screen.queryByText(/\d+ (people|person) ha(ve|s) been reading/)).toBeNull();
    expect(screen.queryByText(/members read this week/)).toBeNull();
    expect(screen.queryByRole('link', { name: /^Open page/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Page \d+ of/ })).toBeNull();
    // Luna has said it; no map repeats it.
    expect(screen.queryByRole('heading', { level: 2, name: 'Lessons' })).toBeNull();
    expect(screen.queryByText(/too few/)).toBeNull();
    // A question still comes through: that is the one thing a person chose to send.
    expect(screen.getByText(/determinant trick on page 6/)).toBeInTheDocument();
  });

  it('with nobody reading yet, Luna says nobody, never a few', () => {
    fixture.override = { ...friendsLanding, reach: 'none', questions: [] };
    door('s-friends');
    expect(screen.getByText('Nobody has been reading yet. Patterns show once five people have been through a page.')).toBeInTheDocument();
    expect(screen.queryByText(/A few people/)).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Lessons' })).toBeNull();
  });

  it('under the floor, in German, without a count', async () => {
    await i18n.changeLanguage('de');
    door('s-friends');
    expect(screen.getByText('Ein paar Leute haben gelesen. Muster zeigen sich, sobald fünf Leute durch eine Seite sind.')).toBeInTheDocument();
  });

  it('reads in German the way the glossary says', async () => {
    await i18n.changeLanguage('de');
    door('s-dbs');
    expect(screen.getByRole('heading', { level: 1, name: 'Wie es ankommt' })).toBeInTheDocument();
    expect(screen.getByText('2 Seiten brauchen dich. Fang mit Normalization an.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Seite 12 von Normalization' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Fragen an dich' })).toBeInTheDocument();
    expect(screen.getByText('Integrity, Transactions, Query Processing und Index Structures: noch zu wenige Lesende.')).toBeInTheDocument();
    expect(screen.getByText('Jemand')).toBeInTheDocument();
  });
});

describe('a big Space folds what needs nothing', () => {
  const titlesDrawn = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent);

  it('shows the three longest-waiting questions, then more ten at a time', () => {
    door('s-big');
    const section = screen.getByRole('heading', { level: 2, name: 'Questions for you' }).closest('section')!;
    const rows = () => within(section).getAllByRole('listitem');
    expect(rows()).toHaveLength(3);
    // Longest waiting first.
    expect(rows()[0]).toHaveTextContent('How detailed should a use case be');
    expect(within(section).queryByRole('button', { name: 'Show less' })).toBeNull();
    fireEvent.click(within(section).getByRole('button', { name: 'Show more' }));
    expect(rows()).toHaveLength(13);
    fireEvent.click(within(section).getByRole('button', { name: 'Show more' }));
    expect(rows()).toHaveLength(14);
    expect(within(section).queryByRole('button', { name: 'Show more' })).toBeNull();
    fireEvent.click(within(section).getByRole('button', { name: 'Show less' }));
    expect(rows()).toHaveLength(3);
  });

  it('the Answered fold opens on three, then more', () => {
    door('s-big');
    fireEvent.click(screen.getByRole('button', { name: 'Answered' }));
    const fold = screen.getByRole('button', { name: 'Answered' }).closest('section')!;
    expect(within(fold).getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(within(fold).getByRole('button', { name: 'Show more' }));
    expect(within(fold).getAllByRole('listitem')).toHaveLength(9);
  });

  it('a Lesson with a finding is always drawn; a quiet stretch of three or more folds where it sits', () => {
    door('s-big');
    const drawn = titlesDrawn();
    expect(drawn).toEqual(expect.arrayContaining(['Requirements', 'Concurrency', 'Version control in depth', 'Security basics']));
    // One quiet Lesson, and two in a row, stay drawn.
    expect(drawn).toEqual(expect.arrayContaining(['Why software fails', 'Testing basics', 'Test doubles']));
    // Six quiet ones between Requirements and Concurrency fold into one line.
    expect(drawn).not.toContain('Use cases');
    fireEvent.click(screen.getByRole('button', { name: '6 Lessons landing' }));
    expect(titlesDrawn()).toEqual(expect.arrayContaining(['Use cases', 'Design patterns']));
    // In their place, in order.
    const after = titlesDrawn();
    expect(after.indexOf('Use cases')).toBeGreaterThan(after.indexOf('Requirements'));
    expect(after.indexOf('Design patterns')).toBeLessThan(after.indexOf('Concurrency'));
    // The next quiet stretch is still folded.
    expect(screen.getByRole('button', { name: '7 Lessons landing' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(titlesDrawn()).not.toContain('Use cases');
  });

  it('a Lesson with many findings says its two loudest; its pages stay lit either way', () => {
    door('s-big');
    const lesson = screen.getByRole('heading', { level: 3, name: 'Concurrency' }).closest('li')!;
    const sentences = () => within(lesson).getAllByRole('button', { expanded: false });
    expect(sentences()).toHaveLength(2);
    expect(within(lesson).getByRole('link', { name: 'Page 24 of Concurrency' })).toBeInTheDocument();
    fireEvent.click(within(lesson).getByRole('button', { name: 'Show more' }));
    expect(sentences()).toHaveLength(4);
  });

  it('names four Lessons too new to say, then the rest on request', () => {
    door('s-big');
    expect(screen.getByText('Threat models, Release engineering, Incident response, Postmortems and 4 more: too few readers yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByText(/^Threat models, Release engineering, .*Legacy code, and Teams and process: too few readers yet\.$/)).toBeInTheDocument();
  });

  it('a long Lesson wraps at forty pages a row', () => {
    door('s-big');
    const strip = screen.getByRole('link', { name: 'Page 83 of Version control in depth' }).parentElement!;
    expect(strip.style.gridTemplateColumns).toBe('repeat(40, minmax(0, 1fr))');
  });
});

describe('sending a question to the Space', () => {
  it('keeps the learner’s words, attaches the page, and leaves the name off on request', () => {
    const onSend = vi.fn();
    render(<SendSheet open page={12} lesson="Normalization" draft="Is losing it the point?" onSend={onSend} onClose={vi.fn()} />);
    expect(screen.getByText('Page 12 · Normalization')).toBeInTheDocument();
    const field = screen.getByLabelText('Your question') as HTMLTextAreaElement;
    expect(field.value).toBe('Is losing it the point?');
    fireEvent.change(field, { target: { value: 'Is losing the dependency the point?' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Without my name' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith({ text: 'Is losing the dependency the point?', anonymous: true });
  });

  it('the answer lands with its reach on it', () => {
    render(<AnsweredHere question="Is it the point?" answer={{ text: 'Yes, and the cost.', forEveryone: true, at: '2026-10-26T10:00:00Z' }} accent="#06b6d4" />);
    expect(screen.getByText('The people who run this Space answered')).toBeInTheDocument();
    expect(screen.getByText('Answered for everyone')).toBeInTheDocument();
    expect(screen.getByText('Yes, and the cost.')).toBeInTheDocument();
  });
});

describe('the lede', () => {
  it('follows the loudest finding, and the floor before anything', () => {
    expect(ledeKey(dbsLanding.insights, dbsLanding.reach)).toBe('act');
    expect(ledeKey(friendsLanding.insights, friendsLanding.reach)).toBe('floor');
    expect(ledeKey([], 'enough')).toBe('calm');
    expect(ledeKey(dbsLanding.insights, 'none')).toBe('none');
  });

  it('each Lesson above the floor carries one help value per page', () => {
    for (const l of dbsLanding.lessons) {
      if (l.light === 'few') expect(l.help).toBeUndefined();
      else expect(l.help).toHaveLength(l.pages);
    }
  });
});
