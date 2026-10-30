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

const door = (spaceId: string) =>
  render(
    <MemoryRouter>
      <LandingScreen spaceId={spaceId} />
    </MemoryRouter>,
  );

const HOTSPOT = /On page 12 of Normalization, 41 people opened Explain or asked/;
const TRAP = /78% said page 9 had clicked, then 61% of them missed its checkpoint/;

afterEach(() => {
  void i18n.changeLanguage('en');
});

describe('the owner’s door', () => {
  it('opens on Luna naming the one page, with the one action beside her', () => {
    door('s-dbs');
    expect(screen.getByRole('heading', { level: 1, name: 'How it’s landing' })).toBeInTheDocument();
    expect(screen.getByText('One page is asking for you: Normalization, page 12. The rest is landing.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open page 12' })).toHaveAttribute('href', '/v4/space/s-dbs/lesson/l-s-dbs-4/faces?page=12');
    // The Space's name rides on the way back; nothing announces the title.
    expect(screen.getByRole('link', { name: 'Database Systems' })).toHaveAttribute('href', '/v4/space/s-dbs');
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
    // Lessons nobody has been through yet say so instead of claiming a number.
    expect(screen.getAllByText('too few to say yet')).toHaveLength(4);
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

  it('an answer for everyone moves the question off the waiting count', () => {
    door('s-dbs');
    expect(screen.getByRole('heading', { level: 2, name: /Questions for you/ })).toHaveTextContent('3');
    const row = screen.getByText(/Why does the BCNF split on page 12/).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Answer' }));
    fireEvent.change(within(row).getByLabelText('Write an answer'), { target: { value: 'Losing it is the point.' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Answer for everyone' }));
    expect(within(row).getByText('Answered · for everyone')).toBeInTheDocument();
    expect(within(row).getByText('Losing it is the point.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Questions for you/ })).toHaveTextContent('2');
  });

  it('under the floor it says so once, with no figures and no light', () => {
    door('s-friends');
    expect(screen.getByText('4 people have been reading. Patterns show once five people have been through a page.')).toBeInTheDocument();
    expect(screen.queryByText(/members read this week/)).toBeNull();
    expect(screen.queryByRole('link', { name: /^Open page/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Page \d+ of/ })).toBeNull();
    expect(screen.getAllByText('too few to say yet')).toHaveLength(3);
    // A question still comes through: that is the one thing a person chose to send.
    expect(screen.getByText(/determinant trick on page 6/)).toBeInTheDocument();
  });

  it('reads in German the way the glossary says', async () => {
    await i18n.changeLanguage('de');
    door('s-dbs');
    expect(screen.getByRole('heading', { level: 1, name: 'Wie es ankommt' })).toBeInTheDocument();
    expect(screen.getByText('Eine Seite braucht dich: Normalization, Seite 12. Der Rest kommt an.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Seite 12 von Normalization' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Fragen an dich/ })).toBeInTheDocument();
    expect(screen.getByText('Jemand')).toBeInTheDocument();
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
    expect(ledeKey(dbsLanding.insights, dbsLanding.readers, dbsLanding.floor)).toBe('act');
    expect(ledeKey(friendsLanding.insights, friendsLanding.readers, friendsLanding.floor)).toBe('floor');
    expect(ledeKey([], 40, 5)).toBe('calm');
  });

  it('each Lesson above the floor carries one help value per page', () => {
    for (const l of dbsLanding.lessons) {
      if (l.light === 'few') expect(l.help).toBeUndefined();
      else expect(l.help).toHaveLength(l.pages);
    }
  });
});
