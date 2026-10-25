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
  const TOKEN = resolveFiToken(cfg.tools.firmenindex.tokenEnv, cfg.tools.firmenindex.tokenCommand);
  const delayMs = cfg.tools.firmenindex.crawlDelayMs ?? 5000;
  let lastCall = 0;
  const throttle = (): void => {
    const wait = delayMs - (Date.now() - lastCall);
    if (wait > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    lastCall = Date.now();
  };
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

  // B2 (Blaupause Lücke 4): Namens-Diskrepanzen DETERMINISTISCH auflösen statt
  // Prompt-Hoffnung — Vorfall KONSTANT/HoRa 25.10.: firmenindex-Name ≠ Bieter-
  // Name, Auflösung über former_names (Umbenennung), nie still mismen.
  pi.registerTool({
    name: "namens_konsistenz",
    label: "Namens-Konsistenz (deterministisch)",
    description:
      "Prüft FN ↔ erwarteter Firmenname über die Suche (current + former_names). " +
      "Liefert {status: 'konsistent_direkt'|'konsistent_umbenannt'|'inkonsistent'|" +
      "'fn_nicht_gefunden', name_heute, fruehere_namen, hinweis}. Bei inkonsistent: " +
      "unsicherheit in den Bericht, NICHT selbst entscheiden.",
    parameters: Type.Object({
      fn: Type.String({ description: "Firmenbuchnummer" }),
      erwarteter_name: Type.String({ description: "Erwarteter Firmenname (z.B. Bietername)" }),
    }),
    execute: async (_id, params) => {
      emit({ t: "tool_call", name: "namens_konsistenz", params });
      let out: Record<string, unknown>;
      try {
        const raw = (await callFi(API, "search", { query: params.erwarteter_name }, TOKEN, throttle)) as any;
        const treffer = (raw?.results ?? []).find((r: any) => r.fn === params.fn);
        if (!treffer) {
          out = {
            status: "fn_nicht_gefunden",
            hinweis: `FN ${params.fn} nicht unter Namen ${JSON.stringify(params.erwarteter_name)} — Namen prüfen oder FN über andere Quelle`,
            gefundene_fns: (raw?.results ?? []).slice(0, 3).map((r: any) => r.fn),
          };
        } else if (treffer.name === params.erwarteter_name) {
          out = { status: "konsistent_direkt", name_heute: treffer.name, fruehere_namen: treffer.former_names ?? [] };
        } else if (Array.isArray(treffer.former_names) && treffer.former_names.includes(params.erwarteter_name)) {
          out = {
            status: "konsistent_umbenannt",
            name_heute: treffer.name,
            fruehere_namen: treffer.former_names,
            hinweis: `Umbenennung: '${params.erwarteter_name}' heißt heute '${treffer.name}' (FN ${params.fn}) — als unsicherheit dokumentieren`,
          };
        } else {
          out = {
            status: "inkonsistent",
            name_heute: treffer.name,
            fruehere_namen: treffer.former_names ?? [],
            hinweis: "FN trägt diesen Namen weder aktuell noch historisch — Zuordnung anzweifeln, unsicherheit dokumentieren",
          };
        }
        emit({ t: "tool_result", name: "namens_konsistenz", ok: out.status !== "inkonsistent", status: out.status });
      } catch (err) {
        out = { status: "fn_nicht_gefunden", hinweis: String(err).slice(0, 150) };
        emit({ t: "tool_result", name: "namens_konsistenz", ok: false });
      }
      return { content: [{ type: "text", text: JSON.stringify(out) }], details: {} };
    },
  });
}
};
