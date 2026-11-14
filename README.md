# HavenLens

The home page embeds Matterport-hosted scans. Supply shareable tour IDs at build time in the ignored .env.local file using HAVENLENS_TOURS, a JSON array of objects with title and id strings. An optional floorLabels array lists names verified in the tour’s own Floor Selector. Omit it when coverage is unknown. Optional coverage text describes the known extent of a capture. Selecting a configured space updates the page URL so a visitor can share that tour directly. Configured IDs are visible to viewers. Do not put tokens in this list. Visitors can also open a Matterport share URL.

The separate /training page is a synthetic six-floor training viewer built with Next.js, TypeScript, Tailwind, React Three Fiber and Drei. Select a floor in the model or inspector. Orbit, zoom or pan the model and use Reset camera to restore its initial view. Play, pause, scrub or reset the 30-second **Fire on Floor 6** scenario. The orange incident marker pulses from second 4. Two blue occupant markers appear at second 10 and a purple responder marker appears at second 18. All locations and times are authored. This demonstration provides no operational guidance, fire prediction, live tracking or validated routes.

## Run

Use Node 22.12 or later. Run `npm ci` followed by `npm run dev` and open the localhost address printed in the terminal. Use `npm run typecheck` and `npm run build` for checks.

## Private context adapters

The training page always uses its synthetic model. Run these optional commands on a trusted local machine. The adapters print only a small metadata summary. Keep licensed files outside the repository.

- CoStar: `npm run context -- costar /absolute/path/to/commercial-property.jsonl PROPERTY_ID`. Reads the supplied offline kit. Missing attributes remain null. The kit provides no live endpoint.
- Vexcel: after rotating the exposed key, set VEXCEL_API_KEY in the ignored .env.local file. Run `npm run context -- vexcel LONGITUDE LATITUDE` for one authorized parcel query. Requires coverage and entitlement to property/extract. No data is saved by the adapter. HTTP 404 and empty collections return no matching record.
- Matterport: rotate the exposed credentials and obtain the separate connection kit, SDK domain authorization and access to a specific model. Verify model coverage and permissions before integrating any scan. Keep replacement credentials in .env.local and never use a NEXT_PUBLIC_ variable for a secret.

## Deploy

Run `npm ci && npm run build` and publish the generated `out/` directory to a static host. For a local production preview, run `python3 -m http.server 3000 --directory out` and open http://localhost:3000. The export includes tour references and the separate training demo. Scan imagery streams from Matterport. Provider commands run separately on your machine.
