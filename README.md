# HavenLens

A synthetic six-floor training viewer built with Next.js, TypeScript, Tailwind, React Three Fiber and Drei. Select a floor in the model or inspector. Orbit, zoom or pan the model and use Reset camera to restore its initial view. Play, pause, scrub or reset the 30-second **Fire on Floor 6** scenario. The orange incident marker pulses from second 4. Two blue occupant markers appear at second 10 and a purple responder marker appears at second 18. All locations and times are authored. This demonstration provides no operational guidance, fire prediction, live tracking or validated routes.

## Run

Use Node 22.12 or later. Run `npm ci` followed by `npm run dev` and open the localhost address printed in the terminal. Use `npm run typecheck` and `npm run build` for checks.

## Private context adapters

The viewer always uses its synthetic model. Run these optional commands on a trusted local machine. The adapters print only a small metadata summary. Keep licensed files outside the repository.

- CoStar: `npm run context -- costar /absolute/path/to/commercial-property.jsonl PROPERTY_ID`. Reads the supplied offline kit. Missing attributes remain null. The kit provides no live endpoint.
- Vexcel: after rotating the exposed key, set VEXCEL_API_KEY in the ignored .env.local file. Run `npm run context -- vexcel LONGITUDE LATITUDE` for one authorized parcel query. Requires coverage and entitlement to property/extract. No data is saved by the adapter. HTTP 404 and empty collections return no matching record.
- Matterport: rotate the exposed credentials and obtain the separate connection kit, SDK domain authorization and access to a specific model. Verify model coverage and permissions before integrating any scan. Keep replacement credentials in .env.local and never use a NEXT_PUBLIC_ variable for a secret.
