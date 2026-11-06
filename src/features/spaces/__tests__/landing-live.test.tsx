import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { createLiveRepository, type V4Transport } from '../data/liveRepository';
import { stageAccentFor } from '../components/stage';
import { setLiveWorld } from '../data/world';
import { emptyWorld } from './emptyWorld';
import LandingScreen from '../landing/LandingScreen';
import type { LandingQuestion } from '../landing/types';

const { landingApi } = vi.hoisted(() => ({ landingApi: vi.fn() }));
vi.mock('../data/liveRepository', async (importOriginal) => {
  const real = await importOriginal<typeof import('../data/liveRepository')>();
  return { ...real, loadLiveRepository: async () => ({ landing: landingApi }) };
});

import { fromWire, useLanding, type WireLanding } from '../data/landing';

const SPACE = '0b7a308e-25cd-4a62-a47d-3e8930dde167';
const NULLS = [null, null, null, null, null, null, null, null];

/** What the backend sends a Space of six with four reading (Tasks 1 and 2). */
const wire: WireLanding = {
  spaceId: SPACE,
  spaceName: 'Lerngruppe',
  members: 6,
  reach: 'few',
  floor: 5,
  figures: { reading: { value: null, history: NULLS }, landing: { value: null, history: [] }, cleared: { value: null, history: [] } },
  lessons: [
    { id: 'l1', title: 'Vectors', order: 1, pages: 14, light: 'few' },
    { id: 'l2', title: 'Matrices', order: 2, pages: 19, light: 'few' },
  ],
  insights: [],
  questions: [],
  themes: [],
};

const waiting: LandingQuestion = { id: 'q1', lessonId: 'l1', page: 6, text: 'Only 2×2?', asker: { name: 'Lea' }, createdAt: '2026-11-05T10:00:00Z' };
const done: LandingQuestion = { ...waiting, id: 'q2', asker: null, answer: { text: 'Any size.', forEveryone: true, at: '2026-11-05T11:00:00Z' } };

afterEach(() => {
  landingApi.mockReset();
  setLiveWorld(null);
  vi.unstubAllEnvs();
});

describe('the door’s data, live', () => {
  it('asks the Space’s own endpoint', async () => {
    const calls: string[] = [];
    const http = { get: vi.fn(async (p: string) => (calls.push(p), wire)), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } as unknown as V4Transport;
    await createLiveRepository(http).landing(SPACE);
    expect(calls).toEqual([`/api/v1/v4/spaces/${SPACE}/landing`]);
  });

  it('draws the colours the server leaves out, the way the rest of the Space is lit', () => {
    const l = fromWire(wire);
    expect(l.accent).toBe(stageAccentFor('Lerngruppe'.length));
    expect(l.lessons.map((x) => x.color)).toEqual([stageAccentFor(1), stageAccentFor(2)]);
  });

  it('passes questions through as the Questions channel will send them, and none until it does', () => {
    expect(fromWire({ ...wire, questions: undefined }).questions).toEqual([]);
    const asked = fromWire({ ...wire, questions: [waiting], answered: [done] });
    expect(asked.questions.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(asked.questions[0].asker).toEqual({ name: 'Lea' });
  });

  it('a live Space loads, and its owner can try again after a failure', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    landingApi.mockRejectedValueOnce(Object.assign(new Error('500'), { status: 500 })).mockResolvedValueOnce(wire);
    const { result } = renderHook(() => useLanding(SPACE));
    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('error'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.landing?.spaceName).toBe('Lerngruppe');
    // Live, there is no way to answer yet: Plan 4 brings it.
    expect(result.current.answer).toBeUndefined();
  });

  it.each([403, 404])('a Space that is not yours is simply not there (%i)', async (status) => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    landingApi.mockRejectedValue(Object.assign(new Error(String(status)), { status }));
    const { result } = renderHook(() => useLanding(SPACE));
    await waitFor(() => expect(result.current.state).toBe('empty'));
  });

  it('the demo build reads its fixture, with no request, and can answer in place', () => {
    const { result } = renderHook(() => useLanding('s-dbs'));
    expect(result.current.state).toBe('ready');
    expect(result.current.answer).toBeTypeOf('function');
    expect(landingApi).not.toHaveBeenCalled();
  });

  it('a live build never shows a made-up Space, even at a demo id', () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    setLiveWorld(emptyWorld());
    const { result } = renderHook(() => useLanding('s-dbs'));
    expect(result.current.state).toBe('empty');
    expect(result.current.landing).toBeNull();
    expect(landingApi).not.toHaveBeenCalled();
  });
});

const door = () =>
  render(
    <MemoryRouter>
      <LandingScreen spaceId={SPACE} />
    </MemoryRouter>,
  );

describe('the door, live', () => {
  const live = () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    setLiveWorld(emptyWorld());
  };

  it('waits on the stage, then says it could not load, with a way to try again', async () => {
    live();
    landingApi.mockRejectedValueOnce(Object.assign(new Error('500'), { status: 500 })).mockResolvedValueOnce(wire);
    door();
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    // Trying again asks the endpoint a second time, and the door opens on what it says.
    expect(await screen.findByText('A few people have been reading. Patterns show once five people have been through a page.')).toBeInTheDocument();
    expect(landingApi).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('a door that is not yours, or gone, is simply not there', async () => {
    live();
    landingApi.mockRejectedValue(Object.assign(new Error('404'), { status: 404 }));
    door();
    expect(await screen.findByText('That Space isn’t here')).toBeInTheDocument();
  });

  it('under the floor: Luna says it once, with no count, no figures and no map', async () => {
    live();
    landingApi.mockResolvedValue(wire);
    door();
    expect(await screen.findByText('A few people have been reading. Patterns show once five people have been through a page.')).toBeInTheDocument();
    expect(screen.getAllByText(/Patterns show once five/)).toHaveLength(1);
    expect(screen.queryByText(/members read this week/)).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Lessons' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Questions for you' })).toBeNull();
  });

  it('a question that arrives live is read, opens its page, and offers no answer that goes nowhere', async () => {
    live();
    landingApi.mockResolvedValue({ ...wire, questions: [waiting] });
    door();
    expect(await screen.findByRole('heading', { level: 2, name: 'Questions for you' })).toBeInTheDocument();
    expect(screen.getByText('Only 2×2?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vectors, page 6' })).toHaveAttribute('href', `/v4/space/${SPACE}/lesson/l1/faces?page=6`);
    expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
  });

  it('reads in German', async () => {
    live();
    landingApi.mockResolvedValue(wire);
    await i18n.changeLanguage('de');
    door();
    expect(await screen.findByRole('heading', { level: 1, name: 'Wie es ankommt' })).toBeInTheDocument();
    expect(screen.getByText('Ein paar Leute haben gelesen. Muster zeigen sich, sobald fünf Leute durch eine Seite sind.')).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });
});
