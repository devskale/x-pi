/** audit_meta_schreiben — der EINZIGE Schreibweg des Agenten (Phase 2).
 * HTTP → robotni fakt_write (Python), der hinter dem bestehenden gelockten
 * ofs-Schreibpfad schreibt — kein Schreib-Codepfad in TS (Plan §3).
 * Token: env X_PI_FAKT_WRITE_TOKEN (pi5-intern, STS-write-Scope-Äquivalent).
 * Endpoint validiert Whitelist/Schema/Provenance — Fehler kommen LAUT zurück. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { emit } from "../protokoll.js";

import { readFileSync } from "node:fs";
import path from "node:path";
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
      fakt: Type.Optional(Type.String({ description: "gf_stand (Default) | preise_check | sammeldok_index" })),
      payload: Type.Record(Type.String(), Type.Unknown()),
    }),
    execute: async (_id, params) => {
      emit({ t: "tool_call", name: "audit_meta_schreiben", params: { project: params.project, bidder: params.bidder } });
      const token = process.env.X_PI_FAKT_WRITE_TOKEN?.trim();
      if (!token) {
        emit({ t: "tool_result", name: "audit_meta_schreiben", ok: false });
        return {
          content: [{ type: "text", text: "FEHLER: X_PI_FAKT_WRITE_TOKEN nicht gesetzt — Schreiben verweigert" }],
          details: {},
        };
      }
      const job = (globalThis as any).__fbpi_job_id ?? "adhoc";
        const fakt = params.fakt ?? "gf_stand"; // Mission-spezifisch, Server validiert Whitelist hart
      try {
        // Read-back (Blaupause §6, SOTA self-verification): nach dem Write
        // den Fakt aus dem Bestand lesen und fn/stichtag/anzahl vergleichen —
        // der Agent sieht die Bestätigung, das Protokoll den Beweis.
        const out = await faktWrite(URL_,
          {
            project: params.project,
            bidder: params.bidder,
            fakt,
            payload: params.payload,
            provenance: { agent: `x-pi@${version}`, job_id: String(job), quelle: params.payload.quelle },
          },
          token,
        );
        let read_back: Record<string, unknown> = { ok: false, grund: "nicht ausgeführt" };
        try {
          const audit = JSON.parse(readFileSync(
            path.join(cfg.tools.kontext.ofsBase, params.project, "B", params.bidder, "audit.json"), "utf8"));
          const steht = ((audit as any).meta ?? {})[fakt] ?? null;
          const p: any = params.payload;
          if (fakt === "sammeldok_index") {
            read_back = {
              ok: !!steht && steht.dokument === p.dokument && Array.isArray(steht.teildokumente)
                && steht.teildokumente.length === (p.teildokumente?.length ?? 0),
              dokument: steht?.dokument ?? null,
              n_teildokumente: Array.isArray(steht?.teildokumente) ? steht.teildokumente.length : 0,
            };
          } else if (fakt === "preise_check") {
            read_back = {
              ok: !!steht && steht.hand_summe === p.hand_summe && Array.isArray(steht.positionen)
                && steht.positionen.length === (p.positionen?.length ?? 0),
              hand_summe: steht?.hand_summe ?? null,
              reader_summe: steht?.reader_summe ?? null,
              ok_flag: steht?.ok ?? null,
              n_positionen: Array.isArray(steht?.positionen) ? steht.positionen.length : 0,
            };
          } else {
            read_back = {
              ok: !!steht
                && steht.fn === p.fn
                && steht.stichtag === p.stichtag
                && Array.isArray(steht.vertretungsbefugte)
                && steht.vertretungsbefugte.length === p.vertretungsbefugte.length,
              fn: steht?.fn ?? null,
              stichtag: steht?.stichtag ?? null,
              n_vertretungsbefugte: Array.isArray(steht?.vertretungsbefugte) ? steht.vertretungsbefugte.length : 0,
            };
          }
        } catch (e) {
          read_back = { ok: false, grund: String(e).slice(0, 120) };
        }
        emit({ t: "tool_result", name: "audit_meta_schreiben", ok: true, written: out.written, read_back });
        return {
          content: [{ type: "text", text: JSON.stringify({ ...out, read_back }) }],
          details: {},
        };
      } catch (err) {
        emit({ t: "tool_result", name: "audit_meta_schreiben", ok: false, error: String(err).slice(0, 200) });
        return { content: [{ type: "text", text: `FEHLER: ${String(err).slice(0, 250)}` }], details: {} };
      }
    },
  });
}
};
