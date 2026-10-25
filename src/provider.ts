/** uniinfer/Edge-Provider — pi Custom Provider auf dem OpenAI-kompatiblen
 * uniinfer-Gateway (uniinfer.skale.dev, hab-Route → DGX vLLM).
 * Plan §5: kein Modellwildwuchs, Fallback = harter Fehler (nie still).
 *
 * Form: "Register a compatible endpoint" (pi docs/custom-provider.md) —
 * api: openai-completions, kein Custom-Stream (der Gateway spricht das
 * Protokoll nativ; pi's Konvertierung/Usage/Abbruch bleibt intakt).
 * Registrierung DIREKT auf dem ModelRuntime (SDK-Pfad, kein Extension-Umweg). */

import { spawnSync } from "node:child_process";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export const PROVIDER_ID = "uniinfer-edge";
export const MODEL_ID = "hab@qwen3.6-35b"; // uniinfer provider@model (hab = DGX-Route)
export const BASE_URL = process.env.UNIINFER_EDGE_URL ?? "https://uniinfer.skale.dev/v1";

/** Gateway-Token: env zuerst (Deploy-Standard), sonst credgoo-Service
 * `uniinfer` (gleiche Quelle wie der Python-Stack). Hard fail ohne Token. */
export function resolveGatewayToken(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.UNIINFER_GATEWAY_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const r = spawnSync("credgoo", ["uniinfer"], { encoding: "utf8", timeout: 15_000 });
  const fromCredgoo = (r.stdout ?? "").trim();
  if (r.status === 0 && fromCredgoo) return fromCredgoo;
  throw new Error(
    "kein UNIINFER_GATEWAY_TOKEN (env leer, credgoo fehlgeschlagen: " +
      `${r.error ?? r.stderr ?? "?"}) — Provider-Konfig überspringen wäre ein ` +
      "stiller Fallback, Plan §5 verlangt einen harten Fehler",
  );
}

/** Modell-Metadaten (models.yml-Spiegel von hab@qwen3.6-35b, Stand 2026-10). */
export function edgeModelDefinition() {
  return {
    type: "chat" as const,
    id: MODEL_ID,
    name: "Qwen 3.6 35B A3B (DGX vLLM via uniinfer hab)",
    reasoning: true,
    input: ["text"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131_072,
    maxTokens: 32_768,
  };
}

/** Registriert den Edge-Provider auf dem Runtime (vor getModel). Liefert die
 * ProviderConfig (auch für Tests/Ausleihe) zurück. */
export function edgeProviderConfig() {
  return {
    name: "uniinfer/Edge (hab-Route)",
    baseUrl: BASE_URL,
    apiKey: "$UNIINFER_GATEWAY_TOKEN",
    api: "openai-completions" as const,
    models: [edgeModelDefinition()],
  };
}

export function registerEdgeProvider(modelRuntime: ModelRuntime): void {
  modelRuntime.registerProvider(PROVIDER_ID, edgeProviderConfig());
}
