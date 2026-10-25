/** fb-pi CLI — Job-JSON → pi-Session (inMemory) → Mission (datengetrieben) → Bericht.
 * Alles Betriebsparameter kommt aus src/konfig.ts (ENV > fb-pi.config.json > Defaults).
 * Missionen: registry lädt missionen/*.config.json — neue Mission ohne Codeänderung. */

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { emit } from "./protokoll.js";
import { edgeProviderConfig, resolveGatewayToken } from "./provider.js";
import { firmenindexTools } from "./tools/firmenindex.js";
import { kontextTools } from "./tools/kontext.js";
import { statusTool } from "./tools/status.js";
import { schreibenTool } from "./tools/schreiben.js";
import { ladeKonfig } from "./konfig.js";
import { validiereBericht } from "./bericht.js";
import { isMissionJob, ladeMissionen } from "./missionen/registry.js";

// Versions-Drift vermeiden (Vorfall: run.ts sagte 0.2.0 während package.json
// längst 0.3.0 war): EINE Quelle — package.json.
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

function parseArgs(argv: string[]): { selftest: boolean; jobJson: string | null } {
  const selftest = argv.includes("--selftest");
  let jobJson: string | null = null;
  const i = argv.indexOf("--job");
  if (i !== -1 && argv[i + 1]) jobJson = argv[i + 1];
  // --job-b64: base64-kodiertes Job-JSON — die robotni-Substitution shlex-
  // splittet ${param} mit Leerzeichen (JSON/Multiword-Bieter zerreißen);
  // base64 ist space-frei und überlebt jede Shell-Substitution.
  const b = argv.indexOf("--job-b64");
  if (b !== -1 && argv[b + 1]) {
    jobJson = Buffer.from(argv[b + 1]!, "base64").toString("utf8");
  }
  return { selftest, jobJson };
}

async function main(): Promise<number> {
  const { selftest, jobJson } = parseArgs(process.argv.slice(2));
  if (!selftest && !jobJson) {
    process.stderr.write("usage: fb-pi --selftest | fb-pi --job '<json>'\n");
    return 2;
  }

  const cfg = ladeKonfig();
  const missionen = ladeMissionen(cfg.missionen.dir);

  // Gateway-Token VOR Session-Erzeugung resolven (Provider liest $ENV beim Call)
  const token = resolveGatewayToken(cfg.provider.tokenEnv, cfg.provider.tokenCommand);
  process.env[cfg.provider.tokenEnv] = token;

  const job = selftest
    ? { project: "arbeitsschuhe-selftest", bidder: "Georg Traugott GmbH", fakt: "gf_stand" }
    : JSON.parse(jobJson!);
  if (!isMissionJob(job) || !missionen.has(job.fakt)) {
    emit({ t: "error", code: "unknown_mission_or_job", fakt: (job as any)?.fakt, verfuegbar: [...missionen.keys()] });
    return 2;
  }
  const mission = missionen.get(job.fakt)!;

  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    systemPromptOverride: () => mission.systemPrompt,
    appendSystemPromptOverride: () => [],
    extensionFactories: [statusTool, firmenindexTools(cfg), kontextTools(cfg), schreibenTool(cfg, VERSION)],
  });
  await loader.reload();

  const modelRuntime = await ModelRuntime.create();
  modelRuntime.registerProvider(cfg.provider.id, edgeProviderConfig(cfg));
  const model = modelRuntime.getModel(cfg.provider.id, cfg.provider.model);
  if (!model) {
    emit({ t: "error", code: "model_not_registered", provider: cfg.provider.id, model: cfg.provider.model });
    return 1; // harter Fehler, kein stiller Fallback
  }

  const { session } = await createAgentSession({
    resourceLoader: loader,
    modelRuntime,
    model,
    thinkingLevel: cfg.provider.thinking,
    noTools: "builtin", // Built-ins aus — Extension-Tools bleiben (nicht "all"!)
    sessionManager: SessionManager.inMemory(),
  });

  const t0 = Date.now();
  let usage: unknown = null;
  const unsubscribe = session.subscribe((event: any) => {
    if (event?.type === "message_end" && event.message?.usage) {
      usage = event.message.usage;
    }
  });

  (globalThis as any).__fbpi_job_id = `${job.project}@${job.bidder}@${Date.now()}`;
  emit({
    t: "job_start",
    agent: `fb-pi@${VERSION}`,
    mission: job.fakt,
    mission_name: mission.name,
    job,
    model: {
      provider: cfg.provider.id,
      id: cfg.provider.model,
      thinking: cfg.provider.thinking,
      baseUrl: cfg.provider.baseUrl.replace(/^https?:\/\//, "").split("/")[0],
    },
    schreiben: mission.schreiben.enabled,
  });

  try {
    await session.prompt(mission.userPrompt(job));
    const antwort = session.getLastAssistantText();
    emit({ t: "bericht", text: antwort });
    const validiert = validiereBericht(antwort, mission);
    emit({ t: "bericht_valid", ok: validiert.ok, fehler: validiert.fehler || undefined });
    const bericht_ok = validiert.ok;
emit({ t: "usage", ...((usage as object) ?? {}) });
    emit({ t: "job_end", ok: bericht_ok, elapsed_s: Number(((Date.now() - t0) / 1000).toFixed(1)) });
    return bericht_ok ? 0 : 1; // invalid Bericht = fehlgeschlagener Lauf
  } catch (err) {
    emit({ t: "job_end", ok: false, error: String(err).slice(0, 300) });
    return 1;
  } finally {
    unsubscribe();
    session.dispose();
  }
}

main().then((rc) => process.exit(rc), (err) => {
  emit({ t: "fatal", error: String(err).slice(0, 300) });
  process.exit(1);
});
