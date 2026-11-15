// Pre-load every Vexcel result the demo needs for the given buildings, so the live demo never waits on the network.
//   node scripts/precache.mjs 7556398 246952 ...      (with `npm run api` running)
import { readFile } from "node:fs/promises";

const API = process.env.API || "http://localhost:8787";
const ids = process.argv.slice(2).map(Number).filter(Boolean);
const index = JSON.parse(await readFile(new URL("../public/dossier-data/index.json", import.meta.url), "utf8")).buildings;
const byId = new Map(index.map(b => [b.id, b]));

async function hit(path) {
  const t = Date.now();
  const r = await fetch(API + path);
  await r.arrayBuffer();
  return `${r.status} ${path} (${Date.now() - t} ms)`;
}

for (const id of ids) {
  const b = byId.get(id);
  if (!b) { console.log(`skip ${id}: not in index`); continue; }
  const heightM = b.heightFt ? b.heightFt * 0.3048 : (b.stories ?? 1) * (b.class === "residential" ? 3.1 : 3.8);
  const min = Math.max(30, Math.round(heightM * 1.5));
  console.log(`\n${b.name} (#${id})`);
  console.log(await hit(`/api/vexcel/${id}/parcel?v=3`));
  const parcel = await (await fetch(`${API}/api/vexcel/${id}/parcel`)).json();
  const jobs = [`/api/vexcel/${id}/ortho.jpg`, `/api/vexcel/${id}/detect`, `/api/vexcel/${id}/staging`, `/api/vexcel/${id}/assembly?min=${min}`,
    ...(parcel.directions ?? []).map(d => `/api/vexcel/${id}/${d}.jpg`)];
  for (const j of jobs) console.log(await hit(j));
  for (const i of [0, 1, 2]) console.log(await hit(`/api/vexcel/${id}/staging-check-${i}`));
}
