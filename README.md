# fb-pi

Firmenbuch-Fakt-Agent auf **pi-SDK**-Basis — One-shot-CLI, Mission `gf_stand`.
Plan: `works/kontext.one/docs/fb-pi-plan-2026-10-25.md` · Issue: `fb-pi-bauen`.

## Architektur (Phase 0)

```
fb-pi run --job '<json>'   # robotni spawnt (Phase 2)
fb-pi run --selftest       # Phase-0-Beweis: Session + Edge + Tool-Call
```

- **Session:** pi-SDK `createAgentSession` mit `SessionManager.inMemory()`
  (One-shot — kein Session-Gedächtnis), `noTools: "builtin"` (nur eigene Tools),
  `systemPromptOverride` = Missions-Prompt.
- **Provider:** `ModelRuntime.registerProvider("uniinfer-edge", …)` — OpenAI-
  kompatibler uniinfer-Gateway (`uniinfer.skale.dev/v1`, hab-Route → DGX
  vLLM), `api: "openai-completions"` ohne Custom-Stream. Token: env
  `UNIINFER_GATEWAY_TOKEN` oder `credgoo uniinfer` — fehlt beides: HARTER
  Fehler (Plan §5, nie stiller Fallback).
- **Protokoll:** stdout-JSONL (`{t:"job_start"|"status"|"tool_call"|
  "tool_result"|"bericht"|"usage"|"job_end"}`) — der robotni-Wrapper leitet
  weiter.
- **Fallback-Entscheidung (Phase 0): SDK statt CLI-Subprocess.** Der Custom
  Provider läuft stabil über den SDK-Pfad (openai-completions direkt, Usage/
  Abbruch von pi übernommen) — kein Grund für den CLI-Subprocess-Umweg.

## Entwicklung

```bash
pnpm install
pnpm test        # hermetisch (kein LLM, kein Netz)
pnpm selftest    # Live-Beweis (echter Edge-Call)
```

## Phasen-Status

- [x] **0 Gerüst** — bewiesen 2026-10-25: Session auf pi5, Edge-Call mit
      Usage-Telemetrie, Tool-Orchestrierung im Protokoll (selftest-Log im
      Issue fb-pi-bauen)
- [ ] 1 Beschaffung — echte firmenindex-Tools + projekt_lesen + Missions-Prompt
- [ ] 2 Schreiben + Trigger — fakt_write-Endpunkt + robotni-Wrapper
- [ ] 3 Ops — Konto, repos.yml, health, Drossel
