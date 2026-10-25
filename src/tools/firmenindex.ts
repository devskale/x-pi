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

import { spawnSync } from "node:child_process";
import type { FbPiKonfig } from "../konfig.js";

/** Konto-Token (Phase 3): env → credgoo → anonym. Anonym bleiben Details
 * teilweise 403 (suche/firma) — vertretung ist frei. */
function resolveFiToken(tokenEnv: string, tokenCommand: string[]): string | null {
  const fromEnv = process.env[tokenEnv]?.trim();
  if (fromEnv) return fromEnv;
  const r = spawnSync(tokenCommand[0] ?? "credgoo", tokenCommand.slice(1) ?? [], {
    encoding: "utf8", timeout: 10_000,
  });
  const out = (r.stdout ?? "").trim();
  return r.status === 0 && out && !out.startsWith("Service not found") ? out : null;
}

async function callFi(
  apiUrl: string,
  path: string,
  params: Record<string, string> = {},
  token: string | null = null,
  throttle?: () => void,
): Promise<unknown> {
  const url = new URL(apiUrl);
  url.searchParams.set("e", path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  throttle?.(); // Drossel-Respekt: ≥crawlDelayMs zwischen Calls eines Laufs
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    return { error: "non_json", status: res.status, body: body.slice(0, 200) };
  }
}

export function firmenindexTools(cfg: FbPiKonfig): (pi: ExtensionAPI) => void {
  const API = cfg.tools.firmenindex.apiUrl;
  return (pi: ExtensionAPI): void => {
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
        out = await callFi(API, `firmen/${params.fn}/vertretung`, { stichtag: params.stichtag }, TOKEN, throttle);
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
      "Firmensuche nach Name → FN (FREI: Endpunkt 'search', Param 'query'). " +
      "Liefert results[{fn, name, legal_form, status, seat, former_names, …}] — " +
      "former_names löst Umbenennungen auf (wichtig bei Namens-Diskrepanzen). " +
      "Bei 'verfügbar: false' NICHT raten: FN über fn_ermitteln.",
    parameters: Type.Object({
      query: Type.String({ description: "Firmenname (oder Teil)" }),
    }),
    execute: async (_id, params) => {
      emit({ t: "tool_call", name: "firmenindex_suche", params });
      let out: unknown;
      try {
        const raw = (await callFi(API, "search", { query: params.query }, TOKEN, throttle)) as Record<string, unknown>;
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
};
