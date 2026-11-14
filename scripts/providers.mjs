import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

// Read the kit in place. Only return the small field set consumed by this preview.
export async function commercialProperty(file, id) {
  const input = createReadStream(file, {encoding:"utf8"});
  const lines = createInterface({input, crlfDelay:Infinity});
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      const record = JSON.parse(line);
      if (String(record.id) !== id) continue;
      return {
        source:"CoStar offline kit",
        stories:record.numStoriesAboveGrade ?? null,
        heightFeet:record.buildingHeightInFeet ?? null,
        sprinklersReported:record.hasSprinklers ?? null
      };
    }
    return null;
  } finally {
    lines.close();
    input.destroy();
  }
}

export async function parcelSummary(lon, lat, key, request = fetch) {
  if (![lon,lat].every(Number.isFinite) || Math.abs(lon)>180 || Math.abs(lat)>90)
    throw new Error("Supply valid longitude and latitude.");
  if (!key) throw new Error("Set the rotated VEXCEL_API_KEY in .env.local.");
  const url = new URL("https://api.vexcelgroup.com/v2/property/extract");
  url.search = new URLSearchParams({
    wkt: "POINT ("+lon+" "+lat+")", srid:"4326", layer:"urban,urban-r,wide-area,urban-g",
    latest:"true", include:"precomputed", "unit-system":"imperial"
  }).toString();
  const response = await request(url, {
    headers:{"X-API-KEY":key}, redirect:"error", signal:AbortSignal.timeout(120000)
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Vexcel returned HTTP "+response.status+".");
  const data = await response.json();
  if (data.type !== "FeatureCollection" || !Array.isArray(data.features))
    throw new Error("Unexpected Vexcel response.");
  if (!data.features.length) return null;
  const attributes = data.features[0]?.properties;
  return {
    source:"Vexcel exterior parcel",
    collection:attributes?.["metadata.collection"] ?? null,
    structureCount:attributes?.["structure.count"] ?? null
  };
}
