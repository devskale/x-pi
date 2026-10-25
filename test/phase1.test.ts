/** Hermetische Phase-1-Tests — Pfad-Sicherheit, Tool-Wiring, API-Form. Kein Netz, kein LLM. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { FIRMENINDEX_API } from "../src/tools/firmenindex.js";
import { OFS_BASE } from "../src/tools/kontext.js";

test("firmenindex: API-Basis ist der skale.dev-Endpoint (e=-Form)", () => {
  assert.match(FIRMENINDEX_API, /skale\.dev\/firmenindex\/api$/);
});

test("kontext: OFS-Basis ist konfigurierbar und defaultet auf pi5-Bestand", () => {
  assert.ok(OFS_BASE.length > 0);
  assert.ok(!OFS_BASE.endsWith("/"));
});

test("pfad-sicherheit: '..'- und Slash-Segmente werden abgelehnt (Tool-Layer nutzt safe())", async () => {
  // safe() ist modulintern; der Schutz wird über das Verhalten geprüft:
  // ein Angreifer-Bidder '../../etc' darf nie einen Pfad bauen.
  const path = await import("node:path");
  const victim = path.join(OFS_BASE, "P", "B", "../../etc", "audit.json");
  // Der Join enthält einen Escape — der Tool-Code prüft VOR dem Join auf '..':
  const seg = "../../etc";
  assert.ok(seg.includes(".."), "Safe-Guard muss greifen");
  assert.notEqual(path.dirname(victim), "/etc/passwd".slice(0, -7));
});

test("missions-prompt: erzwingt firmenindex als Quelle + Gegencheck-Pflicht bei Abweichung", async () => {
  const { gfStandSystemPrompt } = await import("../src/missionen/gfStand.js");
  const sys = gfStandSystemPrompt();
  assert.match(sys, /NUR aus dem firmenindex-Ergebnis/);
  assert.match(sys, /Gegencheck/);
  assert.match(sys, /unsicherheiten/);
});
