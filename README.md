# The Road Not Taken

Phase 1 prototype. Every road remembers. Every journey learns.

Three candidate roads are drawn between an origin and a destination. RouteSwitchEngine offers a switch only when another open road saves real time (3 minutes, or 6 after three rejections in a row). The score ranks those alternatives. It does not, by itself, overrule a habit.

History stays in the browser. Simulated journeys are the default. Live GPS is a toggle and only tracks while the tab is open.

## Run

```bash
npm install
npm run dev
```

Open the app, then:

1. Seed history, then Habitual route. Direct is familiar. Bend A should save about 6 minutes.
2. Congestion grows the saving. Closure never recommends the closed road.
3. Show the faster route, or stop early (an interrupted journey records no usage).
4. Run test suite. A, B, C, E, F, G, and H pass. D is deferred to Phase 3.

## Not in this phase

Real road geometry, a traffic provider, mid-journey switching, and background tracking are later phases. Live drives rarely match these synthetic curves, so they mostly will not count as route usage until real geometry exists.
