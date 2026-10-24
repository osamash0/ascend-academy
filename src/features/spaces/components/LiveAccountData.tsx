import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, Loader2, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { loadLiveRepository } from '../data/liveRepository';
import { useSessionActions } from '../data/session';

/**
 * "Your data" in v4 Settings, live: the same two server endpoints the old
 * Settings page uses.
 *
 * - Export is `GET /api/auth/export-data`: the complete record (GDPR Art. 20),
 *   every table account_service exports, not what the browser could read.
 * - Delete is `POST /api/auth/delete-account`: server-side erasure only. A
 *   failure surfaces as a failure and leaves you signed in; there is no
 *   browser fallback that deletes a few tables and calls it done.
 *
 * The calls go through the live repository and sign-out through the session
 * context App provides, because this namespace may not touch auth or the API
 * client directly (boundary.test.ts). The copy is the old page's, which says
 * what really happens: deletion removes everything.
 */
export function LiveAccountData() {
  const { t } = useTranslation(['v4Settings', 'settings']);
  const session = useSessionActions();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const exportData = async () => {
    setExporting(true);
    try {
      const data = await (await loadLiveRepository()).exportAccount();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `learnstation-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(t('settings:data.exportSuccess'), {
        description: t('settings:data.exportSuccessDescription'),
      });
    } catch {
      toast(t('settings:data.exportError'), {
        description: t('settings:data.exportErrorDescription'),
      });
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      const result = await (await loadLiveRepository()).deleteAccount();
      await session?.signOut();
      navigate('/', { replace: true });
      toast(t('settings:data.deleteSuccess'), {
        description:
          result?.files === 'finishing'
            ? t('settings:data.deleteSuccessFilesFinishing')
            : t('settings:data.deleteSuccessDescription'),
      });
    } catch (error: unknown) {
      toast(t('settings:data.deleteError'), {
        description: (error instanceof Error && error.message) || t('settings:data.deleteErrorDescription'),
      });
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <div className="flex items-start justify-between gap-6 border-b border-white/[0.06] py-4">
        <div className="min-w-0">
          <p className="text-[14.5px] font-semibold text-foreground">{t('sections.data.export.label')}</p>
          <p className="mt-0.5 max-w-[62ch] text-[13px] leading-relaxed text-muted-foreground">
            {t('settings:data.exportDescription')}
          </p>
        </div>
        <button
          type="button"
          onClick={exportData}
          disabled={exporting}
          className="console-focusable inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-white/12 px-4 text-[13px] font-medium transition-colors hover:bg-white/[0.06] disabled:opacity-60"
        >
          {exporting ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <Download aria-hidden className="h-4 w-4" />
          )}
          {t('sections.data.export.action')}
        </button>
      </div>

      <div className="flex items-start justify-between gap-6 py-4">
        <div className="min-w-0">
          <p className="text-[14.5px] font-semibold text-foreground">{t('sections.data.delete.label')}</p>
          <p className="mt-0.5 max-w-[62ch] text-[13px] leading-relaxed text-muted-foreground">
            {t('settings:data.deleteDescription')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="console-focusable inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-destructive/40 px-4 text-[13px] font-medium text-destructive transition-colors hover:bg-destructive/10"
        >
          <Trash2 aria-hidden className="h-4 w-4" />
          {t('sections.data.delete.action')}
        </button>
      </div>

      <Dialog open={confirming} onOpenChange={(open) => !deleting && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings:data.deleteTitle')}</DialogTitle>
            <DialogDescription>{t('settings:data.deleteConfirmShort')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="console-focusable h-9 rounded-lg border border-white/12 px-4 text-[13px] font-medium"
            >
              {t('settings:data.cancel')}
            </button>
            <button
              type="button"
              onClick={deleteAccount}
              disabled={deleting}
              className="console-focusable inline-flex h-9 items-center gap-2 rounded-lg bg-destructive px-4 text-[13px] font-semibold text-destructive-foreground disabled:opacity-60"
            >
              {deleting && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {deleting ? t('settings:data.deleting') : t('settings:data.deleteFinal')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
