import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { loadLiveRepository } from '../../data/liveRepository';
import { useRefreshWorld } from '../../data/viewer';
import { ghostPillSm } from '../stage';

/**
 * Leave a Space you joined (LS-077). Quiet, at the end of the page, and asked
 * once: joining the wrong course from "Popular right now" used to keep it on
 * Home for good. Only the enrolment goes; notes and progress stay, so joining
 * again picks up where you were.
 */
export function LeaveSpace({ spaceId, name }: { spaceId: string; name: string }) {
  const { t } = useTranslation('v4Space');
  const navigate = useNavigate();
  const refreshWorld = useRefreshWorld();
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const leave = async () => {
    setLeaving(true);
    setFailed(false);
    try {
      await (await loadLiveRepository()).leaveSpace(spaceId);
      await refreshWorld();
      navigate('/v4/spaces');
    } catch {
      setFailed(true);
      setLeaving(false);
    }
  };

  if (!asking)
    return (
      <button type="button" onClick={() => setAsking(true)} className="console-focusable text-[13px] text-quiet underline-offset-4 hover:text-foreground hover:underline">
        {t('course.leave.open')}
      </button>
    );

  return (
    <div role="group" aria-label={t('course.leave.open')} className="flex flex-col items-center gap-3">
      <p className="max-w-md text-center text-[14px] text-quiet">{t('course.leave.ask', { name })}</p>
      <div className="flex gap-2">
        <button type="button" onClick={leave} disabled={leaving} className={ghostPillSm}>
          {leaving ? t('course.leave.leaving') : t('course.leave.yes')}
        </button>
        <button type="button" onClick={() => setAsking(false)} disabled={leaving} className={ghostPillSm}>
          {t('course.leave.keep')}
        </button>
      </div>
      {failed && (
        <p role="alert" className="text-[13px] text-quiet">
          {t('course.leave.failed')}
        </p>
      )}
    </div>
  );
}
