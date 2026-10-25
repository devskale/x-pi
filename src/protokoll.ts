/** stdout-JSONL-Protokoll — der Wrapper (robotni) leitet jede Zeile weiter.
 * Phase-0-Vertrag (docs/fb-pi-plan-2026-10-25.md §4): fbpi/{t,...} je Zeile. */

export type ProtokollEvent = Record<string, unknown> & { t: string };

const MAX_LINE_BYTES = 10 * 1024; // FUND 1: Worker-StreamReader stirbt bei Riesen-Zeilen

export function emit(ev: ProtokollEvent, out: NodeJS.WriteStream = process.stdout): void {
  let line = JSON.stringify(ev);
  if (line.length > MAX_LINE_BYTES) {
    // Kappen: Volltext-Felder als "<gekürzt, N Zeichen>" markieren
    for (const k of Object.keys(ev)) {
      const v = (ev as any)[k];
      if (typeof v === "string" && v.length > 512) {
        (ev as any)[k] = `<gekürzt, ${v.length} Zeichen>`;
      }
    }
    line = JSON.stringify(ev);
    if (line.length > MAX_LINE_BYTES) line = line.slice(0, MAX_LINE_BYTES) + '…"}';
  }
  out.write(line + "\n");
}
