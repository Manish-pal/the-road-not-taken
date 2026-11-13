import type { Journey } from "@/lib/route-switch-engine";

const KEY = "rnt-phase1";

export type ThemeChoice = "light" | "dark";

export type Memory = {
  j: Journey[];
  p: { paused: boolean; streak: number; theme?: ThemeChoice };
};

export const EMPTY_MEMORY: Memory = { j: [], p: { paused: false, streak: 0 } };

export function loadMemory(): Memory {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY_MEMORY;
    const parsed = JSON.parse(raw) as Partial<Memory>;
    return {
      j: Array.isArray(parsed.j) ? parsed.j : [],
      p: {
        paused: !!parsed.p?.paused,
        streak: typeof parsed.p?.streak === "number" ? parsed.p.streak : 0,
        theme: parsed.p?.theme === "light" || parsed.p?.theme === "dark" ? parsed.p.theme : undefined,
      },
    };
  } catch {
    return EMPTY_MEMORY;
  }
}

export function saveMemory(memory: Memory) {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* private mode / quota — the session still works */
  }
}
