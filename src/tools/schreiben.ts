/** audit_meta_schreiben — der EINZIGE Schreibweg des Agenten (Phase 2).
 * HTTP → robotni fakt_write (Python), der hinter dem bestehenden gelockten
 * ofs-Schreibpfad schreibt — kein Schreib-Codepfad in TS (Plan §3).
 * Token: env FB_PI_FAKT_WRITE_TOKEN (pi5-intern, STS-write-Scope-Äquivalent).
 * Endpoint validiert Whitelist/Schema/Provenance — Fehler kommen LAUT zurück. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { emit } from "../protokoll.js";

import type { FbPiKonfig } from "../konfig.js";

export async function faktWrite(url: string, body: unknown, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`fakt_write ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

export function schreibenTool(cfg: FbPiKonfig, version: string): (pi: ExtensionAPI) => void {
  const URL_ = cfg.tools.schreiben.faktUrl;
  return (pi: ExtensionAPI): void => {
  pi.registerTool({
    name: "audit_meta_schreiben",
    label: "Fakt schreiben",
    description:
      "Schreibt den gf_stand-Fakt in audit.json meta (einziges Schreib-Tool; " +
      "Server validiert Whitelist/Schema/Provenance hart)._payload = das " +
      "Abschluss-JSON (fn, fn_quelle, stichtag, vertretungsbefugte, quelle, " +
      "unsicherheiten). Provenance setzt das Tool selbst (agent/job).",
    parameters: Type.Object({
      project: Type.String(),
      bidder: Type.String(),
      payload: Type.Object({
        fn: Type.Union([Type.String(), Type.Null()]),
        fn_quelle: Type.Optional(Type.String()),
        stichtag: Type.String(),
        quelle: Type.String(),
        vertretungsbefugte: Type.Array(
          Type.Object({
            name: Type.String(),
            funktion: Type.Optional(Type.String()),
            seit: Type.Optional(Type.Union([Type.String(), Type.Null()])),
            bis: Type.Optional(Type.Union([Type.String(), Type.Null()])),
            befugnis: Type.Optional(Type.String()),
          }),
        ),
        unsicherheiten: Type.Optional(Type.Array(Type.String())),
      }),
    }),
    execute: async (_id, params) => {
      emit({ t: "tool_call", name: "audit_meta_schreiben", params: { project: params.project, bidder: params.bidder } });
      const token = process.env.FB_PI_FAKT_WRITE_TOKEN?.trim();
      if (!token) {
        emit({ t: "tool_result", name: "audit_meta_schreiben", ok: false });
        return {
          content: [{ type: "text", text: "FEHLER: FB_PI_FAKT_WRITE_TOKEN nicht gesetzt — Schreiben verweigert" }],
          details: {},
        };
      }
      const job = (globalThis as any).__fbpi_job_id ?? "adhoc";
        const fakt = "gf_stand"; // Missions-spezifisch — Tool-Contract bleibt gf_stand in v1
      try {
        const out = await faktWrite(URL_,
          {
            project: params.project,
            bidder: params.bidder,
            fakt,
            payload: params.payload,
            provenance: { agent: `fb-pi@${version}`, job_id: String(job), quelle: params.payload.quelle },
          },
          token,
        );
        emit({ t: "tool_result", name: "audit_meta_schreiben", ok: true, written: out.written });
        return { content: [{ type: "text", text: JSON.stringify(out) }], details: {} };
      } catch (err) {
        emit({ t: "tool_result", name: "audit_meta_schreiben", ok: false, error: String(err).slice(0, 200) });
        return { content: [{ type: "text", text: `FEHLER: ${String(err).slice(0, 250)}` }], details: {} };
      }
    },
  });
}
};
