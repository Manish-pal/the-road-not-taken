import type { Candidate, Decision, Point } from "@/lib/route-switch-engine";

type Props = {
  candidates: Candidate[];
  decision: Decision;
  selected: number;
  origin: Point | null;
  dest: Point | null;
  names: [string, string];
  pos: Point | null;
  progress: number;
  track: Point[];
  liveRun: boolean;
  interactive: boolean;
  onPick: (point: Point) => void;
  onSelect: (index: number) => void;
};

function pts(points: Point[]) {
  return points.map((p) => p.join(",")).join(" ");
}

function color(c: Candidate, decision: Decision) {
  if (c.closed) return "var(--c-closed)";
  if (c === decision.rec) return "var(--c-rec)";
  if (c === decision.base) return "var(--c-fam)";
  return "var(--c-muted)";
}

export function RouteMap({
  candidates,
  decision,
  selected,
  origin,
  dest,
  names,
  pos,
  progress,
  track,
  liveRun,
  interactive,
  onPick,
  onSelect,
}: Props) {
  const ordered = candidates.map((c, i) => ({ c, i })).sort((a, b) => (a.i === selected ? 1 : b.i === selected ? -1 : 0));

  return (
    <svg
      viewBox="0 0 600 400"
      role="application"
      aria-label="Route map. Click to set an origin, then a destination."
      className={`block w-full rounded-xl bg-map ${interactive ? "cursor-crosshair" : "cursor-default"}`}
      onClick={(e) => {
        if (!interactive) return;
        const r = e.currentTarget.getBoundingClientRect();
        onPick([((e.clientX - r.left) / r.width) * 600, ((e.clientY - r.top) / r.height) * 400]);
      }}
    >
      <defs>
        <pattern id="rnt-grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M30 0H0V30" fill="none" stroke="var(--c-line)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="600" height="400" fill="url(#rnt-grid)" />
      {ordered.map(({ c, i }) => {
        const active = i === selected;
        return (
          <g key={c.name}>
            <polyline
              points={pts(c.pts)}
              fill="none"
              stroke="transparent"
              strokeWidth="18"
              className={interactive ? "cursor-pointer" : undefined}
              onClick={(e) => {
                e.stopPropagation();
                if (interactive) onSelect(i);
              }}
            />
            <polyline
              points={pts(c.pts)}
              fill="none"
              stroke={color(c, decision)}
              strokeWidth={active ? 8 : 3}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={active ? 1 : 0.72}
              strokeDasharray={c.closed ? "7 6" : undefined}
              pointerEvents="none"
            />
          </g>
        );
      })}
      {liveRun && track.length > 1 && (
        <polyline points={pts(track)} fill="none" stroke="var(--c-gold)" strokeWidth="3" strokeLinecap="round" />
      )}
      {!liveRun && progress > 0 && candidates[selected] && (
        <polyline
          points={pts(candidates[selected].pts)}
          fill="none"
          stroke="var(--c-gold)"
          strokeWidth="5"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={`${progress} 1`}
        />
      )}
      {origin && (
        <g>
          <circle cx={origin[0]} cy={origin[1]} r="8" fill="var(--c-gold)" stroke="var(--c-ink)" strokeWidth="2" />
          <text x={origin[0] + 12} y={origin[1] - 10} fontSize="13" fill="var(--c-fg)" fontFamily="inherit">
            {names[0]}
          </text>
        </g>
      )}
      {dest && (
        <g>
          <rect
            x={dest[0] - 6}
            y={dest[1] - 6}
            width="12"
            height="12"
            transform={`rotate(45 ${dest[0]} ${dest[1]})`}
            fill="var(--c-closed)"
            stroke="var(--c-ink)"
            strokeWidth="1.5"
          />
          <text x={dest[0] + 12} y={dest[1] - 10} fontSize="13" fill="var(--c-fg)" fontFamily="inherit">
            {names[1]}
          </text>
        </g>
      )}
      {pos && (
        <g>
          <circle cx={pos[0]} cy={pos[1]} r="14" fill="none" stroke="var(--c-gold)" strokeWidth="2" opacity="0.85" />
          <circle cx={pos[0]} cy={pos[1]} r="6" fill="var(--c-gold)" stroke="var(--c-ink)" strokeWidth="2" />
        </g>
      )}
    </svg>
  );
}
