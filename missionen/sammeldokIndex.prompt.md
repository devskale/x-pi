# Mission sammeldok_index — Sammeldok-Index

Du zerlegst EIN Sammeldokument (LgU, GesamtPDF-Konvolut, Unternehmensprofil)
in einen strukturierten Index: **JEDES eigenständige Teildokument** wird mit
Typ, Aspekt, Aussteller, Ausstellungsdatum, Seitenbereich und WÖRTLICHEM
Zitat erfasst. Die Import-/Übersichtstabelle (falls vorhanden) wird als
eigene Claims vom Typ `import_tabelle` aufgenommen.

## Warum diese Mission existiert

Sammeldoks sind die Wahrheitsquelle der Nachweisprüfung — aber nur indexiert
lesbar. Die Tabelle im Dok ist **nur ein Teil der Wahrheit** (User-Regel
2026-10-27): die eigentlichen Teildokumente im Anhang können vollständiger
oder frischer sein als der Tabellen-Import. BEIDE Quellen erfasst du; die
Abwägung macht der Audit später.

## Ablauf

1. **Orientierung**: `dok_lesen` (ohne Paging) → du bekommst `seiten_gesamt`,
   `zeichen_gesamt`, `hat_seitenmarker` in den Details. Danach:
   - Mit Seitenmarker: seitenweise lesen (`seite_von`/`seite_bis`, z.B. 1–10,
     dann 11–20 …) bis du das Dokument KOMPLETT überflogen hast.
   - Ohne Seitenmarker: `zeichen_von`-Fenster à 40 000 Zeichen, bis zum Ende.
   - Lese jede Seite GENAU EINMAL — nicht springen, nichts auslassen.
2. **Index bauen** — für jedes Teildokument ein Eintrag:
   - `titel`: wie im Dokument geschrieben (Kopfzeile/Überschrift)
   - `claim_typ`: `"teildok"` (das Dokument selbst) oder `"import_tabelle"`
     (Zeile der Import-/Übersichtstabelle, z.B. `Kommunalsteuer | 28.10.2023 | 0,00`)
   - `aspekt` — GENAU EINER aus:
     `steuern_und_abgaben` (§229a, Finanzamt, Abgabenrückstand) ·
     `kommunalsteuer` (MA 6, Gemeinde, Stadt, KommSt) ·
     `sozialversicherung` (ÖGK, SV-Träger) ·
     `strafregister` (SRB) · `verwaltungsstrafe` (LSD-BG, Strafevidenz) ·
     `insolvenz` · `firmenbuch` · `gewerbe` · `versicherung` ·
     `kreditrating` · `sonstiges`
     Attribution NUR nach EVIDENZ im Teildokument (Aussteller/Inhalt) —
     bei Unsicherheit: `sonstiges` + Eintrag in `unsicherheiten`.
   - `aussteller`: behördliche Stelle, WIE GESCHRIEBEN (z.B. "Magistratsabteilung 6")
   - `datum_iso`: AUSSTELLUNGSDATUM im Format YYYY-MM-DD. NIE „gültig bis …".
     Bei import_tabelle: das Importdatum der Tabellenzeile. Kein Datum: `null`.
   - `rueckstand`: Betrag als Text (z.B. `"0,00"`), NUR wenn ausdrücklich genannt; sonst `""`.
   - `seite_von` / `seite_bis`: Seitenbereich laut Seitenmarkern
     (ohne Marker: 1/1)
   - `zitat`: 8–300 Zeichen WÖRTLICH aus dem Dokument, eindeutig dem
     Teildokument zuordenbar (idealerweise Kopfzeile + Datum-Zeile).
     **Der Server prüft jedes Zitat gegen den Volltext** — ein nicht
     vorkommendes Zitat weist den GESAMTEN Schreibvorgang ab (422).
3. **Regeln**
   - KEIN Teildokument erfinden — jeder Eintrag braucht sein Zitat im Dok.
   - Datei-VERWEISE im Inhaltsverzeichnis („… vom 15.02.2023.pdf") sind KEINE
     Teildokumente — nur die Tabelle selbst als `import_tabelle`-Claims.
   - Eine URKUNDE/Bescheinigung, die NICHT eindeutig zu einem Aspekt passt
     (z.B. Vorsteuerrückzahlung), bekommt `sonstiges` — nie raten.
   - Mehrere Teildokumente gleichen Typs (z.B. drei Unbedenklichkeits-
     bescheinigungen): ALLE erfassen, jede mit eigenem Zitat.
4. **Schreiben**: `audit_meta_schreiben` mit `fakt: "sammeldok_index"` und
   payload `{dokument, seiten_gesamt, teildokumente: [...], quelle, unsicherheiten}`.
   `quelle` = z.B. "sammeldok_index: <Dateiname>, seitenweise gelesen".
   Prüfe den Read-back im Tool-Ergebnis.
5. **Abschluss**: Deine LETZTE Nachricht ist GENAU EIN ```json-Block mit
   ALLEN Pflichtfeldern: `{dokument, seiten_gesamt, teildokumente, quelle,
   unsicherheiten}` — kein Prosa davor/danach, keine Teilblöcke.

## Fail-safe

Kannst du das Dokument nicht (vollständig) lesen, schreibe NICHTS —
berichte das Problem im Abschluss-JSON (`unsicherheiten`). Ein unvollständiger
Index ist schlechter als keiner.
