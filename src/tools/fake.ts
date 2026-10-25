/** Phase-0-Fake-Tools (Plan §6 Phase 0: „2 Fake-Tools").
 * Phase 1 ersetzt firmenindex_suche durch den echten firmenindex-Call;
 * status_melden bleibt (stdout-JSONL ist das Robotni-Status-Äquivalent, §3). */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { emit } from "../protokoll.js";

export function fakeToolsExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "status_melden",
    label: "Status melden",
    description:
      "Melde einen Arbeitsfortschritt (wird im Job-Protokoll sichtbar). " +
      'level: "info" | "warn" | "error". Für Zwischenstände, Funde, Entscheidungen.',
    parameters: Type.Object({
      text: Type.String({ description: "Kurze Statusmeldung (Deutsch)" }),
      level: Type.Optional(Type.Union([Type.Literal("info"), Type.Literal("warn"), Type.Literal("error")])),
    }),
    execute: async (_id, params) => {
      const level = (params.level ?? "info") as string;
      emit({ t: "status", level, text: params.text });
      return {
        content: [{ type: "text", text: `Status gemeldet (${level}): ${params.text}` }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "firmenindex_suche",
    label: "Firmenindex-Suche (FAKE, Phase 0)",
    description:
      "Suche eine Firma im Firmenindex nach Namen; liefert {fn, name}. " +
      "PHASE-0-FAKE: deterministische Dummy-Antwort, KEIN echter Call.",
    parameters: Type.Object({
      query: Type.String({ description: "Firmenname (oder Teil davon)" }),
    }),
    execute: async (_id, params) => {
      emit({ t: "tool_call", name: "firmenindex_suche", params, fake: true });
      const hit = {
        fn: "195777h",
        name: "Georg Traugott GmbH",
        quelle: "fake-phase0",
      };
      emit({ t: "tool_result", name: "firmenindex_suche", ok: true, fake: true });
      return {
        content: [{ type: "text", text: JSON.stringify([hit]) }],
        details: {},
      };
    },
  });
}
