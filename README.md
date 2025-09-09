# Grenztrip‑Entscheider (AI‑first MVP)

**Ziel:** In ≤10 s eine klare Aussage *„Lohnt sich / Knapp / Lohnt nicht“* inkl. **nächster bester Aktion**.  
**Robustheit:** Erweiterter Fehlercode‑Assistent (EFA) sorgt für saubere Fallbacks, klare Meldungen und nachvollziehbare Regeln.

## Installation
1. ZIP entpacken.
2. `index.html` im Browser öffnen (läuft komplett offline).

> Optional: Regeln in `rules/customs_rules.json` anpassen. Bei Ladefehlern nutzt die App die **eingebetteten Defaults** und zeigt dies an.

## Dateien
- `index.html` – UI
- `styles.css` – Stil
- `app.js` – Logik, Optimierung, EFA
- `rules/customs_rules.json` – Regelwerk (Richtmengen, Reservekanister, IDs)

## Bedienung
1. Distanz, Personen, Fahrzeug, Preise/Mengen eintragen.
2. **Berechnen** klicken.
3. Ampel + Netto‑€ + €/h lesen.
4. **Nächste beste Aktion** mit 1‑Klick übernehmen.
5. **Zoll‑Status** (Rule‑IDs) prüfen. **Robustheit** via Kurz‑Simulation (±10 % Preise, P80).

## Fehlercode‑Assistent (EFA)
- Einheitliche Fehlerhülle (Code, Schweregrad, Details, Handlungsvorschläge).
- Status‑Chips: **Daten**, **Regeln**, **KI**, **Rechnen**.
- Fallbacks:
  - Regeln nicht ladbar → **eingebettete Defaults** (Version sichtbar).
  - KI nicht verfügbar → **Template‑Erklärung** (deterministisch).
  - Ungültige Eingaben → präzise Feldhinweise, App bleibt nutzbar.

## Grenzen (MVP)
- Regeln im JSON, YAML folgt später.
- Routen/Entfernungen werden manuell eingegeben (keine Maps‑API).
- KI ist lokal (Text‑Templates), später an echtes LLM koppelbar.
