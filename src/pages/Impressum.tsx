import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { LanguageToggle } from '@/components/LanguageToggle';

export default function Impressum() {
    const { t } = useTranslation('legal');

    return (
        <div className="min-h-screen bg-background">
            <header className="border-b border-border bg-background/80 backdrop-blur-sm">
                <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-3">
                    <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                        <div className="w-10 h-10 gradient-primary rounded-xl flex items-center justify-center">
                            <GraduationCap className="w-6 h-6 text-primary-foreground" />
                        </div>
                        <span className="font-bold text-xl text-foreground">Learnstation</span>
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
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-2">{t('imprint.contact')}</h2>
                        <p>
                            {t('imprint.email')}: <a href="mailto:kontakt@learnstation.de" className="text-primary hover:underline">kontakt@learnstation.de</a>
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
