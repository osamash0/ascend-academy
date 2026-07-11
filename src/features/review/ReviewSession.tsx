import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Loader2, PartyPopper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/lib/auth';
import { useGamification } from '@/lib/gamification/GamificationProvider';
import { getStats } from '@/services/reviewService';
import { StudentRoutes } from '@/lib/routes';
import { useReviewQueue } from './useReviewQueue';

const RATING_KEYS: Record<string, number> = { '1': 1, '2': 2, '3': 3, '4': 4 };
const RATING_I18N_KEY: Record<number, string> = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ReviewSession() {
  const navigate = useNavigate();
  const { t } = useTranslation(['review']);
  const { user } = useAuth();
  const gamification = useGamification();
  const { cards, totalDue, isLoading, grade, isGrading } = useReviewQueue();

  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [gradedCount, setGradedCount] = useState(0);
  const shownAt = useRef<number>(Date.now());
  const checkedStreakThisSession = useRef(false);
  const awardedCenturion = useRef(false);

  const current = cards[index];
  const isDone = !isLoading && cards.length > 0 && index >= cards.length;

  useEffect(() => {
    shownAt.current = Date.now();
    setFlipped(false);
  }, [index]);

  const handleGrade = async (rating: number) => {
    if (!current || isGrading) return;
    const elapsedMs = Date.now() - shownAt.current;
    await grade({ cardId: current.card_id, rating, elapsedMs });

    if (user) {
      const dedupeKey = `review:${user.id}:${current.card_id}:${todayKey()}`;
      await gamification.grantXp(5, 'review', dedupeKey);
    }

    const nextCount = gradedCount + 1;
    setGradedCount(nextCount);

    if (!checkedStreakThisSession.current) {
      checkedStreakThisSession.current = true;
      try {
        const stats = await getStats();
        if (stats.streak === 7) await gamification.awardBadge('review-streak-7');
        else if (stats.streak === 30) await gamification.awardBadge('review-streak-30');
      } catch {
        // best-effort — a missed streak badge check isn't worth failing the session for
      }
    }
    if (nextCount === 100 && !awardedCenturion.current) {
      awardedCenturion.current = true;
      await gamification.awardBadge('centurion');
    }
    gamification.evaluate();

    setIndex((i) => i + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current) return;
      if (e.code === 'Space' && !flipped) {
        e.preventDefault();
        setFlipped(true);
        return;
      }
      if (flipped && RATING_KEYS[e.key]) {
        void handleGrade(RATING_KEYS[e.key]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, flipped, gradedCount]);

  const progressPct = useMemo(
    () => (cards.length > 0 ? Math.round((index / cards.length) * 100) : 0),
    [index, cards.length],
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> {t('review:session.loading')}
      </div>
    );
  }

  if (cards.length === 0 || isDone) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-6 shadow-lg">
          {isDone ? <PartyPopper className="w-8 h-8 text-white" /> : <CheckCircle2 className="w-8 h-8 text-white" />}
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2">
          {isDone ? t('review:session.doneTitle', { count: gradedCount }) : t('review:session.caughtUpTitle')}
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          {isDone ? t('review:session.doneSubtitle') : t('review:session.caughtUpSubtitle')}
        </p>
        <Button onClick={() => navigate(StudentRoutes.HOME)}>{t('review:session.backToDashboard')}</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="px-6 py-4">
        <Progress value={progressPct} className="h-1.5" />
        <p className="text-xs text-muted-foreground mt-2">
          {t('review:session.progress', { current: index + 1, total: cards.length || totalDue })}
        </p>
      </div>

      <div className="flex-1 flex items-center justify-center px-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={current.card_id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 shadow-lg cursor-pointer"
            onClick={() => !flipped && setFlipped(true)}
            data-testid="review-card"
          >
            {!flipped ? (
              <div className="text-center">
                <p className="text-lg font-semibold text-foreground">
                  {current.front.question ?? current.front.text}
                </p>
                {current.front.options && (
                  <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                    {current.front.options.map((opt, i) => (
                      <li key={i}>{opt}</li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground mt-6">{t('review:session.revealHint')}</p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-2">{t('review:session.answerLabel')}</p>
                <p className="text-lg font-semibold text-foreground">
                  {current.back.correct_answer ?? current.back.text}
                </p>
                {current.back.explanation && (
                  <p className="text-sm text-muted-foreground mt-3">{current.back.explanation}</p>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="px-6 pb-8">
        {flipped ? (
          <div className="grid grid-cols-4 gap-2 max-w-lg mx-auto">
            {([1, 2, 3, 4] as const).map((rating) => (
              <Button
                key={rating}
                variant={rating === 1 ? 'destructive' : 'outline'}
                disabled={isGrading}
                onClick={() => void handleGrade(rating)}
                data-testid={`grade-${rating}`}
              >
                {t(`review:rating.${RATING_I18N_KEY[rating]}`)}
                <span className="ml-1 text-[10px] opacity-60">({rating})</span>
              </Button>
            ))}
          </div>
        ) : (
          <div className="max-w-lg mx-auto text-center">
            <Button onClick={() => setFlipped(true)} className="w-full">
              {t('review:session.showAnswer')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
