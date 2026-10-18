import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { NotebookPen, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * Write or edit a Note.
 *
 * Notes are the one Library object that is *content* rather than a pointer, so
 * they are edited where they are read instead of sending you into a Space.
 *
 * Autosaves on blur rather than behind a Save button: a note is a scratchpad,
 * and a scratchpad that can lose your writing because you clicked away is
 * worse than no scratchpad. Escape cancels the edit and restores what was
 * there — the one case where discarding is what you meant.
 *
 * `height: "auto"` is animatable in Motion, so the editor expands into place
 * rather than snapping (motion.dev/docs/react-animation).
 */

interface Props {
  /** Existing body, or empty to compose a new one. */
  value?: string;
  placeholder?: string;
  onSave: (body: string) => void;
  onDelete?: () => void;
  /** Start open — used by the "New note" action. */
  autoOpen?: boolean;
  className?: string;
}

export function NoteEditor({
  value = '',
  placeholder,
  onSave,
  onDelete,
  autoOpen = false,
  className,
}: Props) {
  const { t } = useTranslation('v4Spaces');
  const [open, setOpen] = useState(autoOpen);
  const [body, setBody] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setBody(value), [value]);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  const commit = () => {
    const next = body.trim();
    // An empty note is an accident, not an instruction to save nothing.
    if (next && next !== value.trim()) onSave(next);
    if (!next) setBody(value);
    setOpen(false);
  };

  if (!open) {
    /*
     * A written note shows its own text when closed. The first version
     * collapsed to "Edit this note", which hid the writing behind a click —
     * so reading your own notes meant opening every one of them. A note is
     * content, not a form field: closed is its reading state.
     */
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={value ? t('notes.edit', { note: value.slice(0, 60) }) : t('notes.write')}
        className={cn(
          'console-focusable flex w-full items-start gap-3 rounded-2xl border px-5 py-4 text-left transition-colors',
          value
            ? 'border-white/[0.08] bg-white/[0.025] hover:bg-white/[0.05]'
            : 'border-dashed border-white/12 hover:border-white/25 hover:bg-white/[0.03]',
          className,
        )}
      >
        <NotebookPen aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-quiet" />
        {value ? (
          <span className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-quiet">
            {value}
          </span>
        ) : (
          <span className="text-[14px] text-quiet">{t('notes.write')}</span>
        )}
      </button>
    );
  }

  return (
    <AnimatePresence initial={false}>
      <motion.div
        // Opacity and drift, never height — see PracticeScreen.
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        className={cn(
          'overflow-hidden rounded-2xl border border-primary/30 bg-white/[0.04]',
          className,
        )}
      >
        <textarea
          ref={ref}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // Restore and close — the one case where discarding is meant.
              setBody(value);
              setOpen(false);
            }
            // ⌘/Ctrl+Enter saves without hunting for a button.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
          }}
          rows={4}
          placeholder={placeholder ?? t('notes.placeholder')}
          aria-label={t('notes.label')}
          className="w-full resize-y bg-transparent p-4 text-[14.5px] leading-relaxed outline-none placeholder:text-faint"
        />
        <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] px-4 py-2.5">
          <p className="text-[12.5px] text-faint">
            {t('notes.hint')}
          </p>
          <div className="flex items-center gap-2">
            {onDelete && value && (
              <button
                type="button"
                // onMouseDown, because onBlur would fire first and re-save it.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onDelete();
                  setOpen(false);
                }}
                aria-label={t('notes.delete')}
                className="console-focusable flex h-8 w-8 items-center justify-center rounded-lg text-quiet transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 aria-hidden className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                commit();
              }}
              className="console-focusable h-8 rounded-lg bg-white px-3.5 text-[13px] font-semibold text-slate-900"
            >
              {t('notes.done')}
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
