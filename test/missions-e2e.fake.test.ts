/** Missions-Fake-E2E (Blaupause §6, Lücke 5) — der komplette Lauf OHNE LLM/Netz:
 * Tool-Definitionen werden per Fake-pi gefangen, fetch + fakt_write gemockt,
 * Bestand als Fixture. Geprüft wird die Pipeline um das Modell herum:
 * FN-Auflösung → Kontext → Beschaffung → Konsistenz → SCHREIBEN+READ-BACK →
 * Bericht-Gate. Die echte LLM-Orchestrierung deckt der Live-Selftest ab.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ladeKonfig } from "../src/konfig.js";
import { ladeMissionen } from "../src/missionen/registry.js";
import { validiereBericht } from "../src/bericht.js";
import { kontextTools } from "../src/tools/kontext.js";
import { firmenindexTools } from "../src/tools/firmenindex.js";
import { schreibenTool } from "../src/tools/schreiben.js";

const BASE = mkdtempSync(path.join(os.tmpdir(), "fbpi-e2e-"));
const BID = path.join(BASE, "Arbeitsschuhe", "B", "Georg Traugott GmbH");
mkdirSync(BID, { recursive: true });
writeFileSync(path.join(BASE, "Arbeitsschuhe", "projekt.json"), JSON.stringify({
  meta: { datum: "2025-01-27", auftraggeber: "Wiener Wohnen" },
}));
writeFileSync(path.join(BID, "audit.json"), JSON.stringify({ meta: {} }));
writeFileSync(path.join(BID, "2025-01-21 Firmenbuchauszug.pdf.meta.json"), JSON.stringify({
  details: { firmenbuchnummer: "195777h" },
}));

const cfg = ladeKonfig({ FB_PI_OFS_BASE: BASE, FB_PI_FAKT_URL: "http://fakt.test/write" }, "/gibt/es/nicht");

// Fake-pi: Tool-Definitionen fangen statt registrieren
function fange(factory: (pi: any) => void): any[] {
  const defs: any[] = [];
  factory({ registerTool: (d: any) => defs.push(d) });
  return defs;
}
const von = (defs: any[], name: string) => {
  const d = defs.find((t) => t.name === name);
  assert.ok(d, `Tool ${name} registriert`);
  return d;
};
const execTool = async (defs: any[], name: string, params: any): Promise<any> => {
  const r = await von(defs, name).execute("id", params);
  return JSON.parse(r.content[0].text);
};

const kt = fange((pi: any) => kontextTools(cfg as any)(pi));
const fi = fange((pi: any) => firmenindexTools(cfg as any)(pi));
const sc = fange((pi: any) => schreibenTool(cfg as any, "0.3.0-test")(pi));

test.after(() => rmSync(BASE, { recursive: true, force: true }));

test("Mission gf_stand vorhanden und schreibt (Registry)", () => {
  const m = ladeMissionen("missionen").get("gf_stand")!;
  assert.match(m.systemPrompt, /namens_konsistenz/);
  assert.match(m.systemPrompt, /read_back/);
  assert.equal(m.schreiben.enabled, true);
});

test("Schritt 1+2: fn_ermitteln + projekt_lesen (echte Tool-Executes auf Fixture)", async () => {
  const fn = await execTool(kt, "fn_ermitteln", { project: "Arbeitsschuhe", bidder: "Georg Traugott GmbH" });
  assert.equal(fn.fn, "195777h");
  assert.equal(fn.quelle, "sidecar:2025-01-21 Firmenbuchauszug.pdf");

  const p = await execTool(kt, "projekt_lesen", { project: "Arbeitsschuhe" });
  assert.equal(p.datum, "2025-01-27");
});

test("Schritt 3+4b: vertretung + namens_konsistenz (fetch gemockt)", async (t) => {
  const origFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (url: any) => {
    const u = String(url);
    if (u.includes("vertretung")) {
      return new Response(JSON.stringify({
        fn: "195777h", stichtag: "2025-01-27", firma: "Georg Traugott GmbH",
        vertretungsbefugte: [
          { name: "Katrin Traugott", funktion: "GF", seit: "2014-02-06", bis: null, befugnis: { typ: "E", typ_text: "Einzelvertretung" } },
        ],
      }), { status: 200 });
    }
    if (u.includes("search")) {
      return new Response(JSON.stringify({
        results: [{ fn: "195777h", name: "Georg Traugott GmbH", former_names: null }],
      }), { status: 200 });
    }
    throw new Error("unerwarteter fetch: " + u);
  });

  const v = await execTool(fi, "firmenindex_vertretung", { fn: "195777h", stichtag: "2025-01-27" });
  assert.equal(v.vertretungsbefugte[0].name, "Katrin Traugott");

  const k = await execTool(fi, "namens_konsistenz", { fn: "195777h", erwarteter_name: "Georg Traugott GmbH" });
  assert.equal(k.status, "konsistent_direkt");
});

test("namens_konsistenz löst Umbenennung über former_names (HoRa-Vorfall)", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    results: [
      { fn: "131696x", name: "HoRa Immo & Trading GmbH", former_names: ["KONSTANT Arbeitsschutz GmbH"] },
    ],
  }), { status: 200 }));
  const k = await execTool(fi, "namens_konsistenz", { fn: "131696x", erwarteter_name: "KONSTANT Arbeitsschutz GmbH" });
  assert.equal(k.status, "konsistent_umbenannt");
  assert.match(k.hinweis, /Umbenennung/);
});

test("Schritt 6: schreiben + READ-BACK bestätigt den Fakt im Bestand", async (t) => {
  process.env.FB_PI_FAKT_WRITE_TOKEN = "e2e-token";
  t.mock.method(globalThis, "fetch", async () => new Response(
    JSON.stringify({ ok: true, written: "meta.gf_stand" }), { status: 200 },
  ));

  const payload = {
    fn: "195777h", fn_quelle: "sidecar:2025-01-21 Firmenbuchauszug.pdf",
    stichtag: "2025-01-27", quelle: "firmenindex/vertretung",
    vertretungsbefugte: [
      { name: "Katrin Traugott", funktion: "GF", seit: "2014-02-06", bis: null, befugnis: "Einzelvertretung" },
    ],
    unsicherheiten: [],
  };
  const r = await execTool(sc, "audit_meta_schreiben", {
    project: "Arbeitsschuhe", bidder: "Georg Traugott GmbH", payload,
  });
  assert.equal(r.ok, true);

  // Read-back ging durchs Tool — jetzt noch unabhängig gegen den Bestand:
  // (der Fake-Endpoint schrieb nichts; der Read-back muss daher ok:false
  // melden ODER wir simulieren den Endpunkt-Effekt. Wir prüfen beides:)
  assert.equal(r.read_back.ok, false, "ohne echten Write muss read_back.ok=false + grund");

  // Endpunkt-Effekt simulieren (so wie es fakt_write täte) → read_back wird wahr:
  const audit = JSON.parse(readFileSync(path.join(BID, "audit.json"), "utf8"));
  audit.meta.gf_stand = {
    ...payload, stand: "vollständig",
    _provenance: { agent: "fb-pi@0.3.0-test", ts: "now" },
  };
  writeFileSync(path.join(BID, "audit.json"), JSON.stringify(audit));

  const r2 = await execTool(sc, "audit_meta_schreiben", {
    project: "Arbeitsschuhe", bidder: "Georg Traugott GmbH", payload,
  });
  assert.equal(r2.read_back.ok, true, "mit stehendem Fakt muss read_back.ok=true");
  assert.equal(r2.read_back.n_vertretungsbefugte, 1);
  delete process.env.FB_PI_FAKT_WRITE_TOKEN;
});

test("Bericht-Gate: prose+fenced JSON valid, defekter Bericht schlägt fehl", () => {
  const mission = ladeMissionen("missionen").get("gf_stand")!;
  const gut = 'Vorbemerkung des Modells.\n```json\n{"fn":"195777h","fn_quelle":"sidecar:x","stichtag":"2025-01-27","vertretungsbefugte":[{"name":"Katrin"}],"quelle":"firmenindex/vertretung","unsicherheiten":[]}\n```\n';
  const v = validiereBericht(gut, mission);
  assert.equal(v.ok, true);
  assert.equal((v.bericht as any).fn, "195777h");

  const kaputt = 'Ich konnte leider kein JSON liefern.';
  assert.equal(validiereBericht(kaputt, mission).ok, false);

  const fehltFeld = '```json\n{"stichtag":"2025-01-27"}\n```';
  assert.equal(validiereBericht(fehltFeld, mission).ok, false);
  assert.match(validiereBericht(fehltFeld, mission).fehler ?? "", /quelle|vertretungsbefugte/);
});
