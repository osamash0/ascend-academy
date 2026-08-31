import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell,
  BookOpen,
  Check,
  Flame,
  Heart,
  Sparkles,
  Trophy,
  UserPlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar } from './Avatar';
import { viewer } from '../mocks/people';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { AppNotification, NotificationKind } from '../mocks/notifications';
import { groupedByDay, markAllRead, unreadCount } from '../mocks/notifications';

/**
 * Notifications.
 *
 * Built to the PS5 Game-Invitations panel: a dark card list, each row an
 * avatar-or-icon beside two lines, an unread dot on the right, and actions as
 * full-width buttons rather than a row of small controls.
 *
 * Doc 2's rule holds — **a notification opens a Lesson or a person, never a
 * Space.** A Space is named as context in the message. `notifications.test.ts`
 * asserts that no target is ever a Space id.
 *
 * The count is quiet: a small number beside the bell, not a red badge. Doc 2
 * puts every destination in Learn mode, and an alarm in the chrome of a calm
 * screen is the thing people learn to ignore.
 */

const KIND_ICON: Record<NotificationKind, typeof Bell> = {
  endorsed: Check,
  promoted: Sparkles,
  liked: Heart,
  new_lessons: BookOpen,
  friend_request: UserPlus,
  achievement: Trophy,
  streak: Flame,
};

const KIND_TONE: Record<NotificationKind, string> = {
  endorsed: 'bg-success/15 text-success',
  promoted: 'bg-secondary/15 text-secondary',
  liked: 'bg-like/15 text-like',
  new_lessons: 'bg-primary/15 text-primary',
  friend_request: 'bg-primary/15 text-primary',
  achievement: 'bg-xp/15 text-xp',
  streak: 'bg-warning/15 text-warning',
};

/** Children inherit this — motion.dev's variant propagation, not per-item delays. */
const listVariants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.03 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: -4 },
  shown: { opacity: 1, y: 0 },
};

function Row({
  n,
  onOpen,
}: {
  n: AppNotification;
  onOpen: (n: AppNotification) => void;
}) {
  const Icon = KIND_ICON[n.type];

  return (
    <motion.button
      type="button"
      variants={itemVariants}
      whileTap={{ scale: 0.99 }}
      onClick={() => onOpen(n)}
      className={cn(
        'console-focusable flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors',
        n.read ? 'hover:bg-white/[0.04]' : 'bg-white/[0.04] hover:bg-white/[0.07]',
      )}
    >
      {/* A person's face where a person did it; the kind's icon otherwise. */}
      {n.actor ? (
        <span className="relative flex shrink-0">
          {/* One person, one face — this drew its own initials, so a
              notification you caused showed "Ab" where the top bar shows Luna. */}
          <Avatar person={n.actor} size="md" isViewer={n.actor.id === viewer.id} />
          <span
            aria-hidden
            className={cn(
              'absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-[#0b1018]',
              KIND_TONE[n.type],
            )}
          >
            <Icon aria-hidden className="h-2.5 w-2.5" />
          </span>
        </span>
      ) : (
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            KIND_TONE[n.type],
          )}
        >
          <Icon aria-hidden className="h-4 w-4" />
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold leading-snug text-foreground">
          {n.title}
        </span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-quiet">
          {n.message}
        </span>
      </span>

      {!n.read && (
        <span aria-label="Unread" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
      )}
    </motion.button>
  );
}

export function NotificationPanel() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // Local mirror so marking read re-renders; the fixture is the source.
  const [, force] = useState(0);
  const groups = groupedByDay();
  const unread = unreadCount();

  const openTarget = (n: AppNotification) => {
    setOpen(false);
    n.read = true;
    if (n.target.kind === 'lesson') {
      const spaceId = n.target.lessonId.split('-').slice(1, -1).join('-');
      navigate(`/v4/space/${spaceId}/lesson/${n.target.lessonId}`);
    } else if (n.target.kind === 'person') {
      navigate('/v4/social');
    } else {
      navigate('/v4/profile');
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          className="console-focusable relative flex h-9 w-9 items-center justify-center rounded-full text-quiet transition hover:bg-white/10 hover:text-foreground"
        >
          <Bell aria-hidden className="h-5 w-5" />
          {/* Quiet: a count, not an alarm. */}
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground">
              {unread}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={10}
        className="w-[24rem] border-white/[0.10] bg-[#0b1018]/95 p-0 backdrop-blur-xl"
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
          <p className="text-[14.5px] font-semibold">Notifications</p>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => {
                markAllRead();
                force((n) => n + 1);
              }}
              className="console-focusable rounded-md px-1 text-[12.5px] text-quiet transition-colors hover:text-foreground"
            >
              Mark all read
            </button>
          )}
        </div>

        {/*
          Both branches are Motion elements with a key and an exit. They were
          a plain `<div>` and a `motion.div` with neither, so the panel's
          `AnimatePresence` had nothing to animate: clearing the last
          notification swapped a list for an empty state instantly, inside a
          wrapper that looked like it was handling exactly that.
        */}
        <AnimatePresence mode="wait" initial={false}>
          {groups.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-6 py-12 text-center"
            >
              <Bell aria-hidden className="mx-auto mb-3 h-5 w-5 text-quiet" />
              <p className="text-[14.5px] font-semibold">Nothing yet</p>
              <p className="mt-1 text-[13px] leading-relaxed text-quiet">
                When someone likes or endorses your work, or a Space you are in publishes
                something, it turns up here.
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="list"
              variants={listVariants}
              initial="hidden"
              animate="shown"
              exit={{ opacity: 0 }}
              className="max-h-[26rem] overflow-y-auto p-2"
            >
              {groups.map((g) => (
                <div key={g.label} className="mb-1">
                  <p className="px-3 pb-1 pt-2 text-[12px] text-faint">{g.label}</p>
                  {g.items.map((n) => (
                    <Row key={n.id} n={n} onOpen={openTarget} />
                  ))}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </PopoverContent>
    </Popover>
  );
}
