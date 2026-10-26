/** fn_ermitteln — deterministische FN-Auflösung (Härtung nach dem
 * Provenance-Halluzinations-Vorfall: Modell „wusste" FN, behauptete
 * 'aus audit_meta' — FN-Ermittlung gehört in Software, nicht ins LLM). */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fnErmitteln } from "../src/toolpacks/firmenbuch.js";

const BASE = path.join("/tmp", `xpi-fn-test-${Date.now()}`);

function bdir(bidder: string) {
  const d = path.join(BASE, "P", "B", bidder);
  mkdirSync(d, { recursive: true });
  return d;
}

test("job-FN gewinnt, valide Form erzwungen", () => {
  assert.deepEqual(fnErmitteln("P", "B", "123456x", BASE), { fn: "123456x", quelle: "job" });
  assert.match(JSON.stringify(fnErmitteln("P", "B", "12x34", BASE)), /unbelegt|hinweis/);
});

test("audit.meta.fn vor Sidecar", () => {
  const d = bdir("B1");
  writeFileSync(path.join(d, "audit.json"), JSON.stringify({ meta: { fn: "111111a" } }));
  writeFileSync(path.join(d, "Firmenbuchauszug.pdf.meta.json"), JSON.stringify({ details: { firmenbuchnummer: "222222b" } }));
  assert.equal(fnErmitteln("P", "B1", undefined, BASE).quelle, "audit_meta.fn");
});

test("Sidecar-Fundstelle in quelle dokumentiert", () => {
  const d = bdir("B2");
  writeFileSync(path.join(d, "audit.json"), JSON.stringify({ meta: {} }));
  writeFileSync(path.join(d, "2025-01-21 Firmenbuchauszug.pdf.meta.json"), JSON.stringify({ details: { firmenbuchnummer: "195777h" } }));
  const r = fnErmitteln("P", "B2", undefined, BASE);
  assert.equal(r.fn, "195777h");
  assert.equal(r.quelle, "sidecar:2025-01-21 Firmenbuchauszug.pdf");
});

test("Firmenbuch-Dateien vor anderen Sidecars (Doppel-Kandidat)", () => {
  const d = bdir("B3");
  writeFileSync(path.join(d, "audit.json"), JSON.stringify({}));
  writeFileSync(path.join(d, "A_GISA.pdf.meta.json"), JSON.stringify({ name: "FN 333333c Auszug" }));
  writeFileSync(path.join(d, "Firmenbuch X.pdf.meta.json"), JSON.stringify({ details: { firmenbuchnummer: "444444d" } }));
  const r = fnErmitteln("P", "B3", undefined, BASE);
  assert.equal(r.fn, "444444d");
  assert.match(r.quelle, /Firmenbuch/);
});

test("nichts gefunden → fn null + hinweis (nie raten)", () => {
  bdir("B4");
  const r = fnErmitteln("P", "B4", undefined, BASE);
  assert.equal(r.fn, null);
  assert.equal(r.quelle, "unbelegt");
  assert.ok(r.hinweis);
});

test.after(() => rmSync(BASE, { recursive: true, force: true }));

// Validierungsfund 26.10.: meta.fn mit Leerzeichen ("FN 274413 z")
import { test } from "node:test";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { fnErmitteln } from "../src/toolpacks/firmenbuch.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("fn_ermitteln: FN 274413 z (Leerzeichen) wird normalisiert erkannt", () => {
  const base = mkdtempSync(join(tmpdir(), "fntest-"));
  const bDir = join(base, "P", "B", "X GmbH");
  mkdirSync(bDir, { recursive: true });
  writeFileSync(join(bDir, "audit.json"), JSON.stringify({ meta: { fn: "FN 274413 z" } }));
  const r = fnErmitteln("P", "X GmbH", undefined, base);
  assert.equal(r.fn, "274413z");
  rmSync(base, { recursive: true, force: true });
});

test("fn_ermitteln: klassische Form bleibt", () => {
  const base = mkdtempSync(join(tmpdir(), "fntest2-"));
  const bDir = join(base, "P", "B", "Y GmbH");
  mkdirSync(bDir, { recursive: true });
  writeFileSync(join(bDir, "audit.json"), JSON.stringify({ meta: { fn: "188942g" } }));
  const r = fnErmitteln("P", "Y GmbH", undefined, base);
  assert.equal(r.fn, "188942g");
  rmSync(base, { recursive: true, force: true });
});
