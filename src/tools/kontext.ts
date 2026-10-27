/** Kontext-Tools (read-only) — projekt.json / audit.json meta / Sidecars.
 * Pfad-Sicherheit: keine '..'-Segmente, nur exakte Pfade unterhalb der
 * Projekt-/Bieter-Dirs. Phase 2 fügt das (einzige) Schreib-Tool hinzu. */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { emit } from "../protokoll.js";
import { safeExecute } from "../toolpacks/firmenbuch.js";

import type { FbPiKonfig } from "../konfig.js";

function safe(part: string): string | null {
  if (!part || part.includes("..") || part.includes("/") || part.includes("\\")) return null;
  return part;
}

function readJson(file: string): Record<string, unknown> | { error: string } {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    return { error: `nicht lesbar: ${path.basename(file)} (${String(err).slice(0, 80)})` };
  }
}

export function kontextTools(cfg: FbPiKonfig): (pi: ExtensionAPI) => void {
  const OFS_BASE = cfg.tools.kontext.ofsBase;
  return (pi: ExtensionAPI): void => {
  // ── Mission preis_check (26.10.): Volltext-Best-Read + deterministische Summe ──
  pi.registerTool({
    name: "dok_lesen",
    label: "Dokument-Volltext (Best-Parser)",
    description:
      "Liest den Volltext eines Dokuments (PDF: bester .md-Zwilling in md/ — " +
      "der LÄNGSTE nicht-leere, OCR-fähige Parser gewinnt; .md direkt). " +
      "Für Tabellen/Preisblätter: Positionen und Preise WÖRTLICH übernehmen. " +
      "Große Sammeldoks (>40k Zeichen): IMMER gepaged (seite_von/seite_bis; " +
      "ohne Seitenmarker: zeichen_von-Fenster à 40k) — nie als Ein-Blob.",
    parameters: Type.Object({
      project: Type.String(),
      bidder: Type.String(),
      datei: Type.String({ description: "Dateiname inkl. Endung (z.B. Preisblatt _2_.pdf)" }),
      seite_von: Type.Optional(Type.Number({ description: "Paging: erste Seite (inkl.), benötigt Seitenmarker" })),
      seite_bis: Type.Optional(Type.Number({ description: "Paging: letzte Seite (inkl.)" })),
      zeichen_von: Type.Optional(Type.Number({ description: "Paging-Fallback ohne Seitenmarker: Fenster ab Zeichen (40k-Fenster)" })),
    }),
    execute: async (_id, params) => safeExecute("dok_lesen", async () => {
      emit({ t: "tool_call", name: "dok_lesen", params });
      const p = safe(params.project);
      const b = safe(params.bidder);
      if (!p || !b) throw new Error("ungültige Namen");
      const bDir = path.join(OFS_BASE, p, "B", b);
      if (params.datei.endsWith(".md")) {
        const t = readFileSync(path.join(bDir, params.datei), "utf8");
        emit({ t: "tool_result", name: "dok_lesen", ok: true, zeichen: t.length });
        return { content: [{ type: "text", text: t.slice(0, 40000) }], details: {} };
      }
      const base = params.datei.replace(/\.[a-z0-9]+$/i, "");
      const mdDir = path.join(bDir, "md");
      let best = "";
      if (existsSync(mdDir)) {
        for (const f of readdirSync(mdDir)) {
          if (!f.startsWith(base) || !f.endsWith(".md")) continue;
          let t = "";
          try { t = readFileSync(path.join(mdDir, f), "utf8"); } catch { continue; }
          // YAML-Frontmatter strippen (Vorfall-Klasse: Parse-Stempel ist kein Inhalt)
          t = t.replace(/^---\n[\s\S]*?\n---\n/, "");
          if (t.trim().length > best.trim().length) best = t;
        }
      }
      if (!best.trim()) throw new Error("kein lesbarer .md-Zwilling für " + params.datei);
      // ── Paging (Mission sammeldok_index, 27.10.): große Sammeldoks werden
      // NIE als Ein-Blob gelesen — Seitenmarker `<!-- page N -->` schneiden
      // saubere Fenster; ohne Marker dient zeichen_von als Fallback.
      const PAGE = /<!-- page (\d+) -->/g;
      const marks: { nr: number; idx: number }[] = [];
      let m: RegExpExecArray | null;
      while ((m = PAGE.exec(best)) !== null) marks.push({ nr: Number(m[1]), idx: m.index });
      const hatMarker = marks.length > 0;
      const seitenGesamt = hatMarker ? marks[marks.length - 1].nr : 0;
      const wantsPage = params.seite_von !== undefined || params.seite_bis !== undefined;
      if (wantsPage && !hatMarker) {
        throw new Error(`keine Seitenmarker in ${params.datei} — nutze zeichen_von-Fenster (zeichen_gesamt=${best.length})`);
      }
      if (wantsPage && hatMarker) {
        const von = Math.max(1, params.seite_von ?? 1);
        const bis = Math.min(seitenGesamt, params.seite_bis ?? von);
        let text = "";
        for (let i = 0; i < marks.length; i++) {
          const { nr, idx } = marks[i];
          if (nr > bis) break;
          const end = i + 1 < marks.length ? marks[i + 1].idx : best.length;
          if (nr >= von) text += best.slice(idx, end);
        }
        if (!text.trim()) throw new Error(`Seite ${von}–${bis} nicht gefunden (seiten_gesamt=${seitenGesamt})`);
        const kopf = `📄 Seite ${von}–${bis} von ${seitenGesamt} · Zeichen ${text.length} · Gesamt ${best.length}\n\n`;
        emit({ t: "tool_result", name: "dok_lesen", ok: true, zeichen: text.length, seite: `${von}-${bis}`, seiten_gesamt: seitenGesamt });
        return { content: [{ type: "text", text: kopf + text.slice(0, 60000) }], details: { seiten_gesamt: seitenGesamt, zeichen_gesamt: best.length, hat_seitenmarker: true, seite_von: von, seite_bis: bis } };
      }
      if (params.zeichen_von !== undefined) {
        const von = Math.max(0, Math.floor(params.zeichen_von));
        const fenster = best.slice(von, von + 40000);
        const kopf = `📄 Zeichen ${von}–${von + fenster.length} von ${best.length}${hatMarker ? ` (Seitenmarker vorhanden — nutze seite_von/seite_bis)` : " (keine Seitenmarker)"}\n\n`;
        emit({ t: "tool_result", name: "dok_lesen", ok: true, zeichen: fenster.length, zeichen_von: von, hat_seitenmarker: hatMarker });
        return { content: [{ type: "text", text: kopf + fenster }], details: { zeichen_gesamt: best.length, hat_seitenmarker: hatMarker, zeichen_von: von, seiten_gesamt: seitenGesamt } };
      }
      emit({ t: "tool_result", name: "dok_lesen", ok: true, zeichen: best.length, seiten_gesamt: seitenGesamt, hat_seitenmarker: hatMarker });
      return { content: [{ type: "text", text: best.slice(0, 40000) }], details: { seiten_gesamt: seitenGesamt, zeichen_gesamt: best.length, hat_seitenmarker: hatMarker } };
    }),
  });

  pi.registerTool({
    name: "summe_berechnen",
    label: "Summe (deterministisch)",
    description:
      "Summiert Zahlen DETERMINISTISCH (Software, kein LLM). Pflicht für " +
      "Preis-Adjudizierungsdaten: der Agent extrahiert Positionspreise als " +
      "Zahlen (DE-Format 1.234,56 → 1234.56), DIESE Summe ist verbindlich.",
    parameters: Type.Object({
      zahlen: Type.Array(Type.Number()),
    }),
    execute: async (_id, params) => safeExecute("summe_berechnen", async () => {
      emit({ t: "tool_call", name: "summe_berechnen", params: { n: params.zahlen.length } });
      const summe = params.zahlen.reduce((a, x) => a + x, 0);
      const out = { summe: Math.round(summe * 100) / 100, anzahl: params.zahlen.length };
      emit({ t: "tool_result", name: "summe_berechnen", ok: true, ...out });
      return { content: [{ type: "text", text: JSON.stringify(out) }], details: {} };
    }),
  });

  pi.registerTool({
    name: "fn_ermitteln",
    label: "FN ermitteln (deterministisch)",
    description:
      "Ermittelt die Firmenbuchnummer DETERMINISTISCH aus job → audit.meta.fn → " +
      "Sidecars (Firmenbuch-Auszüge zuerst). Liefert {fn, quelle, kandidaten?} — " +
      "fn null heißt: unbelegt. NIE eine FN aus Erinnerung behaupten; nutze " +
      "IMMER dieses Tool als FN-Quelle (quelle geht 1:1 in den Bericht).",
    parameters: Type.Object({
      project: Type.String(),
      bidder: Type.String(),
    }),
    execute: async (_id, params) => {
      emit({ t: "tool_call", name: "fn_ermitteln", params });
      const p = safe(params.project);
      const b = safe(params.bidder);
      const out = p && b ? fnErmitteln(p, b, undefined, OFS_BASE) : { fn: null, quelle: "ungültige Namen" };
      emit({ t: "tool_result", name: "fn_ermitteln", ok: out.fn !== null, fn: out.fn, quelle: out.quelle });
      return { content: [{ type: "text", text: JSON.stringify(out) }], details: {} };
    },
  });

  pi.registerTool({
    name: "projekt_lesen",
    label: "Projekt lesen",
    description:
      "Liest projekt.json eines Vergabeprojekts: meta (Auftraggeber, datum = " +
      "Stichtag-Basis/Öffnungsdatum, Ausschreibungsgegenstand, Lose).",
    parameters: Type.Object({
      project: Type.String({ description: "Projekt-Name (OFS-Dir)" }),
    }),
    execute: async (_id, params) => {
      emit({ t: "tool_call", name: "projekt_lesen", params });
      const p = safe(params.project);
      const data = p ? readJson(path.join(OFS_BASE, p, "projekt.json")) : { error: "ungültiger Projektname" };
      const out = (data as any).error ? data : ((data as any).meta ?? data);
      emit({ t: "tool_result", name: "projekt_lesen", ok: !(out as any).error });
      return { content: [{ type: "text", text: JSON.stringify(out) }], details: {} };
    },
  });

  pi.registerTool({
    name: "audit_meta_lesen",
    label: "Audit-Meta lesen",
    description:
      "Liest den meta-Block aus audit.json eines Bieters: firma (persons, " +
      "legal_form), fn, vertretungsbefugnis — der BESTEHENDE Faktenstand " +
      "(Gap-Erkennung: fehlende fn/vertretungsbefugnis = Aufgabe).",
    parameters: Type.Object({
      project: Type.String(),
      bidder: Type.String({ description: "Bieter-Dir-Name unter B/" }),
    }),
    execute: async (_id, params) => {
      emit({ t: "tool_call", name: "audit_meta_lesen", params });
      const p = safe(params.project);
      const b = safe(params.bidder);
      const file = p && b ? path.join(OFS_BASE, p, "B", b, "audit.json") : null;
      const data = file && existsSync(file) ? readJson(file) : { error: "audit.json nicht gefunden" };
      const meta = (data as any).meta;
      const out = (data as any).error ? data : (meta && Object.keys(meta).length ? meta : { hinweis: "audit.json ohne belegte meta-Felder" });
      emit({ t: "tool_result", name: "audit_meta_lesen", ok: !(out as any).error });
      return { content: [{ type: "text", text: JSON.stringify(out) }], details: {} };
    },
  });

  pi.registerTool({
    name: "sidecar_lesen",
    label: "Sidecar lesen",
    description:
      "Liest die .meta.json eines Bieter-Dokuments (read-only) — z.B. den " +
      "Firmenbuchauszug als GEGENCHECK (dort steht die FN im Text-Feld). " +
      "datei = Dateiname OHNE .meta.json-Endung.",
    parameters: Type.Object({
      project: Type.String(),
      bidder: Type.String(),
      datei: Type.String({ description: "Dateiname ohne .meta.json (z.B. '2025-01-21 Firmenbuchauszug.pdf')" }),
    }),
    execute: async (_id, params) => {
      emit({ t: "tool_call", name: "sidecar_lesen", params });
      const p = safe(params.project);
      const b = safe(params.bidder);
      const d = safe(params.datei);
      const file = p && b && d ? path.join(OFS_BASE, p, "B", b, `${d}.meta.json`) : null;
      const out =
        file && existsSync(file)
          ? readJson(file)
          : { error: `Sidecar nicht gefunden: ${d ?? "?"}.meta.json` };
      emit({ t: "tool_result", name: "sidecar_lesen", ok: !(out as any).error });
      return { content: [{ type: "text", text: JSON.stringify(out) }], details: {} };
    },
  });
  };
}
