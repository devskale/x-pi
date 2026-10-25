/** Kontext-Tools (read-only) — projekt.json / audit.json meta / Sidecars.
 * Pfad-Sicherheit: keine '..'-Segmente, nur exakte Pfade unterhalb der
 * Projekt-/Bieter-Dirs. Phase 2 fügt das (einzige) Schreib-Tool hinzu. */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { emit } from "../protokoll.js";

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
