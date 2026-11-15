// Server-side Vexcel adapter shared by the Worker (dist/server) and the local API (scripts/serve.mjs).
// The browser only ever sends a CoStar property id; coordinates and the API key stay on the server.
// This file must stay import-free: build-worker.mjs concatenates it into the Worker bundle.

const VEXCEL = "https://api.vexcelgroup.com/v2";
const LAYERS = "urban,urban-r,wide-area,urban-g";
const DIRECTIONS = ["oblique-north", "oblique-east", "oblique-south", "oblique-west"];
// Exterior conditions a first-due company would want to know about before arrival.
const HAZARD_LABELS = ["solar panel", "rooftop hvac unit", "parked car", "swimming pool", "construction scaffolding", "fire hydrant"];
const HAZARD_COLORS = ["rgb(255,196,0)", "rgb(0,229,255)", "rgb(255,64,255)", "rgb(80,170,255)", "rgb(255,120,0)", "rgb(255,64,64)"];

function json(data, status = 200, cache = "no-store") {
  return Response.json(data, { status, headers: { "Cache-Control": cache } });
}

async function call(key, method, path, { params, body } = {}) {
  const url = new URL(VEXCEL + "/" + path);
  if (params) url.search = new URLSearchParams(params).toString();
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      method,
      headers: { "X-API-KEY": key, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(method === "POST" ? 120000 : 60000),
    });
    if (response.status !== 429 || attempt >= 4) return response;
    await new Promise(r => setTimeout(r, Math.min(2 ** attempt, 16) * 1000 + Math.random() * 500));
  }
}

function squareAround(lon, lat, half) {
  const dlat = half / 111320, dlon = half / (111320 * Math.cos(lat * Math.PI / 180));
  const [w, e, s, n] = [lon - dlon, lon + dlon, lat - dlat, lat + dlat];
  return `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
}

function geometryToWkt(g) {
  if (typeof g === "string") return g;
  const ring = r => "(" + r.map(p => p[0] + " " + p[1]).join(",") + ")";
  if (g?.type === "Polygon") return "POLYGON(" + g.coordinates.map(ring).join(",") + ")";
  if (g?.type === "MultiPolygon") return "MULTIPOLYGON(" + g.coordinates.map(p => "(" + p.map(ring).join(",") + ")").join(",") + ")";
  return null;
}

function scalar(v) {
  return typeof v === "number" ? Math.round(v * 100) / 100 : typeof v === "string" || typeof v === "boolean" ? v : null;
}

// Pull the parcel, its attributes and the available oblique directions, once per building.
async function parcel(key, id, point, cache) {
  const cacheKey = `vexcel/${id}/parcel-v3.json`;
  const hit = await cache.get(cacheKey);
  if (hit) return JSON.parse(new TextDecoder().decode(hit.bytes));
  const [lon, lat] = point;
  const r = await call(key, "GET", "property/extract", { params: {
    wkt: `POINT(${lon} ${lat})`, srid: "4326", layer: LAYERS, latest: "true",
    include: "precomputed,footprint-wkt", "unit-system": "imperial" } });
  let attrs = {}, wkt = null, found = false;
  if (r.ok) {
    const data = await r.json();
    const feature = data.features?.[0];
    if (feature) { found = true; attrs = feature.properties || {}; wkt = geometryToWkt(feature.geometry); }
  } else if (r.status !== 404) {
    throw new Error("Vexcel parcel lookup failed (HTTP " + r.status + ")");
  }
  const area = wkt || squareAround(lon, lat, 45);
  let directions = [];
  const c = await call(key, "GET", "oriented/collections", { params: {
    wkt: area, srid: "4326", layer: "urban", "product-type": "oblique", include: "product-type,collection,last-capture-date" } });
  let captured = null;
  if (c.ok) {
    const features = (await c.json()).features || [];
    captured = features.reduce((m, f) => (f.properties?.["last-capture-date"] > (m || "") ? f.properties["last-capture-date"] : m), null);
    const available = new Set(features.filter(f => f.properties?.["last-capture-date"] === captured).map(f => f.properties["product-type"]));
    directions = DIRECTIONS.filter(d => available.has(d));
  }
  const structures = Array.isArray(attrs.structures) ? attrs.structures : [];
  const primary = structures.find(s => s["primary-structure"]) || structures[0] || {};
  const roofObjects = {};
  for (const s of structures) for (const [k, v] of Object.entries(s))
    if (k.startsWith("roof-objects.") && k.endsWith(".count") && v > 0) {
      const label = k.slice(13, -6).replace(/-/g, " ");
      roofObjects[label] = (roofObjects[label] || 0) + v;
    }
  const footprint = structures.reduce((t, s) => t + (Number(s["footprint.area"]) || 0), 0);
  // Outer rings of each structure's traced footprint, as [lon, lat] pairs (largest first, at most 6).
  const outlines = structures.map(s => ({ primary: Boolean(s["primary-structure"]), area: Number(s["footprint.area"]) || 0, ring: ringOf(s["footprint.wkt"]) }))
    .filter(o => o.ring.length >= 4).sort((a, b) => b.area - a.area).slice(0, 24);
  const summary = {
    found, parcelWkt: area, isFallbackArea: !wkt, directions, obliqueCaptured: captured,
    collection: scalar(attrs["metadata.collection"]),
    structureCount: scalar(attrs["structure.count"]) ?? (structures.length || null),
    footprintSqft: footprint ? Math.round(footprint) : null,
    roofMaterial: scalar(primary["roof-characteristics.material.class"]),
    roofShape: scalar(primary["roof-characteristics.shape.value"]),
    roofCondition: scalar(primary["roof-characteristics.condition"]),
    roofObjects,
    outlines,
    groundElevationFt: scalar(primary["ground-elevation.value"]),
    treeCoverPercent: scalar(attrs["parcel-tree-cover.percent"]),
    pool: scalar(attrs["pool.detected"]),
    buildingType: scalar(attrs["building-type.class"]),
    insideParcel: scalar(attrs["request-information.inside-parcel"]),
    retrieved: new Date().toISOString().slice(0, 10),
  };
  await cache.put(cacheKey, new TextEncoder().encode(JSON.stringify(summary)), "application/json");
  return summary;
}

async function image(key, id, view, area, cache) {
  const cacheKey = `vexcel/${id}/${view}.jpg`;
  const hit = await cache.get(cacheKey);
  if (hit) return hit.bytes;
  const outline = { wkt: area, "outline-width": 4 };
  const r = view === "ortho"
    ? await call(key, "POST", "ortho/extract", { body: {
        wkt: area, srid: 4326, layer: LAYERS, "buffer-meter": 15, crop: "bounding_box", "image-format": "jpeg",
        "destination-dimensions": "1000,1000", drawing: [{ ...outline, "outline-color": "rgb(255,204,0)" }] } })
    : await call(key, "POST", "oriented/extract", { body: {
        wkt: area, srid: 4326, layer: "urban", "product-type": view, rotation: "natural", "buffer-meter": 15,
        crop: "bbox", "image-format": "jpeg/png", "destination-dimensions": "1000,1000",
        drawing: [{ ...outline, "outline-color": "255,204,0", "fill-color": "255,204,0", transparency: 0 }] } });
  if (!r.ok) throw new Error("Vexcel imagery request failed (HTTP " + r.status + ")");
  const bytes = new Uint8Array(await r.arrayBuffer());
  await cache.put(cacheKey, bytes, "image/jpeg");
  return bytes;
}

async function detect(key, id, area, cache) {
  const cacheKey = `vexcel/${id}/detect.json`;
  const hit = await cache.get(cacheKey);
  if (hit) return JSON.parse(new TextDecoder().decode(hit.bytes));
  const request = { layer: LAYERS, srid: 4326, wkt: area, crop: "bounding_box" };
  const r = await call(key, "POST", "elements/detect", { body: {
    wkt: area, srid: 4326, "buffer-meter": 0,
    images: [{ endpoint: "ortho/extract", request }],
    "model-input": {
      elements: HAZARD_LABELS.map(label => ({ label, model: "sam3", "detection-threshold": 0.5 })),
      include: ["bbox", "confidence"] } } });
  if (!r.ok) throw new Error("Vexcel detection failed (HTTP " + r.status + ")");
  const data = await r.json();
  const found = [], drawing = [{ wkt: area, "outline-width": 3, "outline-color": "rgb(255,204,0)" }];
  for (const feature of data.features || []) {
    const label = feature.properties?.label;
    const color = HAZARD_COLORS[HAZARD_LABELS.indexOf(label)] || "rgb(255,255,255)";
    const detections = feature.properties?.detections || [];
    if (!detections.length) continue;
    // The API can return one feature per object, so merge features that share a label.
    const best = Math.round(Math.max(...detections.map(d => d.confidence || 0)) * 100) / 100;
    const existing = found.find(f => f.label === label);
    if (existing) { existing.count += detections.length; existing.best = Math.max(existing.best, best); }
    else found.push({ label, color, count: detections.length, best });
    for (const d of detections) if (d.bbox) drawing.push({ wkt: d.bbox, "outline-color": color, "outline-width": 3 });
  }
  let overlay = null;
  const o = await call(key, "POST", "ortho/extract", { body: { ...request, "image-format": "jpeg", "destination-dimensions": "1000,1000", drawing } });
  if (o.ok) {
    const bytes = new Uint8Array(await o.arrayBuffer());
    await cache.put(`vexcel/${id}/detect.jpg`, bytes, "image/jpeg");
    overlay = `/api/vexcel/${id}/detect.jpg`;
  }
  const result = { labels: HAZARD_LABELS, found, overlay, model: "sam3 open-vocabulary segmentation, threshold 0.5", retrieved: new Date().toISOString().slice(0, 10) };
  await cache.put(cacheKey, new TextEncoder().encode(JSON.stringify(result)), "application/json");
  return result;
}

function ringOf(wkt) {
  if (typeof wkt !== "string") return [];
  const first = wkt.indexOf("(("), end = wkt.indexOf(")", first);
  if (first < 0 || end < 0) return [];
  return wkt.slice(first + 2, end).split(",").map(p => p.trim().split(/\s+/).map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite));
}

function ringCenter(geometry) {
  let pts = [];
  if (typeof geometry === "string") {
    const nums = geometry.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  } else if (geometry?.type === "Polygon") pts = geometry.coordinates[0];
  else if (geometry?.type === "MultiPolygon") pts = geometry.coordinates[0][0];
  if (!pts.length) return null;
  return [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length];
}

function polygonAreaM2(geometry) {
  let pts = [];
  if (typeof geometry === "string") {
    const nums = geometry.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  } else if (geometry?.type === "Polygon") pts = geometry.coordinates[0];
  else if (geometry?.type === "MultiPolygon") pts = geometry.coordinates[0][0];
  if (pts.length < 3) return null;
  const k = 111320 * Math.cos(pts[0][1] * Math.PI / 180);
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += (x1 * k) * (y2 * 111320) - (x2 * k) * (y1 * 111320);
  }
  return Math.round(Math.abs(a) / 2);
}

function meters(a, b) {
  const dx = (b[0] - a[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), dy = (b[1] - a[1]) * 111320;
  return { dist: Math.hypot(dx, dy), dir: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360 / 45) % 8] };
}

// Candidate staging areas: open paved lots near the building, found by Vexcel's semantic image search.
async function staging(key, id, point, cache) {
  const cacheKey = `vexcel/${id}/staging-v2.json`;
  const hit = await cache.get(cacheKey);
  if (hit) return JSON.parse(new TextDecoder().decode(hit.bytes));
  const [lon, lat] = point;
  const r = await call(key, "POST", "embedding/extract", { body: {
    wkt: squareAround(lon, lat, 350), srid: 4326, "search-text": "large empty paved parking lot",
    include: "score,geometry,collection", "total-records": 20, "page-size": 20 } });
  if (!r.ok) throw new Error("Vexcel staging search failed (HTTP " + r.status + ")");
  const picks = [];
  for (const f of (await r.json()).features || []) {
    const c = ringCenter(f.geometry);
    if (!c) continue;
    const { dist, dir } = meters(point, c);
    if (dist < 50) continue; // skip the building's own lot
    if (picks.some(p => meters([p.lon, p.lat], c).dist < 90)) continue; // keep candidates spread out
    picks.push({ lon: c[0], lat: c[1], dist: Math.round(dist), dir, areaM2: polygonAreaM2(f.geometry), score: Math.round((f.properties?.score ?? 0) * 1000) / 1000, wkt: geometryToWkt(f.geometry) || f.geometry });
    if (picks.length === 3) break;
  }
  const candidates = [];
  for (const [i, p] of picks.entries()) {
    const img = await call(key, "POST", "ortho/extract", { body: { wkt: p.wkt, srid: 4326, layer: LAYERS, crop: "bounding_box", "destination-dimensions": "400,400", "image-format": "jpeg" } });
    if (img.ok) await cache.put(`vexcel/${id}/staging-${i}.jpg`, new Uint8Array(await img.arrayBuffer()), "image/jpeg");
    candidates.push({ lat: p.lat, lon: p.lon, dist: p.dist, dir: p.dir, areaM2: p.areaM2, score: p.score, wkt: p.wkt, image: img.ok ? `/api/vexcel/${id}/staging-${i}.jpg` : null });
  }
  const result = { query: "large empty paved parking lot", candidates, retrieved: new Date().toISOString().slice(0, 10) };
  await cache.put(cacheKey, new TextEncoder().encode(JSON.stringify(result)), "application/json");
  return result;
}

// Walking route on OpenStreetMap streets and paths (FOSSGIS foot router). Falls back to a straight line.
async function walkRoute(from, to) {
  try {
    const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`;
    const r = await fetch(url, { headers: { "User-Agent": "HavenLens hackathon prototype" }, signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const route = (await r.json()).routes?.[0];
      if (route?.geometry?.coordinates?.length) return { source: "osm", distanceM: Math.round(route.distance), path: route.geometry.coordinates.map(([x, y]) => [y, x]) };
    }
  } catch {}
  return { source: "straight", distanceM: Math.round(meters(from, to).dist * 1.3), path: [[from[1], from[0]], [to[1], to[0]]] };
}

// Assembly area: the nearest open-lot candidate outside the building's collapse zone, plus a walking route to it.
async function assembly(key, id, point, cache, minDist) {
  const cacheKey = `vexcel/${id}/assembly2-${minDist}.json`;
  const hit = await cache.get(cacheKey);
  if (hit) return JSON.parse(new TextDecoder().decode(hit.bytes));
  const s = await staging(key, id, point, cache);
  // Best image match outside the collapse zone (scores are relative within one search).
  const pick = [...s.candidates].filter(c => c.dist >= minDist).sort((a, b) => b.score - a.score)[0] ?? null;
  const result = { minDist, candidate: pick && (({ wkt, ...c }) => c)(pick), route: pick ? await walkRoute(point, [pick.lon, pick.lat]) : null, retrieved: new Date().toISOString().slice(0, 10) };
  await cache.put(cacheKey, new TextEncoder().encode(JSON.stringify(result)), "application/json");
  return result;
}

// Cross-check a staging candidate: are there parked cars or scaffolding on the lot right now (as of the imagery)?
async function stagingCheck(key, id, point, cache, index) {
  const cacheKey = `vexcel/${id}/staging-check-${index}.json`;
  const hit = await cache.get(cacheKey);
  if (hit) return JSON.parse(new TextDecoder().decode(hit.bytes));
  const s = await staging(key, id, point, cache);
  const c = s.candidates[index];
  if (!c || !c.wkt) throw new Error("Vexcel staging candidate not found");
  const labels = ["parked car", "construction scaffolding"];
  const r = await call(key, "POST", "elements/detect", { body: {
    wkt: c.wkt, srid: 4326, "buffer-meter": 0,
    images: [{ endpoint: "ortho/extract", request: { layer: LAYERS, srid: 4326, wkt: c.wkt, crop: "bounding_box" } }],
    "model-input": { elements: labels.map(label => ({ label, model: "sam3", "detection-threshold": 0.5 })), include: ["bbox", "confidence"] } } });
  if (!r.ok) throw new Error("Vexcel staging check failed (HTTP " + r.status + ")");
  const counts = { "parked car": 0, "construction scaffolding": 0 };
  for (const f of (await r.json()).features || []) counts[f.properties?.label] = (counts[f.properties?.label] || 0) + (f.properties?.detections?.length || 0);
  const area = c.areaM2 || 3600;
  const occupied = counts["parked car"] * 25;   // a parked car plus its share of aisle
  const free = Math.max(0, area - occupied);
  const status = counts["construction scaffolding"] > 0 ? "blocked" : occupied > area * 0.4 ? "blocked" : occupied > area * 0.15 ? "partly blocked" : "clear";
  const result = { index, cars: counts["parked car"], scaffolding: counts["construction scaffolding"], areaM2: area, freeM2: Math.round(free), status,
    note: "Detected in the latest Vexcel imagery, not live. A lot full of cars at capture time may be empty now, and the reverse." };
  await cache.put(cacheKey, new TextEncoder().encode(JSON.stringify(result)), "application/json");
  return result;
}

// Route: /api/vexcel/status | /api/vexcel/:id/(parcel|detect|ortho.jpg|oblique-*.jpg|detect.jpg)
export async function vexcel(request, { key, lookup, cache }) {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean); // ["api","vexcel",id,what]
  if (request.method !== "GET") return json({ error: "Unsupported method." }, 405);
  if (parts[2] === "status") return json({ configured: Boolean(key) });
  if (!key) return json({ error: "Live imagery is not configured. Set VEXCEL_API_KEY on the server." }, 503);
  const id = parts[2], what = parts[3];
  const point = /^\d{1,9}$/.test(id || "") ? lookup(Number(id)) : null;
  if (!point) return json({ error: "Unknown building." }, 404);
  try {
    if (what === "parcel") return json(await parcel(key, id, point, cache), 200, "private, max-age=86400");
    if (what === "staging") { const st = await staging(key, id, point, cache); return json({ ...st, candidates: st.candidates.map(({ wkt, ...c }) => c) }, 200, "private, max-age=86400"); }
    if (/^staging-check-[0-2]$/.test(what || "")) return json(await stagingCheck(key, id, point, cache, Number(what.slice(-1))), 200, "private, max-age=86400");
    if (what === "assembly") {
      const min = Math.round(Number(new URL(request.url).searchParams.get("min")) || 30);
      return json(await assembly(key, id, point, cache, Math.min(300, Math.max(30, min))), 200, "private, max-age=86400");
    }
    if (/^staging-[0-2]\.jpg$/.test(what || "")) {
      const hit = await cache.get(`vexcel/${id}/${what}`);
      return hit ? new Response(hit.bytes, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } }) : json({ error: "Run the staging search first." }, 404);
    }
    const p = await parcel(key, id, point, cache);
    if (what === "detect") return json(await detect(key, id, p.parcelWkt, cache), 200, "private, max-age=86400");
    const view = (what || "").replace(/\.jpg$/, "");
    if (view === "detect") {
      const hit = await cache.get(`vexcel/${id}/detect.jpg`);
      return hit ? new Response(hit.bytes, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } }) : json({ error: "Run detection first." }, 404);
    }
    if (view !== "ortho" && !(DIRECTIONS.includes(view) && p.directions.includes(view))) return json({ error: "That view is not available here." }, 404);
    const bytes = await image(key, id, view, p.parcelWkt, cache);
    return new Response(bytes, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  } catch (error) {
    // Never echo upstream bodies or headers: they can contain request details.
    return json({ error: error instanceof Error && error.message.startsWith("Vexcel") ? error.message : "Vexcel request failed." }, 502);
  }
}
