import type { Metadata } from "next";
import Image from "next/image";
import {
  APP_COPYRIGHT_YEAR,
  APP_DEVELOPER,
  APP_NAME,
  APP_SLOGAN,
  APP_VERSION,
} from "../app-info";

export const metadata: Metadata = {
  title: `Impressum & Version · ${APP_NAME}`,
  description: `Impressum, Entwicklerangaben und Versionsinformationen zu ${APP_NAME}.`,
};

export default function LegalPage() {
  return (
    <main className="legal-page">
      <section className="legal-shell">
        <a className="legal-back" href="/">← Zurück zur Kasse</a>

        <header className="legal-brand">
          <Image
            src="/brand/clubiq-ledger-horizontal-transparent.svg"
            alt={`${APP_NAME} – ${APP_SLOGAN}`}
            width={700}
            height={260}
            priority
            unoptimized
          />
          <div className="legal-version">
            <span>Aktuelle Version</span>
            <strong>v{APP_VERSION}</strong>
          </div>
        </header>

        <div className="legal-grid">
          <article>
            <p className="legal-eyebrow">ÜBER DIE ANWENDUNG</p>
            <h1>{APP_NAME}</h1>
            <p className="legal-lead">{APP_SLOGAN}</p>
            <dl>
              <div><dt>Konzept & Entwicklung</dt><dd>{APP_DEVELOPER}</dd></div>
              <div><dt>Version</dt><dd>{APP_VERSION}</dd></div>
              <div><dt>Technischer Kontakt</dt><dd>über den Sportverein Barver</dd></div>
            </dl>
            <p className="legal-copyright">
              © {APP_COPYRIGHT_YEAR} {APP_NAME}. Alle Rechte vorbehalten.
            </p>
          </article>

          <article>
            <p className="legal-eyebrow">IMPRESSUM</p>
            <h2>Angaben gemäß § 5 DDG</h2>
            <address>
              <strong>Sportverein Barver von 1926 e. V.</strong><br />
              Erlenweg 33<br />
              49453 Barver<br />
              Deutschland
            </address>
            <dl>
              <div>
                <dt>Vertretung</dt>
                <dd>Vorstand gemäß § 26 BGB</dd>
              </div>
              <div>
                <dt>Kontakt</dt>
                <dd>
                  <a href="tel:+495448313">05448 313</a><br />
                  <a href="mailto:allgemein@sportverein-barver.de">
                    allgemein@sportverein-barver.de
                  </a>
                </dd>
              </div>
              <div>
                <dt>Vereinsregister</dt>
                <dd>Amtsgericht Walsrode · VR 100163</dd>
              </div>
              <div>
                <dt>Internet</dt>
                <dd>
                  <a href="https://www.sportverein-barver.de" rel="noreferrer">
                    sportverein-barver.de
                  </a>
                </dd>
              </div>
            </dl>
          </article>
        </div>

        <footer className="legal-note">
          <strong>Hinweis</strong>
          <p>
            Dieses Impressum gilt für die Webanwendung {APP_NAME}. Die
            Betreiberangaben sollten bei Änderungen im Vereinsvorstand
            entsprechend aktualisiert werden.
          </p>
        </footer>
      </section>
    </main>
  );
}
