/** uniinfer/Edge-Provider — pi Custom Provider auf dem OpenAI-kompatiblen
 * uniinfer-Gateway (hab-Route → DGX vLLM). ALLE Parameter aus der Konfig
 * (src/konfig.ts — ENV > fb-pi.config.json > Defaults). Fallback = harter
 * Fehler (nie still).
 *
 * Form: "Register a compatible endpoint" (pi docs/custom-provider.md) —
 * api: openai-completions, kein Custom-Stream. Registrierung DIREKT auf dem
 * ModelRuntime (SDK-Pfad, kein Extension-Umweg). */

import { spawnSync } from "node:child_process";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { FbPiKonfig } from "./konfig.js";

/** Gateway-Token: env zuerst (Deploy-Standard), sonst credgoo (konfigurierbares
 * Kommando). Hard fail ohne Token — Plan §5, nie stiller Fallback. */
export function resolveGatewayToken(tokenEnv: string, tokenCommand: string[]): string {
  const fromEnv = process.env[tokenEnv]?.trim();
  if (fromEnv) return fromEnv;
  const r = spawnSync(tokenCommand[0] ?? "credgoo", tokenCommand.slice(1) ?? [], {
    encoding: "utf8",
    timeout: 15_000,
  });
  const fromCredgoo = (r.stdout ?? "").trim();
  if (r.status === 0 && fromCredgoo) return fromCredgoo;
  throw new Error(
    `kein Token via ${tokenEnv} (env leer, ${tokenCommand.join(" ")} fehlgeschlagen: ` +
      `${r.error ?? r.stderr ?? "?"}) — harter Fehler statt stiller Fallback`,
  );
}

/** ProviderConfig aus der Konfig (auch für Tests/Ausleihe). */
export function edgeProviderConfig(cfg: Pick<FbPiKonfig, "provider">) {
  return {
    name: `${cfg.provider.id} (${cfg.provider.model})`,
    baseUrl: cfg.provider.baseUrl,
    apiKey: `$${cfg.provider.tokenEnv}`,
    api: "openai-completions" as const,
    models: [
      {
        type: "chat" as const,
        id: cfg.provider.model,
        name: cfg.provider.model,
        reasoning: true,
        input: ["text"] as const,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: cfg.provider.contextWindow,
        maxTokens: cfg.provider.maxTokens,
      },
    ],
  };
}

export function registerEdgeProvider(modelRuntime: ModelRuntime, cfg: FbPiKonfig): void {
  modelRuntime.registerProvider(cfg.provider.id, edgeProviderConfig(cfg));
}
