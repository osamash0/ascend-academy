// src/features/spaces/components/LunaMemoryCard.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { lunaApi, type LunaSessionRow, type MemoryLine } from '../data/lunaSession';

/** What Luna knows about you — every line yours to change or remove. */
export function LunaMemoryCard() {
  const { t } = useTranslation('v4Luna');
  const [lines, setLines] = useState<MemoryLine[] | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    lunaApi.memory().then((r) => setLines(r.memory)).catch(() => setLines([]));
  }, []);

  if (!lines) return null;
  const save = async () => {
    if (!editing) return;
    const text = editing.text.trim().slice(0, 80);
    if (!text) return;
    try {
      const next = await lunaApi.editMemory(editing.id, text);
      setLines((cur) => (cur ?? []).map((l) => (l.id === next.id ? next : l)));
      setEditing(null);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  return (
    <section aria-label={t('memory.title')} className="mt-20 flex flex-col gap-3">
      <h2 className="text-[16px] font-medium">{t('memory.title')}</h2>
      <p className="text-[13px] text-quiet">{t('memory.intro')}</p>
      {lines.length === 0 ? (
        <p className="text-[13.5px] text-quiet">{t('memory.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-white/10">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-2 text-[13.5px]">
              <span className="w-28 shrink-0 text-[12px] text-quiet">{t(`memory.kinds.${l.kind}`)}</span>
              {editing?.id === l.id ? (
                <input value={editing.text} maxLength={80} autoFocus
                  onChange={(e) => setEditing({ id: l.id, text: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && void save()}
                  className="flex-1 bg-transparent outline-none" />
              ) : (
                <span className={l.active ? 'flex-1' : 'flex-1 text-quiet'}>
                  {l.text}
                  {!l.active && <span className="ml-2 text-[11.5px]">{t('memory.faded')}</span>}
                </span>
              )}
              {editing?.id === l.id ? (
                <button type="button" onClick={() => void save()} className="console-focusable text-[12.5px]">{t('memory.save')}</button>
              ) : (
                <button type="button" onClick={() => setEditing({ id: l.id, text: l.text })} className="console-focusable text-[12.5px] text-quiet hover:text-foreground">
                  {t('memory.edit')}
                </button>
              )}
              <button type="button" onClick={async () => {
                try {
                  await lunaApi.deleteMemory(l.id);
                  setLines((cur) => (cur ?? []).filter((x) => x.id !== l.id));
                  setFailed(false);
                } catch {
                  setFailed(true);
                }
              }} className="console-focusable text-[12.5px] text-quiet hover:text-foreground">
                {t('memory.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {failed && <p role="alert" className="text-[12.5px] text-quiet">{t('memory.error')}</p>}
      {lines.length > 0 && (
        <button type="button" onClick={async () => {
          if (!window.confirm(t('memory.forgetConfirm'))) return;
          try {
            await lunaApi.forgetAll();
            setLines([]);
            setFailed(false);
          } catch {
            setFailed(true);
          }
        }} className="console-focusable self-start text-[12.5px] text-quiet underline hover:text-foreground">
          {t('memory.forget')}
        </button>
      )}
    </section>
  );
}

/** In a Space: pick up where you left off with Luna, and the summaries you kept. */
export function LunaSpaceRow({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation('v4Luna');
  const [sessions, setSessions] = useState<LunaSessionRow[]>([]);
  useEffect(() => {
    lunaApi.sessions(spaceId).then((r) => setSessions(r.sessions)).catch(() => setSessions([]));
  }, [spaceId]);
  const last = sessions[0];
  const kept = sessions.filter((s) => s.kept && s.wrap);
  if (!last || (!last.lecture_id && kept.length === 0)) return null;
  const shaky = last.wrap?.shaky.length ?? 0;
  return (
    <section className="mt-12 flex flex-col gap-3">
      {last.lecture_id && (
        <Link to={`/v4/space/${spaceId}/lesson/${last.lecture_id}/faces?luna=1`}
          className="console-focusable flex flex-col rounded-2xl border border-white/10 px-4 py-3 hover:border-white/25">
          <span className="text-[14px] font-medium">{t('space.pickUp')}</span>
          <span className="text-[12.5px] text-quiet">
            {last.goal ? t('space.lastTime', { goal: last.goal }) : null}
            {shaky ? ` · ${t('space.shaky', { count: shaky })}` : ''}
          </span>
        </Link>
      )}
      {kept.length > 0 && (
        <div>
          <h3 className="text-[12px] text-quiet">{t('space.sessions')}</h3>
          <ul className="mt-1 flex flex-col gap-1 text-[13.5px]">
            {kept.slice(0, 5).map((s) => (
              <li key={s.id}>{s.wrap!.covered.map((c) => c.text).join(' · ')}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
