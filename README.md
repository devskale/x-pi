# x-pi

**Generischer Fakt-/Methoden-Agent auf pi-SDK-Basis** — One-shot-CLI,
Missionen als Datendateien, Tools als Packs. Referenzimplementierung der
piagent+tools-Blaupause (`works/kontext.one/docs/piagent-tools-blaupause-2026-10-25.md`).

Erste Mission: **gf_stand** (Firmenbuch — vertretungsbefugte Personen zum
Stichtag aus dem firmenindex als Fakt in `audit.json meta.gf_stand`).

## Architektur (8 Schichten — Details in der Blaupause)

```
L7 TRIGGER      Precheck-Gap → robotni task_fakt_agent → Spawn (nie blockierend)
L6 SCHREIBPFAD  fakt_write (robotni-API): Token · Whitelist · Schema · Provenance
L5 PROTOKOLL    stdout-JSONL: job_start → status → tool_call/result → bericht → job_end
L4 TOOLS        Kern (kontext/status/schreiben) + TOOLPACKS (firmenbuch, …)
L3 MISSIONEN    missionen/*.config.json + *.prompt.md — reine DATEN
L2 PROVIDER     ModelRuntime.registerProvider → uniinfer/Edge (env→credgoo→hart)
L1 HARNESS      pi-SDK: inMemory-Session, noTools:"builtin", Prompt=Mission
L0 PROZESSFORM  One-shot: x-pi --job '<json>' | --job-b64 <b64> | --selftest
```

## Struktur

```
src/
  run.ts            CLI (Job → Session → Mission → Bericht; bericht_valid = Gate)
  konfig.ts         ENV > x-pi.config.json > Defaults (keine Hardcodings)
  provider.ts       uniinfer/Edge (openai-completions, kein Custom-Stream)
  protokoll.ts      JSONL-Emitter
  bericht.ts        JSON-Extraktion (3-stufig) + Missions-Vertrags-Validierung
  missionen/
    registry.ts     Verzeichnis-Scan: *.config.json + *.prompt.md
  tools/            KERN-Tools (domain-frei): kontext (OFS-RO), status, schreiben
  toolpacks/
    firmenbuch.ts   firmenindex (search/vertretung/namens_konsistenz) + fn_ermitteln
missionen/          gfStand.config.json + gfStand.prompt.md (DATEN — neue Mission ohne Code)
test/               19 hermetische Tests inkl. Missions-Fake-E2E
```

## Erweitern

| Ziel | Weg |
|---|---|
| **Neue Mission** | `missionen/<name>.{config.json,prompt.md}` + fakt_write-Whitelist-Eintrag — 0 Code |
| **Neues Toolpack** (Datenquelle) | `src/toolpacks/<name>.ts` mit Factory + Eintrag in `x-pi.config.json → toolpacks` |
| **Neuer Fakt-Typ** | fakt_write: Whitelist + Schema; Konsument: deterministic_point + Filter |

## Konfiguration (Betrieb — Verträge bleiben Code)

`X_PI_MODEL, X_PI_PROVIDER_URL, X_PI_CONFIG, X_PI_OFS_BASE, X_PI_FAKT_URL,
X_PI_MISSIONEN_DIR, X_PI_FAKT_WRITE_TOKEN, UNIINFER_GATEWAY_TOKEN,
FIRMENINDEX_TOKEN, FIRMENINDEX_API` — Präzedenz: ENV > x-pi.config.json > Defaults.

## Entwicklung

```bash
pnpm install && pnpm test        # hermetisch (kein LLM/Netz)
npx tsx src/run.ts --selftest    # Live-Beweis (echter Edge-Call)
```

## Geschichte

Geboren als **fb-pi** (Firmenbuch-Fakt-Agent, Issue fb-pi-bauen, Phasen 0–3
+ Trigger-E2E bewiesen 2026-10-25) und zu **x-pi** verallgemeinert — das
Firmenbuch wurde zum ersten Toolpack statt Identität.
