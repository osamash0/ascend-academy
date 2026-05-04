import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguagePreference } from '@/hooks/useLanguagePreference';
import type { SupportedLanguage } from '@/i18n';

type Variant = 'pill' | 'icon-dark' | 'icon-light';

interface LanguageToggleProps {
  variant?: Variant;
  className?: string;
  align?: 'start' | 'end';
}

/**
 * Compact EN/DE toggle. The active language is shared globally via i18next +
 * useLanguagePreference, so all instances stay in sync automatically.
 */
export function LanguageToggle({ variant = 'pill', className, align = 'end' }: LanguageToggleProps) {
  const { t, i18n } = useTranslation('common');
  const { setLanguage } = useLanguagePreference();

  const current: SupportedLanguage = (i18n.language?.split('-')[0] as SupportedLanguage) === 'de' ? 'de' : 'en';

  const handleChange = (lng: SupportedLanguage) => {
    if (lng === current) return;
    setLanguage(lng);
  };

  if (variant === 'icon-dark' || variant === 'icon-light') {
    const iconColor = variant === 'icon-dark' ? 'text-slate-300 hover:text-white' : 'text-muted-foreground hover:text-foreground';
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-1.5 py-1 text-xs font-semibold',
          variant === 'icon-dark' ? 'border-white/10 bg-white/5' : 'border-border bg-card/60',
          className,
        )}
        role="group"
        aria-label={t('language')}
      >
        <Globe className={cn('w-3.5 h-3.5 mx-1', iconColor)} aria-hidden="true" />
        {(['en', 'de'] as const).map((lng) => (
          <button
            key={lng}
            type="button"
            onClick={() => handleChange(lng)}
            aria-pressed={current === lng}
            className={cn(
              'px-2 py-0.5 rounded-full uppercase tracking-wider transition-colors',
              current === lng
                ? variant === 'icon-dark'
                  ? 'bg-cyan-500 text-white'
                  : 'bg-primary text-primary-foreground'
                : iconColor,
            )}
          >
            {lng}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-border bg-muted/50 p-0.5',
        align === 'start' ? 'self-start' : 'self-end',
        className,
      )}
      role="group"
      aria-label={t('language')}
    >
      {(['en', 'de'] as const).map((lng) => (
        <button
          key={lng}
          type="button"
          onClick={() => handleChange(lng)}
          aria-pressed={current === lng}
          className={cn(
            'px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest rounded-full transition-all',
            current === lng
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {lng}
        </button>
      ))}
    </div>
  );
}
