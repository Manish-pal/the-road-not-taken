/** RouteSwitchEngine — pure decision service for Phase 1.
 *  A switch is offered only when time saved clears a threshold.
 *  The weighted score ranks those alternatives; it does not outvote a habit by itself.
 */

export type Point = [number, number];
export type Scenario = "free" | "heavy" | "closed" | "live";
export type Traffic = "free" | "heavy" | null;

export type Candidate = {
  id: number;
  name: string;
  pts: Point[];
  km: number;
  traffic: Traffic;
  closed: boolean;
  eta: number;
};

export type Journey = {
  o?: Point;
  d?: Point;
  pts?: Point[];
  min?: number;
  km?: number;
  src?: "live" | "sim" | "seed";
  status: "completed" | "interrupted";
  ts: number;
};

export type ScoreMap = Map<Candidate, number>;

export type Decision = {
  mode: "none" | "standard" | "familiar" | "switch";
  reason: string;
  rec?: Candidate;
  base?: Candidate;
  saving?: number;
  th?: number;
  scores?: ScoreMap;
};

type Hist = { c: Candidate; uses: number; avg: number | null; last: number };

export const UNIT_M = 30;
export const ROUTE_NAMES = ["Bend A", "Direct", "Bend B"] as const;
export const WEIGHTS = { eta: 30, hist: 25, traffic: 15, dist: 10, fam: 10 } as const;
const SPEED = [46, 32, 42];
const TRAFFIC_SCORE: Record<"free" | "heavy", number> = { free: 1, heavy: 0.5 };
const JAM = 1.6;

export const PRESETS: { origin: Point; dest: Point; scenario: Exclude<Scenario, "live"> }[] = [
  { origin: [110, 300], dest: [470, 110], scenario: "free" },
  { origin: [110, 300], dest: [470, 110], scenario: "heavy" },
  { origin: [110, 300], dest: [470, 110], scenario: "closed" },
];

export function round1(v: number) {
  return Math.round(v * 10) / 10;
}

export function round2(v: number) {
  return Math.round(v * 100) / 100;
}

export function dist(p: Point, q: Point) {
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

export function pathLength(pts: Point[]) {
  return pts.reduce((sum, q, i) => (i ? sum + dist(q, pts[i - 1]) : sum), 0);
}

function meanPointDistance(a: Point[], b: Point[]) {
  const n = Math.min(a.length, b.length);
  if (!n) return Infinity;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += dist(a[i], b[i]);
  return sum / n;
}

export function near(a: Point[], b: Point[]) {
  return meanPointDistance(a, b) < 14;
}

export function acceptFix(accuracy: number | null | undefined) {
  return typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy <= 50;
}

export function threshold(streak: number) {
  return streak >= 3 ? 6 : 3;
}

export function resample(track: Point[]): Point[] {
  if (!track.length) return [];
  return Array.from({ length: 16 }, (_, i) => track[Math.round((i * (track.length - 1)) / 15)]);
}

export function finalize(f: {
  arrived: boolean;
  track: Point[];
  min?: number;
  km?: number;
}): { status: "completed" | "interrupted"; pts?: Point[]; min?: number; km?: number } {
  if (f.arrived && f.track.length >= 3 && f.min != null && f.km != null) {
    return { status: "completed", pts: resample(f.track), min: f.min, km: f.km };
  }
  return { status: "interrupted" };
}

export function project(lat: number, lng: number, ref: { lat: number; lng: number }): Point {
  return [
    300 + ((lng - ref.lng) * Math.cos((ref.lat * Math.PI) / 180) * 111320) / UNIT_M,
    200 - ((lat - ref.lat) * 110540) / UNIT_M,
  ];
}

function curves(a: Point, b: Point): Point[][] {
  const L = dist(a, b) || 1;
  const nx = -(b[1] - a[1]) / L;
  const ny = (b[0] - a[0]) / L;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  return [-1, 0, 1].map((s) => {
    const cx = mx + nx * s * 0.28 * L;
    const cy = my + ny * s * 0.28 * L;
    const pts: Point[] = [];
    for (let i = 0; i < 16; i++) {
      const t = i / 15;
      const u = 1 - t;
      pts.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]]);
    }
    return pts;
  });
}

export function candidates(a: Point, b: Point, scenario: Scenario): Candidate[] {
  return curves(a, b).map((pts, i) => {
    const km = (pathLength(pts) * UNIT_M) / 1000;
    const traffic: Traffic = scenario === "live" ? null : scenario === "heavy" && i === 1 ? "heavy" : "free";
    return {
      id: i,
      name: ROUTE_NAMES[i],
      pts,
      km,
      traffic,
      closed: scenario === "closed" && i === 1,
      eta: ((km / SPEED[i]) * 60) * (traffic === "heavy" ? JAM : 1),
    };
  });
}

export function stat(c: Candidate, journeys: Journey[]) {
  const matched = journeys.filter((j) => j.status === "completed" && j.pts && near(j.pts, c.pts));
  return {
    uses: matched.length,
    avg: matched.length ? matched.reduce((s, j) => s + (j.min ?? 0), 0) / matched.length : null,
    last: matched.length ? matched[matched.length - 1].ts : 0,
  };
}

function score(rows: Hist[]): ScoreMap {
  const hasHist = rows.every((x) => x.avg != null);
  const hasTraffic = rows.every((x) => x.c.traffic);
  const minEta = Math.min(...rows.map((x) => x.c.eta));
  const minKm = Math.min(...rows.map((x) => x.c.km));
  const maxUses = Math.max(...rows.map((x) => x.uses)) || 1;
  const minHist = hasHist ? Math.min(...rows.map((x) => x.avg as number)) : 0;
  const map: ScoreMap = new Map();
  for (const x of rows) {
    const terms: Record<string, [number, number]> = {
      eta: [WEIGHTS.eta, minEta / x.c.eta],
      dist: [WEIGHTS.dist, minKm / x.c.km],
      fam: [WEIGHTS.fam, x.uses / maxUses],
    };
    if (hasHist) terms.hist = [WEIGHTS.hist, minHist / (x.avg as number)];
    if (hasTraffic && x.c.traffic) terms.traffic = [WEIGHTS.traffic, TRAFFIC_SCORE[x.c.traffic]];
    let w = 0;
    let s = 0;
    for (const key in terms) {
      w += terms[key][0];
      s += terms[key][0] * terms[key][1];
    }
    map.set(x.c, w ? s / w : 0);
  }
  return map;
}

export function decide(list: Candidate[], journeys: Journey[], streak: number): Decision {
  const open = list.filter((c) => !c.closed);
  if (!open.length) return { mode: "none", reason: "Every route is closed right now." };
  const rows = open.map((c) => ({ c, ...stat(c, journeys) }));
  const scores = score(rows);
  const fast = rows.reduce((a, b) => (b.c.eta < a.c.eta ? b : a)).c;
  if (!rows.some((x) => x.uses)) {
    return {
      mode: "standard",
      rec: fast,
      scores,
      reason: "No personal history yet, so this is the fastest current estimate.",
    };
  }
  const base = rows.reduce((a, b) => (b.uses > a.uses || (b.uses === a.uses && b.last > a.last) ? b : a)).c;
  const th = threshold(streak);
  const alts = rows.filter((x) => x.c !== base && base.eta - x.c.eta >= th);
  if (!alts.length) {
    return {
      mode: "familiar",
      rec: base,
      base,
      scores,
      th,
      reason: "Your familiar route is still the best choice right now.",
    };
  }
  const best = alts.reduce((a, b) => ((scores.get(b.c) ?? 0) > (scores.get(a.c) ?? 0) ? b : a)).c;
  return {
    mode: "switch",
    rec: best,
    base,
    saving: base.eta - best.eta,
    th,
    scores,
    reason: "",
  };
}

export function lastMatchingIndex(list: Candidate[], journeys: Journey[], origin: Point, dest: Point) {
  for (let k = journeys.length - 1; k >= 0; k--) {
    const j = journeys[k];
    if (j.status === "completed" && j.o && j.d && j.pts && dist(j.o, origin) < 4 && dist(j.d, dest) < 4) {
      const idx = list.findIndex((c) => near(j.pts as Point[], c.pts));
      if (idx >= 0) return idx;
    }
  }
  return -1;
}

export type TestRow = { id: string; name: string; status: "pass" | "fail" | "skip" };

export function runSelfTests(): TestRow[] {
  const base = candidates([110, 300], [470, 110], "free");
  const C = (i: number, eta: number, km: number, traffic: Traffic, closed = false): Candidate => ({
    id: i,
    name: ROUTE_NAMES[i],
    pts: base[i].pts,
    km,
    eta,
    traffic,
    closed,
  });
  const J = (c: Candidate, n: number, min: number, t0: number): Journey[] =>
    Array.from({ length: n }, (_, k) => ({ status: "completed" as const, pts: c.pts, min, ts: t0 + k }));

  const cases: [string, string, () => boolean][] = [
    [
      "A",
      "Ten uses of the familiar route, which is also fastest: keep it",
      () => {
        const list = [C(1, 21, 12.2, "free"), C(0, 25, 12.8, "free")];
        const x = decide(list, [...J(list[0], 10, 21, 1), ...J(list[1], 1, 25, 99)], 0);
        return x.mode === "familiar" && x.rec === list[0];
      },
    ],
    [
      "B",
      "Familiar route in heavy traffic, alternative meaningfully faster: switch",
      () => {
        const list = [C(1, 40, 12.2, "heavy"), C(0, 31, 12.8, "free")];
        const x = decide(list, [...J(list[0], 10, 25, 1), ...J(list[1], 1, 31, 99)], 0);
        return x.mode === "switch" && x.rec === list[1];
      },
    ],
    [
      "C",
      "Equal distance, different times, no history: faster route wins",
      () => {
        const list = [C(0, 24, 13, "free"), C(2, 26, 13, "free")];
        const x = decide(list, [], 0);
        return x.rec === list[0] && (x.scores?.get(list[0]) ?? 0) > (x.scores?.get(list[1]) ?? 0);
      },
    ],
    [
      "E",
      "Shorter route is closed: never recommended",
      () => {
        const list = [C(1, 14, 11, "free", true), C(0, 25, 12.8, "free")];
        const x = decide(list, J(list[0], 8, 14, 1), 0);
        return x.rec === list[1] && !x.rec.closed;
      },
    ],
    [
      "F",
      "Three rejections in a row raise the threshold from 3 to 6 minutes",
      () => {
        const list = [C(1, 22, 12.2, "free"), C(0, 18, 12.8, "free")];
        const js = [...J(list[0], 9, 22, 1), ...J(list[1], 1, 18, 99)];
        return decide(list, js, 0).mode === "switch" && decide(list, js, 3).mode === "familiar";
      },
    ],
    [
      "G",
      "No journey history: standard recommendation",
      () => decide([C(1, 22, 12.2, "free"), C(0, 18, 12.8, "free")], [], 0).mode === "standard",
    ],
    [
      "H",
      "Interrupted or poor-GPS journeys are never counted",
      () => {
        const list = [C(1, 22, 12.2, "free")];
        const f = finalize({ arrived: false, track: [[1, 1], [2, 2], [3, 3]] });
        const g = finalize({ arrived: true, track: [[1, 1]], min: 1, km: 0 });
        return (
          f.status === "interrupted" &&
          g.status === "interrupted" &&
          !acceptFix(120) &&
          decide(list, [{ status: "interrupted", pts: list[0].pts, min: 20, ts: 1 }], 0).mode === "standard"
        );
      },
    ],
  ];

  const rows: TestRow[] = cases.map(([id, name, fn]) => {
    let ok = false;
    try {
      ok = !!fn();
    } catch {
      ok = false;
    }
    return { id, name, status: ok ? "pass" : "fail" };
  });
  rows.push({
    id: "D",
    name: "Mid-journey switching is deferred to Phase 3",
    status: "skip",
  });
  return rows;
}

export const RouteSwitchEngine = {
  candidates,
  decide,
  stat,
  finalize,
  acceptFix,
  runSelfTests,
  lastMatchingIndex,
  project,
  threshold,
};
