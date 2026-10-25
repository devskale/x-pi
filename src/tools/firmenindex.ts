/** firmenindex-Tools — echte Calls gegen skale.dev/firmenindex (Phase 1).
 *
 * API-Form (live verifiziert 2026-10-25):
 *   GET {api}?e=firmen/{fn}/vertretung[&stichtag=YYYY-MM-DD]
 *   → {fn, stichtag, firma, modus, vertretungsbefugte[{name, funktion, seit,
 *      bis?, befugnis{typ, typ_text}}], vertretungsregel, hinweis}
 * Such-Endpunkte sind Token-gegate­d (Phase 3: credgoo-Konto) — das Tool
 * existiert schon, meldet aber laut, wenn der Call 403 ist (Agent fällt auf
 * FN-aus-Kontext zurück, statt still zu raten). */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { emit } from "../protokoll.js";

export const FIRMENINDEX_API =
  process.env.FIRMENINDEX_API ?? "https://skale.dev/firmenindex/api";

async function callFi(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(FIRMENINDEX_API);
  url.searchParams.set("e", path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    return { error: "non_json", status: res.status, body: body.slice(0, 200) };
  }
}

export function firmenindexTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "firmenindex_vertretung",
    label: "Firmenindex Vertretung",
    description:
      "Vertretungsbefugte Personen einer Firma laut Firmenindex zum Stichtag. " +
      "fn = Firmenbuchnummer (z.B. '195777h'). stichtag = 'YYYY-MM-DD' (Pflicht; " +
      "i.d.R. das Projektdatum/Öffnungsdatum). Liefert {fn, stichtag, firma, " +
      "vertretungsbefugte[{name, funktion, seit, bis, befugnis}], vertretungsregel}.",
    parameters: Type.Object({
      fn: Type.String({ description: "Firmenbuchnummer, z.B. 195777h" }),
      stichtag: Type.String({ description: "Stichtag YYYY-MM-DD" }),
    }),
    execute: async (_id, params) => {
      emit({ t: "tool_call", name: "firmenindex_vertretung", params });
      let out: unknown;
      try {
        out = await callFi(`firmen/${params.fn}/vertretung`, { stichtag: params.stichtag });
        emit({ t: "tool_result", name: "firmenindex_vertretung", ok: !((out as any)?.error) });
      } catch (err) {
        out = { error: String(err).slice(0, 200) };
        emit({ t: "tool_result", name: "firmenindex_vertretung", ok: false });
      }
      return { content: [{ type: "text", text: JSON.stringify(out) }], details: {} };
    },
  });

  pi.registerTool({
    name: "firmenindex_suche",
    label: "Firmenindex-Suche",
    description:
      "Firmensuche nach Name → FN. HINWEIS: aktuell Token-gegate­d (Phase 3) — " +
      "bei 'verfügbar: false' NICHT raten: FN stattdessen aus dem Kontext " +
      "ermitteln (audit_meta_lesen, sidecar_lesen eines Firmenbuch-Dokuments).",
    parameters: Type.Object({
      query: Type.String({ description: "Firmenname (oder Teil)" }),
    }),
    execute: async (_id, params) => {
      emit({ t: "tool_call", name: "firmenindex_suche", params });
      let out: unknown;
      try {
        const raw = (await callFi("suche", { q: params.query })) as Record<string, unknown>;
        if (raw?.error === "Forbidden") {
          out = { verfügbar: false, grund: "suche Token-gegate­d (Konto: Phase 3) — FN aus Kontext ermitteln" };
        } else {
          out = raw;
        }
      } catch (err) {
        out = { verfügbar: false, grund: String(err).slice(0, 150) };
      }
      emit({ t: "tool_result", name: "firmenindex_suche", ok: true });
      return { content: [{ type: "text", text: JSON.stringify(out) }], details: {} };
    },
  });
}
