import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Upload as UploadIcon, X } from 'lucide-react';
import { apiClient } from '@/lib/apiClient';
import { toast as sonnerToast } from '@/components/ui/sonner';
import { ProfessorRoutes } from '@/lib/routes';
import { useAuth } from '@/lib/auth';
import type { UploadJob } from '@/types/upload';

const IN_FLIGHT_STATUSES = new Set<UploadJob['status']>([
  'queued', 'extracting', 'outlining', 'analyzing', 'embedding', 'finalizing',
]);

/**
 * Persistent "Uploads" nav indicator (Phase 1.2). Modeled on NotificationBell's
 * badge+dropdown shell, but polls GET /upload/jobs instead of a Supabase
 * realtime channel — parse jobs run server-side (Arq), so polling is the
 * only way to reflect progress that happened while no tab was open at all.
 */
export function UploadsIndicator() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [isHidden, setIsHidden] = useState(document.hidden);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const seenTerminal = useRef<Set<string>>(new Set());

  useEffect(() => {
    const onVisibility = () => setIsHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const jobsQuery = useQuery({
    queryKey: ['upload-jobs-all'],
    queryFn: async () => {
      const res = await apiClient.get<{ jobs: UploadJob[] }>('/api/upload/jobs');
      return res.jobs;
    },
    enabled: !!user,
    refetchInterval: isHidden ? false : 8000,
    staleTime: 4000,
  });

  const jobs = jobsQuery.data ?? [];
  const inFlight = jobs.filter((j) => IN_FLIGHT_STATUSES.has(j.status));

  // Fire a one-time toast the first time a job is observed to have settled —
  // this is the "completion triggers an in-app notification" requirement,
  // and it lives here (not the page-level batch poll) because this is the
  // one thing guaranteed mounted on every page, including after the
  // professor closed the upload tab and came back later.
  useEffect(() => {
    for (const job of jobs) {
      if (job.status !== 'completed' && job.status !== 'failed') continue;
      if (seenTerminal.current.has(job.run_id)) continue;
      seenTerminal.current.add(job.run_id);
      const label = job.filename || 'A file';
      if (job.status === 'completed') {
        sonnerToast.success(`${label} ready`, {
          description: job.batch_id ? 'Open the batch review to publish it.' : 'Lecture created.',
          action: job.batch_id
            ? { label: 'Review', onClick: () => navigate(ProfessorRoutes.UPLOAD_BATCH_REVIEW(job.batch_id!)) }
            : undefined,
        });
      } else {
        sonnerToast.error(`${label} failed`, { description: job.error || 'Parsing failed.' });
      }
    }
  }, [jobs, navigate]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  if (!user) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label={inFlight.length > 0 ? `${inFlight.length} uploads in progress` : 'Uploads'}
        aria-expanded={open}
        data-testid="uploads-indicator"
      >
        <UploadIcon className="w-5 h-5" />
        {inFlight.length > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-violet-500 rounded-full"
          >
            {inFlight.length > 9 ? '9+' : inFlight.length}
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-80 bg-card border border-border rounded-xl shadow-xl overflow-hidden z-50"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-foreground text-sm">Uploads</h3>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {jobs.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  <UploadIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No recent uploads
                </div>
              ) : (
                jobs.map((job) => (
                  <button
                    key={job.run_id}
                    onClick={() => {
                      if (job.batch_id) navigate(ProfessorRoutes.UPLOAD_BATCH_REVIEW(job.batch_id));
                      else if (job.lecture_id) navigate(ProfessorRoutes.LECTURE_EDIT(job.lecture_id));
                      setOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 border-b border-border/50 last:border-b-0 hover:bg-muted/50 text-left"
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-muted">
                      {IN_FLIGHT_STATUSES.has(job.status) ? (
                        <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
                      ) : job.status === 'completed' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <UploadIcon className="w-4 h-4 text-destructive" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{job.filename || job.pdf_hash}</p>
                      <p className="text-xs text-muted-foreground">{job.status}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
