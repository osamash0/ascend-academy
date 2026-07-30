import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { BookOpen, Loader2, Trash2, CheckCircle2, FileText, Clock3, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast as sonnerToast } from '@/components/ui/sonner';
import { MultiFileDropzone } from '@/components/upload/MultiFileDropzone';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SharedRoutes } from '@/lib/routes';
import { useMyMaterials } from './useMyMaterials';
import type { Material } from '@/services/myMaterialsService';

const IN_FLIGHT = new Set(['queued', 'extracting', 'outlining', 'analyzing', 'embedding', 'finalizing']);

function StatusPill({ status }: { status: Material['status'] }) {
  const { t } = useTranslation(['myMaterials']);

  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> {t('ready')}
      </span>
    );
  }
  if (status === 'failed' || status === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400">
        <XCircle className="h-3.5 w-3.5" /> {t(status === 'failed' ? 'failed' : 'cancelled')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-semibold text-violet-400">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('processing')}
    </span>
  );
}

function formatUploadedDate(value: string, locale: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

export default function MyMaterialsPage() {
  const { t, i18n } = useTranslation(['myMaterials']);
  const navigate = useNavigate();
  const { materials, isLoading, quota, upload, isUploading, remove } = useMyMaterials();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [materialToDelete, setMaterialToDelete] = useState<Material | null>(null);

  const quotaExhausted = !!quota && quota.remaining <= 0;

  const handleFiles = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    try {
      const result = await upload(file);
      if (result.status === 'duplicate') {
        sonnerToast.success(t('duplicateToast', { defaultValue: "You've already uploaded this file." }));
      } else {
        sonnerToast.success(t('uploadedToast', { defaultValue: 'Upload queued — processing now.' }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed.';
      const friendly = message.includes('403')
        ? t('quotaErrorToast', { defaultValue: "You've used all your uploads for this month." })
        : t('uploadErrorToast', { defaultValue: 'Upload failed. Please try again.' });
      sonnerToast.error(friendly);
    }
  };

  const handleDelete = async () => {
    const target = materialToDelete;
    if (!target?.lecture_id) return;

    setPendingDelete(target.lecture_id);
    try {
      await remove(target.lecture_id);
      sonnerToast.success(t('deletedToast', { defaultValue: 'Material deleted.' }));
      setMaterialToDelete(null);
    } catch {
      sonnerToast.error(t('deleteErrorToast', { defaultValue: 'Could not delete this material.' }));
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight text-foreground">
          {t('title', { defaultValue: 'My Materials' })}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {t('subtitle', {
            defaultValue: 'Your private PDFs live here. Upload a file, wait for it to be prepared, then open it to study. Course materials stay in Library.',
          })}
        </p>
      </div>

      {quota && (
        <div className="mb-6 depth-card p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-foreground">
              {t('quotaLabel', { defaultValue: 'Uploads this month' })}
            </span>
            <span className="text-muted-foreground">
              {quota.uploads_used} / {quota.quota_limit}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-violet-500 transition-all"
              style={{ width: `${Math.min(100, (quota.uploads_used / Math.max(1, quota.quota_limit)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {quotaExhausted ? (
        <div className="depth-card mb-8 p-6 text-center text-sm text-muted-foreground">
          {t('quotaExhausted', {
            defaultValue: "You've used all {{limit}} uploads for this month. Come back next month for more.",
            limit: quota?.quota_limit,
          })}
        </div>
      ) : (
        <section className="mb-10" aria-labelledby="materials-upload-heading">
          <h2 id="materials-upload-heading" className="mb-3 text-lg font-bold text-foreground">
            {t('uploadSection', { defaultValue: 'Add a PDF' })}
          </h2>
          <MultiFileDropzone
            onFilesSelected={handleFiles}
            maxFiles={1}
            currentCount={isUploading ? 1 : 0}
            hideFolderOption
          />
        </section>
      )}

      <section aria-labelledby="materials-list-heading">
        <div className="mb-3 flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 id="materials-list-heading" className="text-lg font-bold text-foreground">
            {t('filesHeading', { defaultValue: 'Your files' })}
          </h2>
        </div>
        <div className="space-y-3" aria-busy={isLoading}>
        {isLoading && (
          <div className="flex justify-center py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}

        {!isLoading && materials.length === 0 && (
          <div className="depth-card flex flex-col items-center gap-3 p-12 text-center">
            <BookOpen className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {t('emptyState', { defaultValue: 'No materials yet — upload a PDF to get started.' })}
            </p>
          </div>
        )}

        {materials.map((m) => (
          <motion.div
            key={m.run_id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="depth-card flex flex-col items-stretch justify-between gap-4 p-4 sm:flex-row sm:items-center"
          >
            <div className="flex min-w-0 items-center gap-3">
              <FileText className="h-8 w-8 shrink-0 text-violet-400" />
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{m.title}</p>
                {m.title !== m.filename && (
                  <p className="truncate text-xs text-muted-foreground">
                    {t('originalFile', { defaultValue: 'Original file: {{filename}}', filename: m.filename })}
                  </p>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {m.status === 'completed' ? (
                    <span>
                      {t('slideQuizCount', {
                        defaultValue: '{{slides}} slides · {{quizzes}} quiz questions',
                        slides: m.total_slides,
                        quizzes: m.quiz_count,
                      })}
                    </span>
                  ) : (
                    <span className={m.status === 'failed' || m.status === 'cancelled' ? 'text-red-300' : undefined}>
                      {m.error || (m.status === 'failed' || m.status === 'cancelled'
                        ? t('failedDetail', { defaultValue: 'This file could not be processed. You can remove it and upload another PDF.' })
                        : t('processing', { defaultValue: 'Processing…' }))}
                    </span>
                  )}
                  {formatUploadedDate(m.created_at, i18n.language) && (
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('uploadedOn', {
                        defaultValue: 'Uploaded {{date}}',
                        date: formatUploadedDate(m.created_at, i18n.language),
                      })}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
              <StatusPill status={m.status} />
              {m.status === 'completed' && m.lecture_id && (
                <Button className="h-11" size="sm" variant="secondary" onClick={() => navigate(SharedRoutes.LECTURE(m.lecture_id!))}>
                  {t('open', { defaultValue: 'Open' })}
                </Button>
              )}
              {m.lecture_id && !IN_FLIGHT.has(m.status) && (
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={pendingDelete === m.lecture_id}
                  onClick={() => setMaterialToDelete(m)}
                  className="h-11 w-11"
                  aria-label={t('delete', { defaultValue: 'Delete material' })}
                >
                  {pendingDelete === m.lecture_id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
          </motion.div>
        ))}
        </div>
      </section>

      <AlertDialog
        open={Boolean(materialToDelete)}
        onOpenChange={(open) => {
          if (!open && !pendingDelete) setMaterialToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteDialog.title', { defaultValue: 'Delete this material?' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDialog.description', {
                defaultValue: 'This permanently removes the generated study content for {{title}}. This cannot be undone.',
                title: materialToDelete?.title ?? materialToDelete?.filename ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(pendingDelete)}>
              {t('deleteDialog.cancel', { defaultValue: 'Cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(pendingDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              {pendingDelete ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              {t('deleteDialog.confirm', { defaultValue: 'Delete material' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
