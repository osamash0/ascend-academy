import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';

export default function Datenschutz() {
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
                <h1 className="text-3xl font-bold text-foreground mb-2">Datenschutzerklärung</h1>
                <p className="text-muted-foreground mb-8">Stand: März 2026</p>

                <div className="space-y-8 text-muted-foreground leading-relaxed">
                    {/* 1 */}
                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-3">1. Verantwortlicher</h2>
                        <p>
                            [Vor- und Nachname]<br />
                            [Straße und Hausnummer]<br />
                            [PLZ und Ort]<br />
                            E-Mail: <a href="mailto:kontakt@learnstation.de" className="text-primary hover:underline">kontakt@learnstation.de</a>
                        </p>
                    </section>

                    {/* 2 */}
                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-3">2. Welche Daten wir erheben</h2>
                        <p className="mb-3">Wenn Sie Learnstation nutzen, verarbeiten wir folgende personenbezogene Daten:</p>
                        <ul className="list-disc pl-6 space-y-1">
                            <li><strong className="text-foreground">Kontodaten:</strong> E-Mail-Adresse, Passwort (verschlüsselt gespeichert), vollständiger Name (optional), Avatar-URL.</li>
                            <li><strong className="text-foreground">Lernfortschritt:</strong> Abgeschlossene Folien, Quizergebnisse, XP-Punkte, Level, Streaks und Auszeichnungen.</li>
                            <li><strong className="text-foreground">Lern-Events:</strong> Betrachtungsdauer von Folien, Quizantworten mit Zeitstempel und Selbsteinschätzung des Verständnisses.</li>
                            <li><strong className="text-foreground">Nutzungsdaten:</strong> Browser-Typ (nur über Supabase-Standard-Logs).</li>
                        </ul>
                    </section>

                    {/* 3 */}
                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-3">3. Zweck und Rechtsgrundlage</h2>
                        <ul className="list-disc pl-6 space-y-2">
                            <li><strong className="text-foreground">Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO):</strong> Kontodaten und Lernfortschritt sind erforderlich, um die Kernfunktionalität der Plattform bereitzustellen.</li>
                            <li><strong className="text-foreground">Berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO):</strong> Lern-Events werden zur Verbesserung der Lehre und Identifizierung schwieriger Inhalte durch Dozenten erhoben.</li>
                        </ul>
                    </section>

                    {/* 4 */}
                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-3">4. Auftragsverarbeiter</h2>
                        <ul className="list-disc pl-6 space-y-1">
                            <li><strong className="text-foreground">Supabase Inc.</strong> — Authentifizierung, Datenbank und Dateispeicherung. Datenspeicherung auf Servern in der EU (je nach Projektkonfiguration).</li>
                            <li><strong className="text-foreground">Ollama (lokal)</strong> — KI-gestützte Zusammenfassungen und Quizfragen werden lokal auf dem Server verarbeitet. Es werden keine Daten an externe KI-Dienste gesendet.</li>
                        </ul>
                    </section>

                    {/* 5 */}
                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-3">5. Speicherdauer</h2>
                        <p>
                            Ihre Daten werden so lange gespeichert, wie Ihr Konto aktiv ist. Nach Löschung des Kontos
                            werden alle personenbezogenen Daten innerhalb von 30 Tagen gelöscht.
                        </p>
                    </section>

                    {/* 6 */}
                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-3">6. Ihre Rechte</h2>
                        <p className="mb-3">Nach der DSGVO haben Sie folgende Rechte:</p>
                        <ul className="list-disc pl-6 space-y-1">
                            <li><strong className="text-foreground">Auskunftsrecht (Art. 15):</strong> Sie können erfahren, welche Daten wir über Sie gespeichert haben.</li>
                            <li><strong className="text-foreground">Recht auf Löschung (Art. 17):</strong> Sie können Ihr Konto und alle zugehörigen Daten in den Einstellungen löschen.</li>
                            <li><strong className="text-foreground">Recht auf Datenübertragbarkeit (Art. 20):</strong> Sie können Ihre Daten als JSON-Datei in den Einstellungen exportieren.</li>
                            <li><strong className="text-foreground">Widerspruchsrecht (Art. 21):</strong> Sie können der Verarbeitung Ihrer Daten jederzeit widersprechen.</li>
                            <li><strong className="text-foreground">Beschwerderecht:</strong> Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren.</li>
                        </ul>
                    </section>

                    {/* 7 */}
                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-3">7. Cookies und lokale Speicherung</h2>
                        <p>
                            Learnstation verwendet <strong className="text-foreground">keine Tracking-Cookies</strong> und
                            keine Drittanbieter-Analyse-Tools (kein Google Analytics, kein Facebook Pixel). Zur
                            Sitzungsverwaltung wird ausschließlich der lokale Speicher des Browsers (localStorage)
                            verwendet.
                        </p>
                    </section>

                    {/* 8 */}
                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-3">8. Drittlandübermittlung</h2>
                        <p>
                            Supabase kann Daten auf Servern in den USA verarbeiten. In diesem Fall gelten die
                            EU-Standardvertragsklauseln (SCCs) als Schutzgarantie gemäß Art. 46 DSGVO.
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
