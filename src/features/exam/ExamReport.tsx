import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { useGamification } from '@/lib/gamification/GamificationProvider';
import { StudentRoutes, SharedRoutes } from '@/lib/routes';
import { useExam } from './useExam';

const EXAM_XP = 20;
const EXAM_READY_THRESHOLD = 80;

export default function ExamReport() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(['exam']);
  const { user } = useAuth();
  const gamification = useGamification();
  const { exam, isLoading, sendMissesToReview, isSendingMisses, sentMisses } = useExam(examId);

  const [sentAlready, setSentAlready] = useState(false);
  const gamificationFired = useRef(false);

  useEffect(() => {
    if (!exam || exam.score === null || !user || gamificationFired.current) return;
    gamificationFired.current = true;
    const dedupeKey = `exam:${user.id}:${exam.exam_id}`;
    void gamification.grantXp(EXAM_XP, 'exam', dedupeKey).then(() => {
      if ((exam.score ?? 0) >= EXAM_READY_THRESHOLD) {
        void gamification.awardBadge('Exam Ready');
      }
      gamification.evaluate();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam?.exam_id, exam?.score, user?.id]);

  if (isLoading || !exam) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
      </div>
    );
  }

  const weakest = exam.report?.weakest_concepts ?? [];

  const handleSendMisses = async () => {
    await sendMissesToReview();
    setSentAlready(true);
  };

  return (
    <div className="min-h-screen px-6 py-10 max-w-2xl mx-auto space-y-8">
      <div className="text-center space-y-3">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
          <CheckCircle2 className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">{t('exam:report.title')}</h1>
        <p className="text-5xl font-black text-foreground tabular-nums">{exam.score ?? 0}%</p>
        {exam.expired && (
          <p className="text-sm text-amber-500 flex items-center justify-center gap-1">
            <AlertTriangle className="w-4 h-4" /> {t('exam:report.expiredNotice')}
          </p>
        )}
      </div>

      {weakest.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {t('exam:report.weakestConcepts')}
          </h2>
          {weakest.map((w) => (
            <div key={w.concept} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-foreground">{w.concept}</p>
                <span className="text-xs text-muted-foreground">
                  {w.correct}/{w.total}
                </span>
              </div>
              {w.slides.slice(0, 1).map((s) => (
                <button
                  key={s.slide_id}
                  onClick={() => navigate(SharedRoutes.LECTURE(s.lecture_id, s.slide_number))}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  {t('exam:report.viewSlide')} <ArrowRight className="w-3 h-3" />
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Button onClick={handleSendMisses} disabled={isSendingMisses || sentAlready}>
          {isSendingMisses
            ? t('exam:report.sendingToReview')
            : sentAlready
              ? t('exam:report.alreadySent')
              : t('exam:report.sendToReview')}
        </Button>
        {sentMisses && sentAlready && (
          <p className="text-xs text-center text-muted-foreground">
            {t('exam:report.sentToReview', { count: sentMisses.cards_created + sentMisses.cards_activated })}
          </p>
        )}
        <Button variant="outline" onClick={() => navigate(StudentRoutes.HOME)}>
          {t('exam:report.backToDashboard')}
        </Button>
      </div>
    </div>
  );
}
