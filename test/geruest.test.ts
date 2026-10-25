/** Hermetische Gerüst-Tests (Phase 0) — ohne LLM, ohne Netz. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { edgeModelDefinition, MODEL_ID, PROVIDER_ID } from "../src/provider.js";
import { gfStandSystemPrompt, gfStandUserPrompt, isGfStandJob } from "../src/missionen/gfStand.js";
import { emit } from "../src/protokoll.js";

test("provider: Modell-Definition ist chat/edge mit hab-Route", () => {
  const m = edgeModelDefinition();
  assert.equal(m.type, "chat");
  assert.equal(m.id, "hab@qwen3.6-35b");
  assert.equal(PROVIDER_ID, "uniinfer-edge");
  assert.equal(m.contextWindow, 131_072);
});

test("mission: Job-Schema akzeptiert gültig, lehnt fremde Fakten ab", () => {
  assert.ok(isGfStandJob({ project: "p", bidder: "b", fakt: "gf_stand" }));
  assert.ok(!isGfStandJob({ project: "p", bidder: "b", fakt: "insolvenz" }));
  assert.ok(!isGfStandJob(null));
  assert.ok(!isGfStandJob({ project: "p", fakt: "gf_stand" })); // bidder fehlt
});

test("mission: Prompt trägt Job-Kontext (FN/Stichtag) und Phase-0-Vertrag", () => {
  const p = gfStandUserPrompt({ project: "Arbeitsschuhe", bidder: "KONSTANT", fakt: "gf_stand", fn: "123456x", stichtag: "2025-01-27" });
  assert.match(p, /123456x/);
  assert.match(p, /2025-01-27/);
  const sys = gfStandSystemPrompt();
  assert.match(sys, /vertretungsbefugte/);
  assert.match(sys, /status_melden/);
  assert.match(sys, /firmenindex_vertretung/);
  assert.match(sys, /audit_meta_schreiben/);
});

test("protokoll: emit schreibt genau eine JSONL-Zeile", () => {
  const chunks: string[] = [];
  const fakeOut = { write: (s: string) => chunks.push(s) } as unknown as NodeJS.WriteStream;
  emit({ t: "status", level: "info", text: "ok" }, fakeOut);
  assert.equal(chunks.length, 1);
  assert.equal(JSON.parse(chunks[0]!).text, "ok");
  assert.ok(!chunks[0]!.includes("\n") || !chunks[0]!.trimEnd().includes("\n"));
});

test("MODEL_ID folgt uniinfer provider@model-Konvention", () => {
  assert.match(MODEL_ID, /^[a-z0-9.-]+@[a-z0-9.-]+$/);
});
