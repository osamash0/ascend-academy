import { Link } from 'react-router-dom';
import { Mark } from '@/features/landing/sections';
import { Trans, useTranslation } from 'react-i18next';
import { LanguageToggle } from '@/components/LanguageToggle';

export default function Impressum() {
    const { t } = useTranslation('legal');

    return (
        <div className="min-h-screen bg-black">
            <header className="border-b border-white/[0.06] bg-black/80 backdrop-blur-sm">
                <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-3">
                    <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                        <Mark />
                        <span className="text-[15px] font-semibold text-foreground">Learnstation</span>
                    </Link>
                    <LanguageToggle />
                </div>
            </header>

            <main className="container mx-auto px-4 py-12 max-w-3xl">
                <h1 className="text-3xl font-bold text-foreground mb-8">{t('imprint.title')}</h1>

                <div className="prose prose-neutral dark:prose-invert space-y-6 text-muted-foreground">
                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-2">{t('imprint.section5')}</h2>
                        <p className="whitespace-pre-line">{t('imprint.addressLines')}</p>
                        <p className="mt-2">{t('imprint.project')}</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-2">{t('imprint.contact')}</h2>
                        <p>
                            {t('imprint.email')}: <a href="mailto:hello@learnstation.app" className="text-primary hover:underline">hello@learnstation.app</a>
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-2">{t('imprint.responsible')}</h2>
                        <p className="whitespace-pre-line">{t('imprint.responsibleAddress')}</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-2">{t('imprint.disclaimer')}</h2>
                        <h3 className="text-lg font-medium text-foreground mb-1">{t('imprint.liability')}</h3>
                        <p>{t('imprint.liabilityBody')}</p>
                    </section>

                    <div className="pt-8 border-t border-border">
                        <Link to="/" className="text-primary hover:underline text-sm">
                            <Trans i18nKey="imprint.backHome" t={t} />
                        </Link>
                    </div>
                </div>
            </main>
        </div>
    );
}
