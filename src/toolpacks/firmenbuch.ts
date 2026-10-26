/** Toolpack firmenbuch — fb-pi-Missionen (gf_stand): firmenindex-Zugang +
 * deterministische FN-Auflösung. Ein Toolpack ist eine Datei mit einer
 * Factory `firmenbuchToolpack(cfg) → Tool-Factories[]`; aktiviert via
 * x-pi.config.json → toolpacks: ["firmenbuch"] (keine Hardcodings). */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { emit } from "../protokoll.js";

/** FUND 2 (x-pi-zuverlaessigkeit): garantiert tool_result für JEDEX Tool —
 * auch bei Exception. Ohne dies war ein transienter Tool-Fehler unsichtbar
 * (Agent narruerte „Tool fehlt", kein tool_result-Event, keine Diagnose). */
export async function safeExecute(
  name: string,
  fn: (id: string, params: any) => Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown> }>,
  id: string,
  params: any,
): Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown> }> {
  try {
    return await fn(id, params);
  } catch (err) {
    emit({ t: "tool_result", name, ok: false, error: String(err).slice(0, 200) });
    return {
      content: [{ type: "text", text: `FEHLER in ${name}: ${String(err).slice(0, 250)}` }],
      details: {},
    };
  }
}
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
        } else if (namenGleich(treffer.name, params.erwarteter_name)) {
          out = { status: "konsistent_direkt", name_heute: treffer.name, fruehere_namen: treffer.former_names ?? [], hinweis: treffer.name === params.erwarteter_name ? undefined : "identisch bis auf Schreibweise/Punktuation" };
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

// ── fn_ermitteln (aus dem firmenbuch-Toolpack): FN-Auflösung deterministisch ──

export interface FnFund {
  fn: string | null;
  quelle: string;
  kandidaten?: { fn: string; quelle: string }[];
  hinweis?: string;
}

// Validierungsfund 26.10.: meta.fn-Werte sind teils "FN 274413 z" (Leerzeichen
// vor dem Buchstaben) — der strenge Regex matchte nicht, FN galt als unbelegt.
const FN_RE = /\b(\d{4,6})\s*([a-z])\b/g;

// Schreibkonventions-Toleranz: "m.b.H" ≡ "m.b.H." (Validierungsfund 26.10.:
// Register trägt den Schlusspunkt, Ordner nicht — keine echte Diskrepanz).
function namenGleich(a: string, b: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/[\s.,&/-]+/g, "");
  return norm(a) === norm(b) && norm(a).length > 0;
}

export function fnErmitteln(
  project: string,
  bidder: string,
  jobFn: string | undefined,
  base: string,
): FnFund {
  if (jobFn && /^[0-9]{4,6}[a-z]$/.test(jobFn)) return { fn: jobFn, quelle: "job" };
  const kandidaten: { fn: string; quelle: string }[] = [];
  const bDir = path.join(base, project, "B", bidder);
  try {
    const audit = JSON.parse(readFileSync(path.join(bDir, "audit.json"), "utf8"));
    const meta = audit.meta;
    if (meta && typeof meta.fn === "string") {
      const fm = meta.fn.match(FN_RE)?.[0]?.replace(/\s+/g, "") ?? "";
      if (fm) kandidaten.push({ fn: fm, quelle: "audit_meta.fn" });
    }
  } catch { /* kein audit.json */ }
  try {
    const files = readDirSorted(bDir);
    const fb = files.filter((f) => /firmenbuch/i.test(f));
    for (const f of [...fb, ...files.filter((x) => !fb.includes(x))]) {
      if (!f.endsWith(".meta.json") || f.includes(".backup")) continue;
      const sc = JSON.parse(readFileSync(path.join(bDir, f), "utf8"));
      const hay = JSON.stringify(sc);
      const m = hay.match(FN_RE); // /g-Flag: Liste von Match-Strings (keine Gruppen)
      const fn_norm = m && m[0] ? m[0].replace(/\s+/g, "") : null;
      if (fn_norm && !kandidaten.some((k) => k.fn === fn_norm)) {
        kandidaten.push({ fn: fn_norm, quelle: `sidecar:${f.replace(/\.meta\.json$/, "")}` });
      }
    }
  } catch { /* dir nicht lesbar */ }
  if (kandidaten.length === 1) return { fn: kandidaten[0].fn, quelle: kandidaten[0].quelle };
  if (kandidaten.length > 1) {
    return { fn: kandidaten[0].fn, quelle: kandidaten[0].quelle, kandidaten, hinweis: "mehrere FN-Kandidaten — erste (Firmenbuch-Sidecar bevorzugt)" };
  }
  return { fn: null, quelle: "unbelegt", hinweis: "keine FN in job/audit_meta/sidecars gefunden" };
}

function readDirSorted(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

export function firmenbuchToolpack(cfg: FbPiKonfig): ((pi: ExtensionAPI) => void)[] {
  return [
    firmenindexTools(cfg),
    (pi: ExtensionAPI): void => {
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
        execute: async (_id, params) => safeExecute("fn_ermitteln", async (_i, prm) => {
          emit({ t: "tool_call", name: "fn_ermitteln", params: prm });
          const p = prm.project?.includes("..") ? null : prm.project;
          const b = prm.bidder?.includes("..") ? null : prm.bidder;
          const out = p && b ? fnErmitteln(p, b, undefined, cfg.tools.kontext.ofsBase) : { fn: null, quelle: "ungültige Namen" };
          emit({ t: "tool_result", name: "fn_ermitteln", ok: out.fn !== null, fn: out.fn, quelle: out.quelle });
          return { content: [{ type: "text", text: JSON.stringify(out) }], details: {} };
        }, _id, params),
      });
    },
  ];
}
