/** Mission gf_stand — System-Prompt + Job-Schema.
 * Phase 0: Gerüst-Vertrag (echte Beschaffung + Schreiben folgen in Phase 1/2;
 * Plan docs/fb-pi-plan-2026-10-25.md §3). */

export interface GfStandJob {
  project: string;
  bidder: string;
  /** Firmenbuchnummer, wenn schon bekannt (sonst sucht der Agent). */
  fn?: string;
  /** Stichtag (ISO); default: Projektdatum — Phase 1 liest ihn via projekt_lesen. */
  stichtag?: string;
  fakt: "gf_stand";
}

export function isGfStandJob(x: unknown): x is GfStandJob {
  if (typeof x !== "object" || x === null) return false;
  const j = x as Record<string, unknown>;
  return typeof j.project === "string" && typeof j.bidder === "string" && j.fakt === "gf_stand";
}

export function gfStandSystemPrompt(): string {
  return `Du bist fb-pi, ein Firmenbuch-Fakt-Agent in einem One-shot-Job.
Mission gf_stand: ermittle die vertretungsbefugten Personen einer Bieterfirma
zum Stichtag und bereite den Fakt meta.gf_stand vor.

Arbeitsweise:
- Nutze firmenindex_suche, um die Firmenbuchnummer (FN) zu finden (wenn nicht
  schon im Job gegeben), und melde Zwischenstände über status_melden.
- Antworte am Ende AUSSCHLIESSLICH als JSON-Objekt mit den Feldern:
  {"fn": string, "stichtag": "YYYY-MM-DD", "vertretungsbefugte":
   [{"name": string, "funktion": string, "seit": string|null, "bis": string|null,
     "befugnis": string}], "unsicherheiten": string[]}
- Kein Schreiben in dieser Phase — du lieferst den Bericht, der Wrapper entscheidet.

PHASE 0 (Gerüst-Test): Die Tools sind FAKES — aber du musst sie WIRKLICH
AUFRUFEN (nicht nur beschreiben): ERST ein status_melden-Aufruf mit Text
"Phase-0-Selbsttest gestartet", DANN ein firmenindex_suche-Aufruf mit dem
Bieternamen aus dem Job. Erst danach das Abschluss-JSON aus dem Tool-Ergebnis.
Der Test beweist die Session und die Tool-Bindung — narrieren genügt nicht.`;
}

export function gfStandUserPrompt(job: GfStandJob): string {
  const parts = [
    `Job: Mission gf_stand für Bieter ${JSON.stringify(job.bidder)} in Projekt ${JSON.stringify(job.project)}.`,
    job.fn ? `FN bekannt: ${job.fn}.` : "FN unbekannt — über firmenindex_suche ermitteln.",
    job.stichtag ? `Stichtag: ${job.stichtag}.` : "Stichtag: aus Projektkontext (Phase 1: projekt_lesen).",
    "Beginne jetzt.",
  ];
  return parts.join(" ");
}
