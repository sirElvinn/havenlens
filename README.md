# HavenLens

Firefighters often arrive knowing little about a building. HavenLens turns CoStar building records into a planning brief: who is likely inside right now, who may need help getting out, how each floor should leave, and what is still unknown.

Built at HackPrinceton Fall '26 for the CoStar Group track. Project page: https://devpost.com/software/havenlens

## What it does

- **Who is likely inside, by hour.** Occupancy is estimated from CoStar units, hotel rooms and tenant headcounts and scaled by typical hourly patterns. On the same records, 13 buildings rank as high fire priority at 2 PM and 244 at 3 AM.
- **Fire, flood and blackout.** Each hazard re-scores every building with its own factors, and every score lists the points behind it.
- **Building briefs** that keep what CoStar records, what we estimate and what nobody knows yet apart.
- **Incident mode and planner.** Place a pin (or play a simulated 911 call) and the planner ranks nearby buildings, estimates evacuations, checks the exterior and staging lots, issues placards and writes a short plan. Report a change on scene and it re-plans and lists what changed.
- **3D evacuation model** built from each building's Vexcel outline and CoStar floor count, with per-floor instructions for each hazard and complications you can inject mid-evacuation.
- **Vexcel aerial checks:** hazards (solar panels, scaffolding, rooftop equipment), resources (hydrants, pools) and parked cars; image search for open staging lots, checked for cars before one is suggested.
- **Field verification.** Each building has a printable door placard with a QR code. A crew member answers "sprinklers: yes or no" on a phone and every screen updates within a few seconds, labelled unverified.
- **Live demo.** `/demo` runs a 1:55 guided walkthrough of the real app.

Every formula, rate and source is listed on the in-app **How we estimate** page (`/method`).

## Run it locally

You need:

- Node.js 22.12 or later and Python 3.10 or later
- The **CoStar data kit** from the hackathon organizers. It is licensed and **not included** in this repository.
- A **Vexcel API key** for imagery, outlines, detection and staging. Without it the app still runs, and the aerial features say they are not connected.
- Optional: an **Anthropic API key**. Without it the incident planner runs as a rule-based planner over the same tools.

```bash
npm ci

# 1. Build the building dossiers from the CoStar kit (writes git-ignored files to public/dossier-data/)
npm run dossiers -- /absolute/path/to/costar-kit

# 2. Keys go in .env.local (git-ignored)
#    VEXCEL_API_KEY=...
#    ANTHROPIC_API_KEY=...   (optional)

# 3. Start the API server (port 8787) in one terminal
npm run api

# 4. Start the app (port 3100) in another terminal
npm run dev -- -p 3100
```

Open http://localhost:3100.

Optional:

- `npm run precache -- 7556398 233905 246952` saves Vexcel responses for the demo buildings, so the live demo never waits on the network.
- `npm run build && npm run preview` serves the production build and the API together on http://localhost:3000.
- Placard QR codes use your computer's local network address, so a phone on the same Wi-Fi can open them.

## Pages

| Path | What it is |
| --- | --- |
| `/` | Home map |
| `/city` | City view: 24-hour clock, hazard switch, incident mode, simulated 911 call and the incident planner |
| `/building?id=<CoStar id>` | Building brief, people by hour, evacuation estimate, assembly route, Vexcel exterior, 3D model and placard |
| `/demo` | 1:55 guided demo |
| `/method` | How we estimate: every assumption and source |
| `/verify?id=<CoStar id>` | Field verification form opened from a placard QR code |

## How it is built

- `scripts/dossiers.py`: joins the CoStar datasets into one record per building, with occupancy estimates and priority factors
- `src/lib/`: scoring by hazard and hour (`scenario.ts`), evacuation estimates (`evacuation.ts`), the 3D floor plans and people flow (`twin.ts`), incident ranking (`incident.ts`), the planner and its tools (`agent.ts`), field reports (`reports.ts`)
- `server/`: Vexcel proxy and cache (`vexcel.mjs`), Claude agent endpoint (`agent.mjs`), field reports (`reports.mjs`). API keys stay on the server.
- `src/components/`: Next.js and React UI, Leaflet maps, three.js / react-three-fiber 3D model

Key methods (details on `/method`):

- Evacuation time: Pauls' formula from the SFPE Handbook, T = 0.68 + 0.081 · p^0.73 minutes, where p is people above the ground floor per metre of usable stair width. Shown as a range, with more time to start moving when people are likely asleep.
- Stairs: the building code minimum (IBC 1006.3.2), placed by the code's remoteness and travel-distance rules and labelled as assumed, because no dataset includes stair locations.
- People who may need help: 12% (CDC disability data), with higher planning rates for senior housing and healthcare.

## Data and privacy

- The CoStar kit and everything generated from it stay out of the repository (`public/dossier-data/` and `.cache/` are git-ignored).
- Contact names, emails and phone numbers in the kit are never exported.
- Occupancy is estimated, never tracked. No personal data is collected.

## Limitations

- Numbers are planning estimates and have not been checked by fire professionals.
- No dataset includes stair, exit or floor-plan locations, so the 3D model's stairs are assumed.
- HavenLens does not simulate fire, smoke or water. Scenarios change scoring and per-floor instructions.
- Field reports are unverified until an inspector confirms them.
