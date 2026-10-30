import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ghostPillSm, whitePillSm } from '../components/stage';
import { LunaMark } from '../components/reader/luna/LunaMark';

/**
 * Sending a question to the people who run the Space.
 *
 * One gesture, wherever it appears: under an Explain or Ask answer, under a
 * Luna answer, beside "still foggy" at a check-in. The line is the whole
 * offer; the sheet is the question in your own words with the page already
 * attached, one switch to leave your name off, and Send. Nothing in the
 * reader moves for it.
 */

/** The quiet offer. */
export function SendLine({ onOpen, className }: { onOpen: () => void; className?: string }) {
  const { t } = useTranslation('v4Landing');
  return (
    <button type="button" onClick={onOpen} className={cn('console-focusable inline-flex items-center gap-2 rounded-full px-2 py-1 text-[13.5px] text-quiet transition-colors hover:text-foreground', className)}>
      <Send aria-hidden className="h-3.5 w-3.5" />
      {t('reader.line')}
    </button>
  );
}

export interface Sent {
  text: string;
  anonymous: boolean;
}

/** The sheet: the question, the page, the one switch, Send. */
export function SendSheet({
  open,
  page,
  lesson,
  draft = '',
  onSend,
  onClose,
}: {
  open: boolean;
  page: number;
  lesson: string;
  /** The learner's own words so far — an Ask, a Luna message — editable. */
  draft?: string;
  onSend: (sent: Sent) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('v4Landing');
  const reduce = useReducedMotion();
  const [text, setText] = useState(draft);
  const [anonymous, setAnonymous] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setText(draft);
      setAnonymous(false);
      area.current?.focus();
    }
  }, [open, draft]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-labelledby="send-to-space-title"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-2xl border border-white/[0.1] bg-popover p-5"
        >
          <h3 id="send-to-space-title" className="text-[17px] font-medium tracking-[-0.01em]">
            {t('reader.title')}
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-quiet">{t('reader.who')}</p>
          <span className="mt-4 inline-flex rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[12px] text-quiet">{t('reader.page', { page, lesson })}</span>
          <textarea
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 500))}
            aria-label={t('reader.yourQuestion')}
            rows={3}
            className="console-focusable mt-3 w-full resize-none rounded-xl border border-white/[0.1] bg-black/40 px-4 py-3 text-[15px] leading-relaxed"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => onSend({ text: text.trim(), anonymous })} disabled={!text.trim()} className={whitePillSm}>
              {t('reader.sendNow')}
            </button>
            <button type="button" onClick={onClose} className={ghostPillSm}>
              {t('reader.cancel')}
            </button>
            <label className="ml-auto inline-flex cursor-pointer items-center gap-2.5 text-[13px] text-quiet">
              <button
                type="button"
                role="switch"
                aria-checked={anonymous}
                aria-label={t('reader.anonymous')}
                onClick={() => setAnonymous((v) => !v)}
                className={cn('relative h-5 w-9 rounded-full transition-colors', anonymous ? 'bg-white' : 'bg-white/[0.18]')}
              >
                <span aria-hidden className={cn('absolute left-0.5 top-0.5 h-4 w-4 rounded-full transition-[transform,background-color] motion-reduce:transition-none', anonymous ? 'translate-x-4 bg-background' : 'bg-white')} />
              </button>
              {t('reader.anonymous')}
            </label>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Luna, saying one line: "Sent." — or that they answered. */
export function LunaLine({ text, action }: { text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex items-start gap-3">
      <LunaMark />
      <div className="min-w-0">
        <p className="text-[15px] leading-relaxed">{text}</p>
        {action && (
          <button type="button" onClick={action.onClick} className={cn(ghostPillSm, 'mt-2.5')}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
