/** Bericht-Extraktion + -Validierung gegen den Missions-Vertrag.
 * Dreistufige JSON-Extraktion (fenced → größtes balanciertes JSON → roh) —
 * Modelle schreiben gern Prosa um das JSON. Gates: required-Felder aus der
 * Missions-Config; invalid ⇒ Lauf fehlgeschlagen (Blaupause §4.7). */

import type { Mission } from "./missionen/registry.js";

export function extractJson(txt: string): string | null {
  // LETZTE ```json-Fence gewinnt (Vorfall sammeldok_index/SCHÜTZE 27.10.):
  // Agenten mit mehreren Blöcken (Zwischenergebnis + Abschluss) liefern die
  // vollständige Struktur im LETZTEN — die erste Fence war ein Partial.
  const fences = [...txt.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (fences.length) return fences[fences.length - 1]![1]!;
  let best: string | null = null;
  for (let i = txt.indexOf("{"); i !== -1; i = txt.indexOf("{", i + 1)) {
    let tiefe = 0, inStr = false, esc = false;
    for (let j = i; j < txt.length; j++) {
      const c = txt[j]!;
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') inStr = !inStr;
      if (inStr) continue;
      if (c === "{") tiefe++;
      else if (c === "}") {
        tiefe--;
        if (tiefe === 0) {
          const k = txt.slice(i, j + 1);
          if (!best || k.length > best.length) best = k;
          break;
        }
      }
    }
  }
  return best;
}

export interface BerichtValidierung {
  ok: boolean;
  fehler?: string;
  bericht?: Record<string, unknown>;
}

export function validiereBericht(antwort: string | undefined | null, mission: Mission): BerichtValidierung {
  // Vorfall 2026-11-10: tote Provider-Route (hab 500) → getLastAssistantText()
  // undefined → matchAll-Crash statt klarer Fehlermeldung. Fail-loud, nie crash.
  if (typeof antwort !== "string" || !antwort.trim()) {
    return { ok: false, fehler: "keine Antwort vom Modell (Provider/Route tot oder leer)" };
  }
  const raw = extractJson(antwort) ?? antwort.slice(0, 20000);
  try {
    const b = JSON.parse(raw.trim()) as Record<string, unknown>;
    const fehlt = mission.bericht.required.filter((k) => !(k in b));
    if (fehlt.length) return { ok: false, fehler: `fehlend: ${fehlt.join(",")}`, bericht: b };
    if (!mission.bericht.fnNullable && typeof b.fn !== "string") {
      return { ok: false, fehler: "fn muss string sein (Mission verlangt belegt)", bericht: b };
    }
    return { ok: true, bericht: b };
  } catch (e) {
    return { ok: false, fehler: String(e).slice(0, 120) };
  }
}
