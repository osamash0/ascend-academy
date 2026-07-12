import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Award, BrainCircuit, CheckCircle2, ChevronRight, Share2, Target, XCircle } from 'lucide-react';
import { useExamAttempt, useSendMissesToReview } from '@/features/student/hooks/useExamMode';
import { DepthScene } from '@/components/console';

export function MockExamReport() {
  const { t } = useTranslation('exam');
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const { data: exam, isLoading } = useExamAttempt(examId);
  const sendMisses = useSendMissesToReview(examId || '');

  const [sentToReview, setSentToReview] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!exam || !exam.report) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        {t('report.notAvailable')}
      </div>
    );
  }

  const { score, correct_count, total, weakest_concepts, missed_question_ids } = exam.report;
  const isPassed = score >= 80;

  const handleSendToReview = async () => {
    try {
      await sendMisses.mutateAsync();
      setSentToReview(true);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <DepthScene status="progress" gradientIndex={2}>
      <div className="min-h-screen pb-20 relative z-10">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 pt-12">
        
        {/* Top Action Bar */}
        <div className="mb-8 flex items-center">
          <button
            onClick={() => navigate(`/course/${exam.course_id}`)}
            className="text-sm font-bold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors flex items-center gap-2"
          >
            {t('report.backToCourse')}
          </button>
        </div>

        {/* Hero Section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card relative overflow-hidden rounded-[32px] border border-white/10 p-10 text-center mb-10"
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/20 rounded-full blur-[100px] pointer-events-none" />
          
          <div className="relative z-10 flex flex-col items-center">
            <div className="relative w-32 h-32 mb-6">
              <svg className="w-full h-full transform -rotate-90">
                <circle cx="64" cy="64" r="60" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-white/5" />
                <circle 
                  cx="64" cy="64" r="60" 
                  stroke="currentColor" strokeWidth="8" fill="transparent" 
                  strokeDasharray={377} 
                  strokeDashoffset={377 - (377 * score) / 100}
                  className={`transition-all duration-1000 ease-out ${isPassed ? 'text-success drop-shadow-glow-success' : 'text-primary drop-shadow-glow-primary'}`} 
                  strokeLinecap="round" 
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center flex-col">
                <span className="text-3xl font-black text-foreground leading-none">{score}%</span>
              </div>
            </div>

            <h1 className="text-4xl font-black tracking-tight text-foreground mb-4">
              {isPassed ? t('report.passedHeading') : t('report.completedHeading')}
            </h1>
            <p className="text-muted-foreground text-lg max-w-lg mb-8 leading-relaxed">
              {t('report.scoreSummary', { correct: correct_count, total })}
              {' '}
              {isPassed ? t('report.passedNote') : t('report.notPassedNote')}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-4">
              {missed_question_ids.length > 0 && (
                <button
                  onClick={handleSendToReview}
                  disabled={sendMisses.isPending || sentToReview}
                  className="rounded-2xl bg-gradient-to-r from-primary to-secondary px-6 py-3 text-sm font-black uppercase tracking-widest text-white transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100 flex items-center gap-2 shadow-glow-primary/20"
                >
                  <Share2 className="w-4 h-4" />
                  {sentToReview ? t('report.alreadySent') : t('report.sendToReview')}
                </button>
              )}
            </div>
          </div>
        </motion.div>

        {/* Weak Concepts Analysis */}
        {weakest_concepts && weakest_concepts.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-10"
          >
            <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center text-warning">
                <Target className="w-4 h-4" />
              </div>
              {t('report.weakestConcepts')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {weakest_concepts.map((wc: any, i: number) => (
                <div key={i} className="glass-card p-5 rounded-2xl border border-white/5 bg-white/[0.02]">
                  <h3 className="font-bold text-foreground mb-1 line-clamp-1">{wc.concept}</h3>
                  <div className="text-xs font-bold uppercase tracking-widest text-warning mb-4">
                    {t('report.missRate', { rate: wc.miss_rate * 100 })}
                  </div>
                  <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-warning h-full rounded-full"
                      style={{ width: `${wc.miss_rate * 100}%` }}
                    />
                  </div>
                  <div className="mt-4 text-xs text-muted-foreground flex justify-between">
                    <span>{t('report.missedOf', { missed: wc.total - wc.correct })}</span>
                    <span>{t('report.totalOf', { total: wc.total })}</span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Detailed Review */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <BrainCircuit className="w-4 h-4" />
            </div>
            {t('report.questionReview')}
          </h2>
          <div className="space-y-4">
            {exam.questions?.map((q, i) => {
              const isMissed = missed_question_ids.includes(q.id);
              const selectedIdx = exam.answers[q.id];

              return (
                <div key={q.id} className={`glass-card p-6 rounded-2xl border ${isMissed ? 'border-rose-500/20 bg-rose-500/5' : 'border-success/20 bg-success/5'}`}>
                  <div className="flex items-start gap-4">
                    <div className="mt-1 shrink-0">
                      {isMissed ? (
                        <XCircle className="w-6 h-6 text-rose-500" />
                      ) : (
                        <CheckCircle2 className="w-6 h-6 text-success" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-2">{t('report.questionNumber', { n: i + 1 })}</p>
                      <h4 className="text-lg text-foreground leading-relaxed mb-4">{q.question_text}</h4>
                      
                      <div className="space-y-2">
                        {q.options.map((opt, optIdx) => {
                          const isSelected = selectedIdx === optIdx;
                          // If missed, highlight what they selected in red. 
                          // The backend doesn't tell us the correct answer to prevent cheating.
                          const style = isSelected 
                            ? (isMissed ? 'bg-rose-500/20 border-rose-500/50 text-rose-200' : 'bg-success/20 border-success/50 text-success-foreground')
                            : 'bg-white/5 border-white/5 text-muted-foreground opacity-50';

                          return (
                            <div key={optIdx} className={`px-4 py-3 rounded-xl border text-sm flex items-center gap-3 ${style}`}>
                              <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${isSelected ? (isMissed ? 'border-rose-400' : 'border-success') : 'border-white/20'}`}>
                                {isSelected && <div className={`w-2 h-2 rounded-full ${isMissed ? 'bg-rose-400' : 'bg-success'}`} />}
                              </div>
                              {opt}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>

      </div>
      </div>
    </DepthScene>
  );
}
