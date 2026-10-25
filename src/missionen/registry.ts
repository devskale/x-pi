/** Mission-Registry — datengetrieben (Blaupause §2): eine Mission ist ein
 * Paar `<name>.config.json` + `<name>.prompt.md` im Missionen-Dir. Neue
 * Mission = neue Dateien, KEINE Harness-Änderung. Der Job wählt per `fakt`. */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

export interface Mission {
  fakt: string;
  name: string;
  systemPrompt: string;
  userPrompt(params: { project: string; bidder: string; fn?: string; stichtag?: string }): string;
  bericht: { required: string[]; fnNullable: boolean };
  schreiben: { fakt: string; enabled: boolean };
}

export interface MissionJob {
  project: string;
  bidder: string;
  fn?: string;
  stichtag?: string;
  fakt: string;
}

export function isMissionJob(x: unknown): x is MissionJob {
  if (typeof x !== "object" || x === null) return false;
  const j = x as Record<string, unknown>;
  return typeof j.project === "string" && typeof j.bidder === "string" && typeof j.fakt === "string";
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

export function ladeMissionen(dir: string): Map<string, Mission> {
  const abs = path.resolve(process.cwd(), dir);
  const out = new Map<string, Mission>();
  if (!existsSync(abs)) return out;
  for (const f of readdirSync(abs).sort()) {
    if (!f.endsWith(".config.json")) continue;
    const base = f.slice(0, -".config.json".length);
    let cfg: Record<string, unknown>;
    try {
      cfg = JSON.parse(readFileSync(path.join(abs, f), "utf8"));
    } catch {
      continue; // kaputte Config überspringen laut (Registry wirft beim Zugriff)
    }
    const fakt = String(cfg.fakt ?? "");
    const promptFile = String(cfg.promptFile ?? `${base}.prompt.md`);
    const promptPath = path.join(abs, promptFile);
    if (!fakt || !existsSync(promptPath)) continue;
    const systemPrompt = readFileSync(promptPath, "utf8");
    const cfgAny = cfg as any;
    out.set(fakt, {
      fakt,
      name: String(cfg.name ?? fakt),
      systemPrompt,
      userPrompt: (p) => {
        const vars: Record<string, string> = {
          project: p.project,
          bidder: p.bidder,
          fn: p.fn ?? "",
          stichtag: p.stichtag ?? "",
          fn_hinweis: fill(String(cfgAny.fnHinweis ?? ""), { fn: p.fn ?? "" }),
          fn_hinweis_fehlend: String(cfgAny.fnHinweisFehlend ?? ""),
          stichtag_hinweis: fill(String(cfgAny.stichtagHinweis ?? ""), { stichtag: p.stichtag ?? "" }),
          stichtag_hinweis_fehlend: String(cfgAny.stichtagHinweisFehlend ?? ""),
        };
        return fill(String(cfgAny.userPrompt ?? "Job {fakt} für {bidder} in {project}. Beginne jetzt."), vars)
          .replace("{fn_hinweis}", p.fn ? vars.fn_hinweis : vars.fn_hinweis_fehlend)
          .replace("{stichtag_hinweis}", p.stichtag ? vars.stichtag_hinweis : vars.stichtag_hinweis_fehlend);
      },
      bericht: {
        required: Array.isArray(cfgAny.bericht?.required) ? cfgAny.bericht.required : [],
        fnNullable: cfgAny.bericht?.fnNullable !== false,
      },
      schreiben: {
        fakt: String(cfgAny.schreiben?.fakt ?? fakt),
        enabled: cfgAny.schreiben?.enabled !== false,
      },
    });
  }
  return out;
}
