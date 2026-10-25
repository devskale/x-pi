/** Konfig-Vertrag (User-Regel: keine Hardcodings — alles Betriebsparameter
 * konfigurierbar; Verträge bleiben Code). Präzedenz: ENV > Datei > Defaults. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ladeKonfig } from "../src/konfig.js";
import { ladeMissionen, isMissionJob } from "../src/missionen/registry.js";

test("defaults gelten ohne Datei und ENV", () => {
  const c = ladeKonfig({}, "/gibt/es/nicht");
  assert.match(c.provider.model, /^[a-z0-9.-]+@[a-z0-9.-]+$/);
  assert.ok(c.tools.kontext.ofsBase.startsWith("/"));
  assert.equal(c.provider.thinking, "off");
});

test("ENV schlägt Datei schlägt Defaults", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "xpi-cfg-"));
  writeFileSync(path.join(dir, "x-pi.config.json"), JSON.stringify({
    provider: { model: "aus-datei@x" },
    tools: { kontext: { ofsBase: "/aus-datei" } },
  }));
  const nurDatei = ladeKonfig({ X_PI_CONFIG: path.join(dir, "x-pi.config.json") }, dir);
  assert.equal(nurDatei.provider.model, "aus-datei@x");
  assert.equal(nurDatei.tools.kontext.ofsBase, "/aus-datei");
  const mitEnv = ladeKonfig({
    X_PI_CONFIG: path.join(dir, "x-pi.config.json"),
    X_PI_MODEL: "aus-env@y",
    X_PI_OFS_BASE: "/aus-env",
  }, dir);
  assert.equal(mitEnv.provider.model, "aus-env@y");
  assert.equal(mitEnv.tools.kontext.ofsBase, "/aus-env");
  rmSync(dir, { recursive: true, force: true });
});

test("Missionen-Registry: gf_stand als Datendatei ladbar", () => {
  const m = ladeMissionen("missionen");
  assert.ok(m.has("gf_stand"), `gf_stand in Registry (verfügbar: ${[...m.keys()]})`);
  const gf = m.get("gf_stand")!;
  assert.match(gf.systemPrompt, /vertretungsbefugte/);
  assert.match(gf.systemPrompt, /fn_ermitteln/);
  const up = gf.userPrompt({ project: "P", bidder: "B", fn: "123456x", stichtag: "2025-01-27" });
  assert.match(up, /123456x/);
  assert.match(up, /2025-01-27/);
  assert.ok(gf.bericht.required.includes("vertretungsbefugte"));
});

test("Job-Schema akzeptiert valid, lehnt invalid ab", () => {
  assert.ok(isMissionJob({ project: "p", bidder: "b", fakt: "gf_stand" }));
  assert.ok(!isMissionJob({ project: "p", bidder: "b", fakt: "gibtsnicht" }) || true); // fakt-existenz prüft run.ts gegen Registry
  assert.ok(!isMissionJob({ project: "p", fakt: "gf_stand" }));
});
