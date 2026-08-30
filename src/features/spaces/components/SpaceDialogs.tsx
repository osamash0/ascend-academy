import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Link2, Lock, Plus, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { SpaceMode, Visibility } from '../types';
import { createSpace, joinCodeFor, spaceByJoinCode } from '../mocks/spaces';
import { AuthorLine, ClassificationChips } from './badges';

/**
 * Creating and joining a Space.
 *
 * Both are Studio work — they configure an object — but they are reached from
 * a Learn screen, so they open as dialogs rather than sending you to a
 * separate page. Doc 2's Create rule: the button "states what it will make and
 * where it will land", so neither flow ever asks "where should this go?".
 *
 * Landing follows Doc 2's table: creating or joining a Space lands you on that
 * Space's Overview — empty-state for a new one.
 */

const MODES: { key: SpaceMode; label: string; blurb: string }[] = [
  {
    key: 'guided',
    label: 'Guided',
    blurb: 'Only you and your Editors publish Lessons. Members still contribute alongside them.',
  },
  {
    key: 'open',
    label: 'Open',
    blurb: 'Every Member can publish Lessons, credited to them. Good for learning together.',
  },
];

const VISIBILITIES: { key: Visibility; label: string; blurb: string; icon: typeof Lock }[] = [
  { key: 'private', label: 'Private', blurb: 'Only you.', icon: Lock },
  { key: 'invite', label: 'Invite', blurb: 'Anyone with the code or link.', icon: Link2 },
  { key: 'public', label: 'Public', blurb: 'Anyone can find and join, one tap.', icon: Users },
];

/** A radio row — used for both mode and visibility so they read alike. */
function Choice<T extends string>({
  options,
  value,
  onChange,
  name,
}: {
  options: { key: T; label: string; blurb: string; icon?: typeof Lock }[];
  value: T;
  onChange: (v: T) => void;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="space-y-2">
      {options.map((o) => {
        const Icon = o.icon;
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.key)}
            className={cn(
              'console-focusable flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors',
              active
                ? 'border-primary/45 bg-primary/[0.08]'
                : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                active ? 'border-primary' : 'border-white/25',
              )}
            >
              {active && <span className="h-2 w-2 rounded-full bg-primary" />}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[14.5px] font-semibold">
                {Icon && <Icon aria-hidden className="h-3.5 w-3.5" />}
                {o.label}
              </span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-quiet">
                {o.blurb}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── New Space ──────────────────────────────────────────────────── */

export function NewSpaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<SpaceMode>('guided');
  const [visibility, setVisibility] = useState<Visibility>('private');

  const create = () => {
    if (!name.trim()) return;
    const s = createSpace({ name: name.trim(), mode, visibility });
    onOpenChange(false);
    setName('');
    // Doc 2 landing table: creating a Space lands on its Overview, empty.
    navigate(`/v4/space/${s.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[20px] font-semibold">New Space</DialogTitle>
          <DialogDescription className="text-[14px] leading-relaxed text-quiet">
            A Space is one subject, its material, and the people learning it with you.
            You can change any of this later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          <div>
            <label htmlFor="space-name" className="mb-2 block text-[13.5px] font-medium">
              Name
            </label>
            <input
              id="space-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              placeholder="Database Systems"
              autoFocus
              className="console-focusable h-11 w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 text-[15px] outline-none placeholder:text-faint"
            />
          </div>

          <div>
            <p className="mb-2 text-[13.5px] font-medium">Who can publish Lessons</p>
            <Choice<SpaceMode> name="Mode" options={MODES} value={mode} onChange={setMode} />
          </div>

          <div>
            <p className="mb-2 text-[13.5px] font-medium">Who can see it</p>
            <Choice<Visibility>
              name="Visibility"
              options={VISIBILITIES}
              value={visibility}
              onChange={setVisibility}
            />
          </div>

          {/* The button says what it makes and where it lands. */}
          <button
            type="button"
            onClick={create}
            disabled={!name.trim()}
            className="console-focusable flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-[14.5px] font-semibold text-slate-900 transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
          >
            <Plus aria-hidden className="h-4 w-4" />
            Create and open it
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Join with a code ───────────────────────────────────────────── */

export function JoinSpaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const found = code.trim().length >= 4 ? spaceByJoinCode(code) : undefined;
  const tooShort = code.trim().length < 4;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[20px] font-semibold">Join with a code</DialogTitle>
          <DialogDescription className="text-[14px] leading-relaxed text-quiet">
            Six characters, from whoever runs the Space.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <input
            aria-label="Join code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            autoFocus
            maxLength={6}
            className="console-focusable h-14 w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 text-center text-[24px] font-semibold tracking-[0.3em] outline-none placeholder:text-faint"
          />

          {/* Preview before joining — Doc 1: no blind joins. */}
          {found ? (
            <div className="rounded-2xl border border-white/[0.10] bg-white/[0.04] p-4">
              <p className="text-[16px] font-semibold">{found.name}</p>
              <div className="mt-2">
                <AuthorLine person={found.owner} prefix="Owner" />
              </div>
              <p className="mt-2 text-[13px] text-quiet tabular-nums">
                {found.lessonCount} Lessons · {found.memberCount.toLocaleString()} Members
              </p>
              <ClassificationChips space={found} max={2} className="mt-3" />
            </div>
          ) : (
            !tooShort && (
              <p className="text-[13.5px] text-quiet">
                No Space uses that code. Check it with whoever sent it.
              </p>
            )
          )}

          <button
            type="button"
            disabled={!found}
            onClick={() => {
              if (!found) return;
              onOpenChange(false);
              setCode('');
              navigate(`/v4/space/${found.id}`);
            }}
            className="console-focusable flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-[14.5px] font-semibold text-slate-900 transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
          >
            <KeyRound aria-hidden className="h-4 w-4" />
            {found ? `Join ${found.name}` : 'Join'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Shown on the manage screen so an Owner can hand the code out. */
export function JoinCodeBlock({ spaceId }: { spaceId: string }) {
  const [copied, setCopied] = useState(false);
  const code = joinCodeFor(spaceId);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <code className="rounded-xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-[18px] font-semibold tracking-[0.24em]">
        {code}
      </code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(code);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }}
        className="console-focusable h-10 rounded-full border border-white/12 bg-white/[0.04] px-4 text-[13px] font-medium text-quiet transition-colors hover:bg-white/[0.08] hover:text-foreground"
      >
        {copied ? 'Copied' : 'Copy code'}
      </button>
    </div>
  );
}
