import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parcelSummary } from "./providers.mjs";

async function refresh() {
  const key = process.env.VEXCEL_API_KEY;
  if (!key) throw new Error("Set the rotated VEXCEL_API_KEY in .env.local before refreshing.");
  const points = JSON.parse(await readFile("private-data/parcel-points.json","utf8"));
  const result = {};
  for (const [model, [lon, lat]] of Object.entries(points)) {
    const parcel = await parcelSummary(lon, lat, key);
    result[model] = parcel && {
      collection:typeof parcel.collection === "string" || typeof parcel.collection === "number" ? String(parcel.collection) : null,
      structureCount:Number.isInteger(parcel.structureCount) ? parcel.structureCount : null,
      checked:new Date().toISOString().slice(0,10)
    };
  }
  const file = "private-data/parcel-context.json";
  const temporary = file+"."+randomUUID();
  try {
    await writeFile(temporary, JSON.stringify(result));
    await rename(temporary,file);
  } finally {
    await rm(temporary,{force:true});
  }
  console.log("Updated parcel summaries for "+Object.keys(result).length+" captures.");
}
refresh().catch(error => {
  console.error(error instanceof SyntaxError ? "Invalid parcel response or coordinate file." : error.message);
  process.exitCode=1;
});
