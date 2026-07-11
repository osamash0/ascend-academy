import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { BookOpen, Loader2, Trash2, AlertCircle, CheckCircle2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast as sonnerToast } from '@/components/ui/sonner';
import { MultiFileDropzone } from '@/components/upload/MultiFileDropzone';
import { SharedRoutes } from '@/lib/routes';
import { useMyMaterials } from './useMyMaterials';
import type { Material } from '@/services/myMaterialsService';

const IN_FLIGHT = new Set(['queued', 'extracting', 'outlining', 'analyzing', 'embedding', 'finalizing']);

function StatusPill({ status }: { status: Material['status'] }) {
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> Ready
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400">
        <AlertCircle className="h-3.5 w-3.5" /> Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-semibold text-violet-400">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing
    </span>
  );
}

export default function MyMaterialsPage() {
  const { t } = useTranslation(['myMaterials']);
  const navigate = useNavigate();
  const { materials, isLoading, quota, upload, isUploading, remove } = useMyMaterials();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

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

  const handleDelete = async (lectureId: string) => {
    setPendingDelete(lectureId);
    try {
      await remove(lectureId);
      sonnerToast.success(t('deletedToast', { defaultValue: 'Material deleted.' }));
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
        <p className="mt-2 text-sm text-muted-foreground">
          {t('subtitle', {
            defaultValue: 'Upload your own PDFs — get slides, quizzes, tutor chat, and daily review, private to you.',
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
        <div className="mb-8">
          <MultiFileDropzone
            onFilesSelected={handleFiles}
            maxFiles={1}
            currentCount={isUploading ? 1 : 0}
            hideFolderOption
          />
        </div>
      )}

      <div className="space-y-3">
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
            className="depth-card flex items-center justify-between gap-4 p-4"
          >
            <div className="flex min-w-0 items-center gap-3">
              <FileText className="h-8 w-8 shrink-0 text-violet-400" />
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{m.title}</p>
                <p className="text-xs text-muted-foreground">
                  {m.status === 'completed'
                    ? t('slideQuizCount', {
                        defaultValue: '{{slides}} slides · {{quizzes}} quiz questions',
                        slides: m.total_slides,
                        quizzes: m.quiz_count,
                      })
                    : m.error || t('processing', { defaultValue: 'Processing…' })}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusPill status={m.status} />
              {m.status === 'completed' && m.lecture_id && (
                <Button size="sm" variant="secondary" onClick={() => navigate(SharedRoutes.LECTURE(m.lecture_id!))}>
                  {t('open', { defaultValue: 'Open' })}
                </Button>
              )}
              {m.lecture_id && !IN_FLIGHT.has(m.status) && (
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={pendingDelete === m.lecture_id}
                  onClick={() => handleDelete(m.lecture_id!)}
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
    </div>
  );
}
