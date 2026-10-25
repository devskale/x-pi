/** status_melden — Robotni-Status-Äquivalent (stdout-JSONL, §3). Bleibt über
 * alle Phasen (Phase-0-Fake-Tools sind ersetzt durch echte, siehe
 * firmenindex.ts / kontext.ts). */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { emit } from "../protokoll.js";

export function statusTool(pi: ExtensionAPI): void {
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
}
