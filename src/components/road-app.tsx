import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical, History, MapPin, Moon, Sun, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RouteMap } from "@/components/route-map";
import { cn } from "@/lib/cn";
import { EMPTY_MEMORY, loadMemory, saveMemory, type Memory, type ThemeChoice } from "@/lib/route-memory";
import {
  PRESETS,
  RouteSwitchEngine,
  WEIGHTS,
  candidates,
  decide,
  dist,
  lastMatchingIndex,
  pathLength,
  project,
  round1,
  round2,
  runSelfTests,
  stat,
  threshold,
  type Candidate,
  type Decision,
  type Journey,
  type Point,
  type Scenario,
  type TestRow,
} from "@/lib/route-switch-engine";

type Run = {
  live: boolean;
  candidate: Candidate;
  t0: number;
  track: Point[];
  raf?: number;
  wid?: number;
};

const SIM_MS = 7000;

function applyTheme(theme: ThemeChoice | undefined) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function currentTheme(): ThemeChoice {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function RoadApp() {
  const [memory, setMemory] = useState<Memory>(EMPTY_MEMORY);
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState(false);
  const [scenario, setScenario] = useState<Exclude<Scenario, "live">>("free");
  const [origin, setOrigin] = useState<Point | null>(null);
  const [dest, setDest] = useState<Point | null>(null);
  const [names, setNames] = useState<[string, string]>(["A", "B"]);
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [pos, setPos] = useState<Point | null>(null);
  const [progress, setProgress] = useState(0);
  const [track, setTrack] = useState<Point[]>([]);
  const [locked, setLocked] = useState<Decision | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>("light");
  const [tests, setTests] = useState<TestRow[] | null>(null);
  const [exported, setExported] = useState("");
  const [confirmWipe, setConfirmWipe] = useState(false);

  const memoryRef = useRef(memory);
  memoryRef.current = memory;
  const runRef = useRef<Run | null>(null);
  const refRef = useRef<{ lat: number; lng: number } | null>(null);
  const planRef = useRef({ origin, dest });
  planRef.current = { origin, dest };

  const commit = useCallback((next: Memory) => {
    memoryRef.current = next;
    setMemory(next);
    saveMemory(next);
  }, []);

  useEffect(() => {
    const stored = loadMemory();
    memoryRef.current = stored;
    setMemory(stored);
    applyTheme(stored.p.theme);
    setTheme(stored.p.theme ?? currentTheme());
    setReady(true);
  }, []);

  useEffect(() => {
    return () => {
      const r = runRef.current;
      if (!r) return;
      if (r.raf) cancelAnimationFrame(r.raf);
      if (r.wid != null && typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.clearWatch(r.wid);
      }
    };
  }, []);

  const model = useMemo(() => {
    if (!origin || !dest) {
      const decision: Decision = { mode: "none", reason: "" };
      return { candidates: [] as Candidate[], decision };
    }
    const list = candidates(origin, dest, live ? "live" : scenario);
    return { candidates: list, decision: decide(list, memory.j, memory.p.streak) };
  }, [origin, dest, live, scenario, memory.j, memory.p.streak]);

  const shown = locked ?? model.decision;

  useEffect(() => {
    if (running || !origin || !dest) return;
    const li = lastMatchingIndex(model.candidates, memory.j, origin, dest);
    const rec = model.decision.rec;
    const recIndex = rec ? model.candidates.indexOf(rec) : 0;
    setSelected(li >= 0 ? li : Math.max(0, recIndex));
  }, [origin, dest, scenario, live, memory.j, memory.p.streak, running, model.candidates, model.decision.rec]);

  function stopHandles(r: Run | null) {
    if (!r) return;
    if (r.raf) cancelAnimationFrame(r.raf);
    if (r.wid != null && navigator.geolocation) navigator.geolocation.clearWatch(r.wid);
  }

  function finish(input: { arrived: boolean; track: Point[]; min?: number; km?: number }) {
    const r = runRef.current;
    if (!r) return;
    const result = RouteSwitchEngine.finalize(input);
    const plan = planRef.current;
    const mem = memoryRef.current;
    stopHandles(r);
    runRef.current = null;
    setRunning(false);
    setLocked(null);
    setPos(null);
    setProgress(0);
    setTrack([]);

    if (!plan.origin || !plan.dest) {
      setMessage("Journey ended before a route was stored.");
      return;
    }
    if (mem.p.paused) {
      setMessage("Recording is paused, so nothing was stored.");
      return;
    }
    const rec: Journey = {
      o: [round1(plan.origin[0]), round1(plan.origin[1])],
      d: [round1(plan.dest[0]), round1(plan.dest[1])],
      src: r.live ? "live" : "sim",
      status: result.status,
      ts: Date.now(),
    };
    if (result.status === "completed" && result.pts && result.min != null && result.km != null) {
      rec.pts = result.pts.map((p) => [round1(p[0]), round1(p[1])]);
      rec.min = round1(result.min);
      rec.km = round2(result.km);
    }
    commit({ ...mem, j: [...mem.j, rec] });
    setMessage(
      result.status === "completed"
        ? "Journey recorded. This road will count next time."
        : "Journey marked interrupted. No route usage was recorded.",
    );
  }

  function frame(t: number) {
    const r = runRef.current;
    if (!r || r.live) return;
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 700 : SIM_MS;
    const p = Math.min(1, (t - r.t0) / duration);
    const path = r.candidate.pts;
    const f = p * (path.length - 1);
    const k = Math.min(path.length - 2, Math.floor(f));
    const w = f - k;
    const next: Point = [path[k][0] + (path[k + 1][0] - path[k][0]) * w, path[k][1] + (path[k + 1][1] - path[k][1]) * w];
    setPos(next);
    setProgress(p);
    if (p < 1) r.raf = requestAnimationFrame(frame);
    else {
      finish({
        arrived: true,
        track: path,
        min: r.candidate.eta * (0.95 + Math.random() * 0.1),
        km: r.candidate.km,
      });
    }
  }

  function onFix(position: GeolocationPosition) {
    const r = runRef.current;
    const plan = planRef.current;
    if (!r || !r.live || !plan.dest || !refRef.current) return;
    if (!RouteSwitchEngine.acceptFix(position.coords.accuracy)) {
      setMessage(`GPS fix is ${Math.round(position.coords.accuracy)} m. Waiting for 50 m or better.`);
      return;
    }
    const q = project(position.coords.latitude, position.coords.longitude, refRef.current);
    r.track.push(q);
    setTrack(r.track.slice());
    setPos(q);
    if (dist(q, plan.dest) < 2) {
      finish({
        arrived: true,
        track: r.track,
        min: (Date.now() - r.t0) / 60000,
        km: (pathLength(r.track) * 30) / 1000,
      });
    }
  }

  function go(index: number) {
    if (runRef.current) return;
    const c = model.candidates[index];
    if (!c || c.closed || !origin || !dest) return;
    if (live && typeof navigator !== "undefined" && !navigator.geolocation) {
      setMessage("This browser has no geolocation.");
      return;
    }
    if (shown.mode === "switch" && shown.rec) {
      const streak = c === shown.rec ? 0 : memory.p.streak + 1;
      commit({ ...memory, p: { ...memory.p, streak } });
    }
    const run: Run = {
      live,
      candidate: c,
      t0: live ? Date.now() : performance.now(),
      track: [],
    };
    runRef.current = run;
    setLocked(shown);
    setSelected(index);
    setRunning(true);
    setProgress(0);
    setTrack([]);
    setPos(live ? null : c.pts[0]);
    if (live) {
      run.wid = navigator.geolocation.watchPosition(onFix, (err) => setMessage(`GPS error: ${err.message}`), {
        enableHighAccuracy: true,
      });
      setMessage("Live tracking started. Keep this tab open — a browser cannot follow you in the background.");
    } else {
      run.raf = requestAnimationFrame(frame);
      setMessage("Simulated journey started.");
    }
  }

  function stopJourney() {
    const r = runRef.current;
    if (!r) return;
    finish({ arrived: false, track: r.track });
  }

  function resetPlan() {
    if (running) return;
    setOrigin(null);
    setDest(null);
    setNames(["A", "B"]);
    setMessage("");
    setPos(null);
    setProgress(0);
  }

  function setLiveMode(next: boolean) {
    if (running) return;
    setLive(next);
    setOrigin(null);
    setDest(null);
    setNames(["A", "B"]);
    setPos(null);
    setProgress(0);
    setMessage(next ? "Live mode. Use your location, then click a destination." : "Back to simulated journeys.");
  }

  function useGps() {
    if (!navigator.geolocation) {
      setMessage("This browser has no geolocation.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        refRef.current = { lat: p.coords.latitude, lng: p.coords.longitude };
        setOrigin([300, 200]);
        setDest(null);
        setNames(["You", "Destination"]);
        setMessage("Origin set from your location. Click the map to choose a destination.");
      },
      (err) => setMessage(`Could not read location: ${err.message}`),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  function loadPreset(i: number) {
    if (running) return;
    const p = PRESETS[i];
    setLive(false);
    setScenario(p.scenario);
    setOrigin([p.origin[0], p.origin[1]]);
    setDest([p.dest[0], p.dest[1]]);
    setNames(["Sector 19C", "CP67"]);
    setMessage("Preset loaded. Seed history to see route memory at work.");
  }

  function seed() {
    if (running) return;
    let a = origin;
    let b = dest;
    if (!a || !b || live) {
      const p = PRESETS[0];
      a = [p.origin[0], p.origin[1]];
      b = [p.dest[0], p.dest[1]];
      setLive(false);
      setScenario("free");
      setOrigin(a);
      setDest(b);
      setNames(["Sector 19C", "CP67"]);
    }
    const list = candidates(a, b, "free");
    const t = Date.now();
    const mk = (c: Candidate, ts: number): Journey => ({
      o: [round1(a![0]), round1(a![1])],
      d: [round1(b![0]), round1(b![1])],
      pts: c.pts.map((p) => [round1(p[0]), round1(p[1])]),
      km: round2(c.km),
      min: round1(c.eta * (0.96 + Math.random() * 0.08)),
      src: "seed",
      status: "completed",
      ts,
    });
    const extra: Journey[] = [];
    for (let k = 9; k >= 1; k--) extra.push(mk(list[1], t - k * 864e5));
    extra.push(mk(list[2], t - 36e5));
    commit({ ...memoryRef.current, j: [...memoryRef.current.j, ...extra] });
    setMessage("Seeded 9 journeys on Direct and 1 on Bend B.");
  }

  function onMap(point: Point) {
    if (running) return;
    if (live) {
      if (!origin) {
        setMessage("Press Use my location first.");
        return;
      }
      setDest(point);
    } else if (!origin || dest) {
      setOrigin(point);
      setDest(null);
      setNames(["A", "B"]);
    } else {
      setDest(point);
    }
    setMessage("");
  }

  function toggleTheme() {
    const next: ThemeChoice = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    commit({ ...memoryRef.current, p: { ...memoryRef.current.p, theme: next } });
  }

  function exportJson() {
    const text = JSON.stringify({ journeys: memory.j, prefs: memory.p }, null, 1);
    setExported(text);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "road-not-taken.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function wipe() {
    commit({ j: [], p: { ...memory.p, streak: 0 } });
    setConfirmWipe(false);
    setExported("");
    setMessage("History deleted.");
  }

  const completed = memory.j.filter((j) => j.status === "completed").length;
  const th = threshold(memory.p.streak);
  const lastIdx =
    origin && dest ? lastMatchingIndex(model.candidates, memory.j, origin, dest) : -1;
  const hint = running
    ? "Journey running."
    : !origin
      ? live
        ? "Live mode: press Use my location first."
        : "Click the map to set your origin."
      : !dest
        ? "Click the map to set the destination."
        : live
          ? "Live candidates are geometric estimates. No traffic provider is connected."
          : "Simulated times use a speed model and the traffic scenario above.";

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <Mark />
            <div>
              <p className="text-xs font-medium tracking-widest text-muted uppercase">Phase 1 prototype</p>
              <h1 className="font-display text-2xl leading-tight font-medium text-balance">
                The Road <span className="text-gold italic">Not Taken</span>
              </h1>
              <p className="text-sm text-pretty text-muted">Every road remembers. Every journey learns.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-11 items-center rounded-full border border-line px-3 text-xs font-medium tracking-wider text-muted uppercase">
              {live ? "Live GPS" : "Simulated"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={live}
              aria-label="Live GPS"
              disabled={running}
              onClick={() => setLiveMode(!live)}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-panel pr-3 pl-1.5 text-sm disabled:opacity-40"
            >
              <span className={cn("relative h-7 w-12 rounded-full p-0.5", live ? "bg-gold" : "bg-line")}>
                <span
                  className={cn(
                    "absolute top-0.5 left-0.5 size-6 rounded-full bg-panel shadow transition-transform duration-150",
                    live && "translate-x-5",
                  )}
                />
              </span>
              Live GPS
            </button>
            <Button variant="ghost" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={toggleTheme} className="size-11 px-0">
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-4 lg:grid-cols-5">
        <section className="rounded-2xl border border-line bg-panel p-3 lg:col-span-3 sm:p-4">
          <div className="relative">
            <RouteMap
              candidates={model.candidates}
              decision={shown}
              selected={selected}
              origin={origin}
              dest={dest}
              names={names}
              pos={pos}
              progress={progress}
              track={track}
              liveRun={!!runRef.current?.live && running}
              interactive={!running}
              onPick={onMap}
              onSelect={(i) => {
                if (!running) setSelected(i);
              }}
            />
            {!origin && (
              <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-muted">
                {live ? "Use your location, then choose a destination." : "Click to place an origin"}
              </p>
            )}
            {origin && !dest && (
              <p className="pointer-events-none absolute bottom-3 left-0 w-full text-center text-sm text-muted">
                Now click a destination
              </p>
            )}
          </div>
          {running && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-line" aria-hidden>
              <div className="h-full bg-gold transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <Legend className="bg-rec" label="Recommended" />
            <Legend className="bg-fam" label="Familiar" />
            <Legend className="bg-closed" label="Closed" dashed />
            <Legend className="bg-muted" label="Alternative" />
            <Legend className="bg-gold" label="Live track" />
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="scen">
              Traffic scenario
            </label>
            <select
              id="scen"
              aria-label="Traffic scenario"
              disabled={live || running}
              value={scenario}
              onChange={(e) => setScenario(e.target.value as Exclude<Scenario, "live">)}
              className="h-11 rounded-xl border border-line bg-bg px-3 text-sm text-fg disabled:opacity-40"
            >
              <option value="free">Free-flowing traffic</option>
              <option value="heavy">Heavy traffic on Direct</option>
              <option value="closed">Direct route closed</option>
            </select>
            <Button onClick={() => loadPreset(0)} disabled={running}>
              Habitual route
            </Button>
            <Button onClick={() => loadPreset(1)} disabled={running}>
              Congestion
            </Button>
            <Button onClick={() => loadPreset(2)} disabled={running}>
              Closure
            </Button>
            <Button onClick={seed} disabled={running}>
              Seed history
            </Button>
            {live && (
              <Button variant="gold" onClick={useGps} disabled={running}>
                <MapPin className="size-4" />
                Use my location
              </Button>
            )}
          </div>
          <p className="mt-3 text-sm text-pretty text-muted">{hint}</p>
        </section>

        <aside className="flex flex-col gap-4 lg:col-span-2">
          <section className="rounded-2xl border border-line bg-panel p-4">
            <p className="text-xs font-medium tracking-widest text-muted uppercase">RouteSwitchEngine</p>
            {!origin || !dest ? (
              <div className="mt-3">
                <h2 className="font-display text-xl font-medium">Plan a journey</h2>
                <ol className="mt-3 space-y-2 text-sm text-pretty text-muted">
                  <li>1. Place an origin, or load the habitual route.</li>
                  <li>2. Place a destination. Three roads appear.</li>
                  <li>3. Seed history if you want the engine to remember a habit.</li>
                </ol>
              </div>
            ) : (
              <>
                <h2 className="mt-1 font-display text-xl font-medium">Candidate routes</h2>
                <div className="mt-3 flex flex-col gap-2">
                  {model.candidates.map((c, i) => {
                    const st = stat(c, memory.j);
                    const s = shown.scores?.get(c);
                    const tags = [
                      c.closed ? "Closed" : "",
                      c === shown.base ? "Familiar" : "",
                      c === shown.rec ? "Recommended" : "",
                    ].filter(Boolean);
                    return (
                      <button
                        key={c.name}
                        type="button"
                        onClick={() => {
                          if (!running) setSelected(i);
                        }}
                        className={cn(
                          "flex items-start justify-between gap-3 rounded-xl border px-3 py-3 text-left transition-colors duration-150",
                          i === selected ? "border-gold bg-gold-soft" : "border-line bg-bg hover:border-gold",
                        )}
                      >
                        <span>
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{c.name}</span>
                            {tags.map((tag) => (
                              <span key={tag} className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                                {tag}
                              </span>
                            ))}
                          </span>
                          <span className="mt-1 block text-sm text-pretty text-muted tabular-nums">
                            {c.km.toFixed(1)} km · {c.closed ? "closed" : `${c.eta.toFixed(0)} min est.`}
                            {c.traffic ? ` · ${c.traffic} traffic` : live ? " · no traffic data" : ""}
                            {` · used ${st.uses}×`}
                            {st.avg != null ? ` · avg ${st.avg.toFixed(0)} min` : ""}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className="font-display text-xl tabular-nums">{s != null ? Math.round(s * 100) : "–"}</span>
                          <span className="block text-xs text-muted">score</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {shown.mode === "switch" && shown.base && shown.rec && !running && (
                  <div className="mt-3 rounded-xl border border-gold bg-bg px-3 py-3">
                    <p className="font-display text-lg font-medium">Remember this road?</p>
                    <p className="mt-1 text-sm text-pretty text-muted">
                      {lastIdx >= 0 ? `You took ${model.candidates[lastIdx].name} last time. ` : ""}
                      {shown.base.name} is your familiar route, but {shown.rec.name} is estimated to save{" "}
                      {shown.saving?.toFixed(0)} min.
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Button className="w-full sm:w-auto" onClick={() => go(model.candidates.indexOf(shown.base!))}>
                        Take my familiar route
                      </Button>
                      <Button variant="gold" className="w-full sm:w-auto" onClick={() => go(model.candidates.indexOf(shown.rec!))}>
                        Show the faster route
                      </Button>
                    </div>
                  </div>
                )}
                {shown.mode !== "switch" && shown.reason && !running && (
                  <p className="mt-3 rounded-xl border border-line bg-bg px-3 py-3 text-sm text-pretty">{shown.reason}</p>
                )}
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  {running ? (
                    <Button onClick={stopJourney}>Stop journey</Button>
                  ) : (
                    <>
                      <Button
                        variant={shown.mode === "switch" ? "ghost" : "gold"}
                        className="w-full sm:w-auto"
                        disabled={!model.candidates[selected] || model.candidates[selected].closed}
                        onClick={() => go(selected)}
                      >
                        {shown.mode === "switch"
                          ? "Continue with my selected route"
                          : `Start ${live ? "live" : "simulated"} journey`}
                      </Button>
                      <Button onClick={resetPlan}>Clear</Button>
                    </>
                  )}
                </div>
                <p className="mt-3 text-xs text-pretty text-muted">
                  Weights {WEIGHTS.eta} time, {WEIGHTS.hist} history, {WEIGHTS.traffic} traffic, {WEIGHTS.dist} distance,{" "}
                  {WEIGHTS.fam} familiarity. Safety is left out — there is no reliable signal, so a missing one is never
                  read as safe. The score ranks alternatives. A switch is offered only when the time saved is at least{" "}
                  {th} min.
                </p>
              </>
            )}
            <p className="mt-3 min-h-5 text-sm text-pretty" role="status">
              {message}
            </p>
          </section>

          <section className="rounded-2xl border border-line bg-panel p-4">
            <div className="flex items-center gap-2">
              <History className="size-4 text-gold" aria-hidden />
              <h2 className="font-display text-xl font-medium">Route memory</h2>
            </div>
            <p className="mt-1 text-sm text-muted tabular-nums">
              {ready ? completed : "–"} completed · asks at {th} min after {memory.p.streak} rejection
              {memory.p.streak === 1 ? "" : "s"}
            </p>
            <div className="mt-2 flex gap-1" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span key={i} className={cn("h-1.5 w-8 rounded-full", i < Math.min(memory.p.streak, 3) ? "bg-gold" : "bg-line")} />
              ))}
            </div>
            <div className="mt-3 divide-y divide-line">
              {memory.j.length === 0 && <p className="py-3 text-sm text-muted">No journeys yet.</p>}
              {memory.j
                .slice(-6)
                .reverse()
                .map((j, i) => (
                  <p key={`${j.ts}-${i}`} className="py-2 text-sm text-muted tabular-nums">
                    {new Date(j.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {" · "}
                    {j.src === "seed" ? "Seeded" : j.src === "live" ? "Live" : "Simulated"}
                    {" · "}
                    <span className={j.status === "interrupted" ? "text-closed" : undefined}>{j.status}</span>
                    {j.status === "completed" ? ` · ${j.km} km · ${j.min} min` : ""}
                  </p>
                ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="inline-flex h-11 items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  className="size-4 accent-gold"
                  checked={memory.p.paused}
                  onChange={(e) => commit({ ...memory, p: { ...memory.p, paused: e.target.checked } })}
                />
                Pause recording
              </label>
              <Button onClick={exportJson}>Export JSON</Button>
              {confirmWipe ? (
                <>
                  <Button variant="gold" onClick={wipe}>
                    Delete history
                  </Button>
                  <Button onClick={() => setConfirmWipe(false)}>Cancel</Button>
                </>
              ) : (
                <Button onClick={() => setConfirmWipe(true)}>
                  <Trash2 className="size-4" />
                  Delete all history
                </Button>
              )}
            </div>
            {exported && (
              <pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-bg p-3 text-xs break-all whitespace-pre-wrap text-muted">
                {exported}
              </pre>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-panel p-4">
            <div className="flex items-center gap-2">
              <FlaskConical className="size-4 text-gold" aria-hidden />
              <h2 className="font-display text-xl font-medium">Self-test</h2>
            </div>
            <p className="mt-1 text-sm text-pretty text-muted">
              Checks the decision engine against the Phase 1 cases. Mid-journey switching waits for Phase 3.
            </p>
            <Button className="mt-3" onClick={() => setTests(runSelfTests())}>
              Run test suite
            </Button>
            {tests && (
              <ul className="mt-3 space-y-2">
                {tests.map((row) => (
                  <li key={row.id} className="flex gap-2 text-sm">
                    <span
                      className={cn(
                        "mt-0.5 inline-flex h-5 w-12 shrink-0 items-center justify-center rounded-full text-xs font-medium tracking-wide uppercase",
                        row.status === "pass" && "border border-rec text-rec",
                        row.status === "fail" && "border border-closed text-closed",
                        row.status === "skip" && "border border-line text-muted",
                      )}
                    >
                      {row.status}
                    </span>
                    <span className="text-pretty">
                      <span className="font-medium">{row.id}</span> {row.name}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </main>
    </div>
  );
}

function Legend({ className, label, dashed }: { className: string; label: string; dashed?: boolean }) {
  return (
    <li className="inline-flex items-center gap-2">
      <span className={cn("h-1 w-6 rounded-full", className, dashed && "opacity-80")} />
      {label}
    </li>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="size-11 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--c-gold-soft)" />
      <path d="M9 24C9 15 16 16 16 8" fill="none" stroke="var(--c-gold)" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 8C16 16 23 15 23 24" fill="none" stroke="var(--c-rec)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
