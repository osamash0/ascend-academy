import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';

export default function Impressum() {
    return (
        <div className="min-h-screen bg-background">
            {/* Header */}
            <header className="border-b border-border bg-background/80 backdrop-blur-sm">
                <div className="container mx-auto px-4 py-4 flex items-center gap-3">
                    <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                        <div className="w-10 h-10 gradient-primary rounded-xl flex items-center justify-center">
                            <GraduationCap className="w-6 h-6 text-primary-foreground" />
                        </div>
                        <span className="font-bold text-xl text-foreground">Learnstation</span>
                    </Link>
                </div>
            </header>

            <main className="container mx-auto px-4 py-12 max-w-3xl">
                <h1 className="text-3xl font-bold text-foreground mb-8">Impressum</h1>

                <div className="prose prose-neutral dark:prose-invert space-y-6 text-muted-foreground">
                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-2">Angaben gemäß § 5 TMG</h2>
                        <p>
                            [Vor- und Nachname / Firmenname]<br />
                            [Straße und Hausnummer]<br />
                            [PLZ und Ort]<br />
                            Deutschland
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-2">Kontakt</h2>
                        <p>
                            E-Mail: <a href="mailto:kontakt@learnstation.de" className="text-primary hover:underline">kontakt@learnstation.de</a>
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-2">Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV</h2>
                        <p>
                            [Vor- und Nachname]<br />
                            [Straße und Hausnummer]<br />
                            [PLZ und Ort]
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-2">Haftungsausschluss</h2>
                        <h3 className="text-lg font-medium text-foreground mb-1">Haftung für Inhalte</h3>
                        <p>
                            Die Inhalte unserer Seiten wurden mit größter Sorgfalt erstellt. Für die Richtigkeit,
                            Vollständigkeit und Aktualität der Inhalte können wir jedoch keine Gewähr übernehmen.
                        </p>
                    </section>

                    <div className="pt-8 border-t border-border">
                        <Link to="/" className="text-primary hover:underline text-sm">
                            ← Zurück zur Startseite
                        </Link>
                    </div>
                </div>
            </main>
        </div>
    );
}
