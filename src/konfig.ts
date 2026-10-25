/** Konfiguration — alles Betriebsparameter, nichts hardcoded (User-Regel
 * 2026-10-25: „keine hardcodings, alles konfigurierbar").
 *
 * Präzedenz: ENV > x-pi.config.json (Pfad via X_PI_CONFIG) > Defaults hier.
 * NICHT konfigurierbar sind VERTRÄGE (Bericht-Schema der Mission, fakt_write-
 * Whitelist/Auth — Sicherheitsgrenzen sind Code, keine Betriebsparameter). */

import { readFileSync } from "node:fs";
import path from "node:path";

export interface FbPiKonfig {
  provider: {
    id: string;
    model: string; // uniinfer provider@model
    baseUrl: string;
    contextWindow: number;
    maxTokens: number;
    thinking: "off" | "low" | "medium" | "high";
    tokenEnv: string; // env-Var mit dem Gateway-Token
    tokenCommand: string[]; // credgoo-Fallback (Befehl + Arg)
  };
  tools: {
    firmenindex: {
      apiUrl: string;
      tokenEnv: string; // env mit Konto-Token (Phase 3; leer = anonym, Details ggf. 403)
      tokenCommand: string[]; // credgoo-Fallback (Service `firmenindex`)
      crawlDelayMs: number; // Drossel-Respekt: ≥5s zwischen Calls (Service-Vorgabe)
    };
    kontext: { ofsBase: string };
    schreiben: { faktUrl: string };
  };
  missionen: { dir: string };
  toolpacks: string[];
}

const DEFAULTS: FbPiKonfig = {
  provider: {
    id: "uniinfer-edge",
    model: "hab@qwen3.6-35b",
    baseUrl: "https://uniinfer.skale.dev/v1",
    contextWindow: 131_072,
    maxTokens: 32_768,
    thinking: "off",
    tokenEnv: "UNIINFER_GATEWAY_TOKEN",
    tokenCommand: ["credgoo", "uniinfer"],
  },
  tools: {
    firmenindex: {
      apiUrl: "https://skale.dev/firmenindex/api",
      tokenEnv: "FIRMENINDEX_TOKEN",
      tokenCommand: ["credgoo", "firmenindex"],
      crawlDelayMs: 5000,
    },
    kontext: { ofsBase: "/home/pi/code/dufs/klark0" },
    schreiben: { faktUrl: "http://127.0.0.1:5555/fakt/write" },
  },
  missionen: { dir: "missionen" },
  toolpacks: ["firmenbuch"],
};

function deepMerge<T>(base: T, over: unknown): T {
  if (typeof base !== "object" || base === null || Array.isArray(base)) {
    return (over === undefined ? base : (over as T));
  }
  if (typeof over !== "object" || over === null) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    if (k in out) out[k] = deepMerge((out as Record<string, unknown>)[k], v);
  }
  return out as T;
}

export function ladeKonfig(env: NodeJS.ProcessEnv = process.env, root: string = process.cwd()): FbPiKonfig {
  let cfg = DEFAULTS;
  const datei = env.X_PI_CONFIG ?? path.join(root, "x-pi.config.json");
  try {
    cfg = deepMerge(cfg, JSON.parse(readFileSync(datei, "utf8")));
  } catch {
    /* keine Datei / unlesbar → Defaults + ENV */
  }
  // ENV überschreibt gezielt (flache Keys, dokumentiert in README)
  const envMap: [string, (c: FbPiKonfig) => unknown, (c: FbPiKonfig, v: string) => void][] = [
    ["X_PI_MODEL", (c) => c.provider.model, (c, v) => (c.provider.model = v)],
    ["X_PI_PROVIDER_URL", (c) => c.provider.baseUrl, (c, v) => (c.provider.baseUrl = v)],
    ["FIRMENINDEX_API", (c) => c.tools.firmenindex.apiUrl, (c, v) => (c.tools.firmenindex.apiUrl = v)],
    ["X_PI_OFS_BASE", (c) => c.tools.kontext.ofsBase, (c, v) => (c.tools.kontext.ofsBase = v)],
    ["X_PI_FAKT_URL", (c) => c.tools.schreiben.faktUrl, (c, v) => (c.tools.schreiben.faktUrl = v)],
    ["X_PI_MISSIONEN_DIR", (c) => c.missionen.dir, (c, v) => (c.missionen.dir = v)],
  ];
  for (const [key, , apply] of envMap) {
    if (env[key]?.trim()) apply(cfg, env[key]!.trim());
  }
  return cfg;
}
