/** stdout-JSONL-Protokoll — der Wrapper (robotni) leitet jede Zeile weiter.
 * Phase-0-Vertrag (docs/fb-pi-plan-2026-10-25.md §4): fbpi/{t,...} je Zeile. */

export type ProtokollEvent = Record<string, unknown> & { t: string };

export function emit(ev: ProtokollEvent, out: NodeJS.WriteStream = process.stdout): void {
  out.write(JSON.stringify(ev) + "\n");
}
