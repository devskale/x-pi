/** fb-pi CLI — Job-JSON → pi-Session (inMemory) → Mission → Bericht.
 * Phase 0 (Plan §6): --selftest beweist Session + Edge-Provider + 1 Tool-Call
 * im stdout-JSONL-Protokoll; --job ist der spätere robotni-Einstieg. */

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { emit } from "./protokoll.js";
import { MODEL_ID, PROVIDER_ID, registerEdgeProvider, resolveGatewayToken } from "./provider.js";
import { fakeToolsExtension } from "./tools/fake.js";
import { gfStandSystemPrompt, gfStandUserPrompt, isGfStandJob } from "./missionen/gfStand.js";

const VERSION = "0.0.1";

function parseArgs(argv: string[]): { selftest: boolean; jobJson: string | null } {
  const selftest = argv.includes("--selftest");
  let jobJson: string | null = null;
  const i = argv.indexOf("--job");
  if (i !== -1 && argv[i + 1]) jobJson = argv[i + 1];
  return { selftest, jobJson };
}

async function main(): Promise<number> {
  const { selftest, jobJson } = parseArgs(process.argv.slice(2));
  if (!selftest && !jobJson) {
    process.stderr.write("usage: fb-pi --selftest | fb-pi --job '<json>'\n");
    return 2;
  }

  // Gateway-Token VOR Session-Erzeugung resolven (Provider liest $ENV beim Call)
  const token = resolveGatewayToken();
  process.env.UNIINFER_GATEWAY_TOKEN = token;

  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    systemPromptOverride: () => gfStandSystemPrompt(),
    appendSystemPromptOverride: () => [],
    extensionFactories: [fakeToolsExtension],
  });
  await loader.reload();

  const modelRuntime = await ModelRuntime.create();
  registerEdgeProvider(modelRuntime);
  const model = modelRuntime.getModel(PROVIDER_ID, MODEL_ID);
  if (!model) {
    emit({ t: "error", code: "model_not_registered", provider: PROVIDER_ID, model: MODEL_ID });
    return 1; // Plan §5: harter Fehler, kein stiller Fallback
  }

  const { session } = await createAgentSession({
    resourceLoader: loader,
    modelRuntime,
    model,
    thinkingLevel: "off", // Fakt-Extraktion, kein Reasoning-Bedarf (Phase 0)
    noTools: "builtin", // Built-ins aus — Extension-Tools (status_melden, firmenindex_suche) bleiben
    sessionManager: SessionManager.inMemory(), // One-shot: kein Session-Gedächtnis
  });

  const t0 = Date.now();
  let usage: unknown = null;
  const unsubscribe = session.subscribe((event: any) => {
    if (event?.type === "message_end" && event.message?.usage) {
      usage = event.message.usage;
    }
  });

  const job = selftest
    ? { project: "arbeitsschuhe-selftest", bidder: "Georg Traugott GmbH", fakt: "gf_stand" as const }
    : JSON.parse(jobJson!);
  if (!isGfStandJob(job)) {
    emit({ t: "error", code: "invalid_job", job });
    return 2;
  }

  emit({
    t: "job_start",
    agent: `fb-pi@${VERSION}`,
    mission: job.fakt,
    job,
    model: { provider: PROVIDER_ID, id: MODEL_ID, thinking: "off", baseUrl: "uniinfer.skale.dev/v1" },
    phase: 0,
  });

  try {
    await session.prompt(gfStandUserPrompt(job));
    const antwort = session.getLastAssistantText();
    emit({ t: "bericht", text: antwort });
    emit({ t: "usage", ...( (usage as object) ?? {}) });
    emit({ t: "job_end", ok: true, elapsed_s: Number(((Date.now() - t0) / 1000).toFixed(1)) });
    return 0;
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
