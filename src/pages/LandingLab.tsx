/**
 * DEV-only lab for "How it's landing" (/landing-lab).
 *
 * The owner's door and the learner's way of sending a question, on fixtures,
 * so both can be judged before any of it reaches v4 (spec:
 * docs/superpowers/specs/2026-10-26-how-its-landing-design.md §5). Four
 * scenes: the door for a Space a professor runs, the door for a six-person
 * study group (everything under the floor), the Send sheet in the reader,
 * and the answer landing on the page; then the earlier directions A to D,
 * kept for comparison (E, the map, became the door). Not routed in
 * production builds.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import LandingScreen from '@/features/spaces/landing/LandingScreen';
import { AnsweredHere } from '@/features/spaces/landing/AnsweredHere';
import { LunaLine, SendLine, SendSheet, type Sent } from '@/features/spaces/landing/SendToSpace';
import { dbsLessons } from '@/features/spaces/mocks/lessons';
import { dbsLanding } from '@/features/spaces/mocks/landing';
import MockupPath from './landingMockups/MockupPath';
import MockupTiles from './landingMockups/MockupTiles';
import MockupCovers from './landingMockups/MockupCovers';
import MockupV4 from './landingMockups/MockupV4';

type SceneKey = 'owner' | 'friends' | 'reader' | 'answer' | 'mockA' | 'mockB' | 'mockC' | 'mockD';

const SCENES: { key: SceneKey; label: string; note: string }[] = [
  { key: 'owner', label: 'The door · Database Systems', note: 'The door as built (direction E, the map). 184 members, 131 reading; the owner gate is Phase C.' },
  { key: 'friends', label: 'The door · six friends', note: 'A study group under the five-reader floor. The honest state.' },
  { key: 'reader', label: 'In the reader · send a question', note: 'Under a Luna answer. One gesture, the page attached, one switch.' },
  { key: 'answer', label: 'In the reader · the answer lands', note: 'Back on page 12, with Luna as the messenger.' },
  { key: 'mockA', label: 'Mockup A · the path', note: 'Lessons as nodes down a path, each in its own deck colour; tap a node for its findings.' },
  { key: 'mockB', label: 'Mockup B · tiles', note: 'Stats first, then every Lesson as a cover tile with a mini page strip.' },
  { key: 'mockC', label: 'Mockup C · the decks', note: 'The covers as they are, a light bar under each, dots where pages need you.' },
  { key: 'mockD', label: 'Mockup D · v4 edition', note: 'A, B and C rebuilt from v4’s own pieces: masthead, skylight, journey line, UpNext, stage cards.' },
];

const SENT_QUESTION = 'Why does the BCNF split on page 12 lose the dependency — isn’t 3NF supposed to keep it? Or is losing it the point?';
const LUNA_ANSWER =
  'A BCNF split is made on a determinant that is not a key, so the dependency it breaks ends up spanning two tables — nothing stops you from writing rows that disagree. 3NF stops one step earlier, which is why it keeps it. Whether that is a price worth paying is a design call, not a rule.';
const OWNER_ANSWER =
  'Losing it is the point — and the cost. BCNF trades that dependency for a table with no redundancy. In the exam I’ll ask you to name what was lost, not to avoid losing it.';

export default function LandingLab() {
  // `?scene=mockD` opens a scene directly, so a detector or a reviewer can scan one without clicking.
  // The old `?scene=mockE` lands on the door, which is what E became.
  const fromUrl = new URLSearchParams(window.location.search).get('scene') as SceneKey | null;
  const [scene, setScene] = useState<SceneKey>(fromUrl && SCENES.some((s) => s.key === fromUrl) ? fromUrl : 'owner');
  const current = SCENES.find((s) => s.key === scene)!;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="sticky top-0 z-[60] border-b border-white/[0.08] bg-black/90 px-4 py-2 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
          <span className="mr-2 text-[12px] text-white/65">Dev lab, on fixtures, not in production</span>
          {SCENES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setScene(s.key)}
              aria-pressed={scene === s.key}
              className={`rounded-full px-3 py-1 text-[12.5px] transition-colors ${scene === s.key ? 'bg-white text-black' : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12]'}`}
            >
              {s.label}
            </button>
          ))}
          <span className="ml-auto hidden text-[12px] text-white/65 lg:inline">{current.note}</span>
        </div>
      </div>

      {scene === 'owner' && <LandingScreen key="s-dbs" spaceId="s-dbs" />}
      {scene === 'friends' && <LandingScreen key="s-friends" spaceId="s-friends" />}
      {scene === 'reader' && <ReaderFrame mode="send" />}
      {scene === 'answer' && <ReaderFrame mode="answer" />}
      {scene === 'mockA' && <MockupPath />}
      {scene === 'mockB' && <MockupTiles />}
      {scene === 'mockC' && <MockupCovers />}
      {scene === 'mockD' && <MockupV4 />}
    </div>
  );
}

/** A page of the reader with Luna beside it — enough of the room to judge the gesture in. */
function ReaderFrame({ mode }: { mode: 'send' | 'answer' }) {
  const { t } = useTranslation('v4Landing');
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const passage = dbsLessons.find((l) => l.id === 'l-s-dbs-4')?.passages?.find((p) => p.heading === 'Boyce-Codd normal form');
  const answered = dbsLanding.questions.find((q) => q.answer);

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)] lg:px-8">
      {/* The page */}
      <div>
        <p className="text-[12.5px] text-white/50">Normalization · page 12 of 12 · What BCNF costs</p>
        <article className="mt-3 rounded-2xl border border-white/[0.08] bg-[#0e0e10] p-8 sm:p-10" style={{ boxShadow: '0 0 0 1px rgba(255,255,255,0.03), 0 30px 60px -30px rgba(0,0,0,0.9)' }}>
          <h2 className="text-[28px] font-medium tracking-[-0.02em]">{passage?.heading ?? 'Boyce-Codd normal form'}</h2>
          <div className="mt-5 space-y-4 text-[16.5px] leading-relaxed text-white/85">
            {(passage?.body ?? []).map((p) => (
              <p key={p.slice(0, 24)}>{p}</p>
            ))}
          </div>
        </article>

        {mode === 'answer' && answered && (
          <div className="mt-5">
            <AnsweredHere question={SENT_QUESTION} answer={{ text: OWNER_ANSWER, forEveryone: true, at: answered.answer!.at }} accent={dbsLanding.accent} />
          </div>
        )}
      </div>

      {/* Luna beside the page */}
      <aside className="flex flex-col gap-5 self-start rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 lg:sticky lg:top-16">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/35">Luna · this session</p>

        <div className="rounded-xl bg-white/[0.05] px-4 py-3 text-[14.5px] leading-relaxed text-white/80">
          <span className="block text-[12px] text-white/40">You</span>
          {SENT_QUESTION}
        </div>

        {mode === 'send' && (
          <>
            <LunaLine text={LUNA_ANSWER} />
            {!sent && !open && <SendLine onOpen={() => setOpen(true)} className="-ml-2" />}
            <SendSheet open={open} page={12} lesson="Normalization" draft={SENT_QUESTION} onSend={(s) => { setSent(s); setOpen(false); }} onClose={() => setOpen(false)} />
            {sent && (
              <div className="space-y-3">
                <LunaLine text={t('reader.sent')} />
                <p className="text-[12px] text-white/40">
                  sent · page 12 · {sent.anonymous ? 'without a name' : 'with your name'} · {sent.text.length} characters
                </p>
              </div>
            )}
          </>
        )}

        {mode === 'answer' && (
          <>
            <LunaLine text={LUNA_ANSWER} />
            <LunaLine text={t('reader.sent')} />
            <div className="border-t border-white/[0.08] pt-5">
              <LunaLine text={t('reader.answeredLuna', { page: 12 })} action={{ label: t('reader.read'), onClick: () => document.querySelector('section[aria-label]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }} />
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
