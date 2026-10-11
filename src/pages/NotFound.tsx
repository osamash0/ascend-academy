import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, RotateCw } from 'lucide-react';
import { Mark } from '@/features/landing/sections';
import { PublicRoutes } from '@/lib/routes';

/**
 * A page that is not there, on the stage like every other room.
 *
 * It was the last screen still on the old navy with "Oops!" — the first thing
 * someone with a stale link saw. Now it is a flashcard: the question on the
 * front, the answer turning over by itself a beat later, the way a card does
 * in Review. Turn it again if you like; the way out never hides behind it.
 */
const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const reduce = useReducedMotion();
  const [turned, setTurned] = useState(Boolean(reduce));

  useEffect(() => {
    console.error('404 Error: User attempted to access non-existent route:', location.pathname);
  }, [location.pathname]);

  // The card answers itself once — it is a joke that only lands if it turns.
  useEffect(() => {
    if (reduce) return;
    const id = window.setTimeout(() => setTurned(true), 1100);
    return () => window.clearTimeout(id);
  }, [reduce]);

  const face =
    'absolute inset-0 flex flex-col items-center justify-center rounded-[28px] border px-8 text-center [backface-visibility:hidden]';

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-black px-6 py-20 text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-[520px] w-screen -translate-x-1/2"
        style={{ background: 'radial-gradient(50% 65% at 50% 0%, rgba(255,255,255,0.10), transparent 72%)' }}
      />

      <Link to={PublicRoutes.LANDING} aria-label="Learnstation" className="absolute left-6 top-6 sm:left-8">
        <Mark />
      </Link>

      <button
        type="button"
        onClick={() => setTurned((v) => !v)}
        aria-label={t('notFound.turn')}
        aria-pressed={turned}
        className="group relative h-[240px] w-full max-w-[400px] rounded-[28px] outline-none [perspective:1200px] focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <motion.div
          className="relative h-full w-full [transform-style:preserve-3d]"
          initial={false}
          animate={{ rotateY: turned ? 180 : 0 }}
          transition={{ type: 'spring', stiffness: 120, damping: 16 }}
        >
          <div className={`${face} border-white/[0.10] bg-white/[0.04]`}>
            <span className="text-[12px] tabular-nums tracking-[0.2em] text-white/40">404</span>
            <span className="mt-4 text-[26px] font-medium leading-tight tracking-[-0.02em]">
              {t('notFound.question')}
            </span>
          </div>
          <div className={`${face} border-white/[0.16] bg-white/[0.07] [transform:rotateY(180deg)]`}>
            <span className="text-[12px] tracking-[0.2em] text-white/40">404</span>
            <span className="mt-4 text-[26px] font-medium leading-tight tracking-[-0.02em]">
              {t('notFound.answer')}
            </span>
          </div>
        </motion.div>
        <RotateCw
          aria-hidden
          className="absolute bottom-4 right-4 h-3.5 w-3.5 text-white/25 transition-colors group-hover:text-white/60"
        />
      </button>

      <h1 className="mt-12 text-center text-[36px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[44px]">
        {t('notFound.title')}
      </h1>
      <p className="mt-4 max-w-[46ch] text-center text-[15.5px] leading-relaxed text-white/55">
        {t('notFound.lede')}
      </p>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <Link
          to={PublicRoutes.LANDING}
          className="inline-flex h-12 items-center rounded-full bg-white px-7 text-[14px] font-semibold text-black transition-colors hover:bg-white/90"
        >
          {t('notFound.home')}
        </Link>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex h-12 items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-6 text-[14px] font-medium transition-colors hover:bg-white/[0.09]"
        >
          <ArrowLeft aria-hidden className="h-4 w-4" />
          {t('notFound.back')}
        </button>
      </div>
    </div>
  );
};

export default NotFound;
