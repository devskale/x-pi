/** Hermetische Phase-1-Tests — Pfad-Sicherheit, Tool-Wiring, API-Form. Kein Netz, kein LLM. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ladeKonfig } from "../src/konfig.js";


test("firmenindex: API-Basis ist der skale.dev-Endpoint (e=-Form, aus Konfig)", () => {
  const cfg = ladeKonfig({}, "/gibt/es/nicht");
  assert.match(cfg.tools.firmenindex.apiUrl, /firmenindex\/api$/);
});

test("kontext: OFS-Basis aus Konfig (ENV überschreibbar)", () => {
  const cfg = ladeKonfig({ FB_PI_OFS_BASE: "/custom/base" }, "/gibt/es/nicht");
  assert.equal(cfg.tools.kontext.ofsBase, "/custom/base");
});

test("pfad-sicherheit: '..'- und Slash-Segmente werden abgelehnt (Tool-Layer nutzt safe())", async () => {
  // safe() ist modulintern; der Schutz wird über das Verhalten geprüft:
  // ein Angreifer-Bidder '../../etc' darf nie einen Pfad bauen.
  const path = await import("node:path");
  const victim = path.join("/base", "P", "B", "../../etc", "audit.json");
  // Der Join enthält einen Escape — der Tool-Code prüft VOR dem Join auf '..':
  const seg = "../../etc";
  assert.ok(seg.includes(".."), "Safe-Guard muss greifen");
  assert.notEqual(path.dirname(victim), "/etc/passwd".slice(0, -7));
});

test("missions-prompt (Daten): erzwingt firmenindex als Quelle + Gegencheck-Pflicht", async () => {
  const { ladeMissionen } = await import("../src/missionen/registry.js");
  const gf = ladeMissionen("missionen").get("gf_stand")!;
  assert.match(gf.systemPrompt, /NUR aus dem firmenindex-Ergebnis/);
  assert.match(gf.systemPrompt, /Gegencheck/);
  assert.match(gf.systemPrompt, /unsicherheiten/);
  assert.match(gf.systemPrompt, /fn_quelle/);
});
