/** Bericht-Extraktion + -Validierung gegen den Missions-Vertrag.
 * Dreistufige JSON-Extraktion (fenced → größtes balanciertes JSON → roh) —
 * Modelle schreiben gern Prosa um das JSON. Gates: required-Felder aus der
 * Missions-Config; invalid ⇒ Lauf fehlgeschlagen (Blaupause §4.7). */

import type { Mission } from "./missionen/registry.js";

export function extractJson(txt: string): string | null {
  const fenced = txt.match(/```json\s*([\s\S]*?)```/);
  if (fenced) return fenced[1]!;
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

export function validiereBericht(antwort: string, mission: Mission): BerichtValidierung {
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
