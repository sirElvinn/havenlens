// Local API (and production preview) server.
//   npm run api      -> API only on :8787, used by `npm run dev` through a rewrite
//   npm run preview  -> serves the static export in out/ plus the API on :3000
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { networkInterfaces } from "node:os";
import { vexcel } from "../server/vexcel.mjs";
import { agent, agentConfigured } from "../server/agent.mjs";
import { reports } from "../server/reports.mjs";

const root = path.resolve(import.meta.dirname, "..");
const serveStatic = process.argv.includes("--static");
const port = Number(process.env.PORT || (serveStatic ? 3000 : 8787));
const index = JSON.parse(await readFile(path.join(root, "public/dossier-data/index.json"), "utf8"));
const points = new Map(index.buildings.map(b => [b.id, [b.lon, b.lat]]));
const cacheDir = path.join(root, ".cache");
const cache = {
  async get(key) {
    const file = path.join(cacheDir, key);
    return existsSync(file) ? { bytes: new Uint8Array(await readFile(file)) } : null;
  },
  async put(key, bytes) {
    const file = path.join(cacheDir, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  },
};
const reportFile = path.join(cacheDir, "field-reports.json");
const reportStore = {
  async read() { try { return JSON.parse(await readFile(reportFile, "utf8")); } catch { return {}; } },
  async write(data) { await mkdir(cacheDir, { recursive: true }); await writeFile(reportFile, JSON.stringify(data)); },
};
// The machine's LAN address, so a phone on the same network can open placard QR codes.
function lanAddress() {
  for (const list of Object.values(networkInterfaces())) for (const n of list ?? []) if (n.family === "IPv4" && !n.internal) return n.address;
  return null;
}
const mime = { html: "text/html", js: "application/javascript", css: "text/css", json: "application/json", txt: "text/plain", woff2: "font/woff2", svg: "image/svg+xml", png: "image/png", ico: "image/x-icon" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let response;
  const body = ["POST", "PUT"].includes(req.method) ? await new Promise(r => { let d = ""; req.on("data", c => { d += c; if (d.length > 700_000) req.destroy(); }); req.on("end", () => r(d)); }) : undefined;
  const asRequest = () => new Request(url, { method: req.method, body, headers: { "content-type": "application/json" } });
  if (url.pathname === "/api/agent" || url.pathname === "/api/agent/status") {
    response = await agent(asRequest());
  } else if (url.pathname === "/api/reports") {
    response = await reports(asRequest(), { store: reportStore, known: id => points.has(id) });
  } else if (url.pathname === "/api/host") {
    response = Response.json({ lan: lanAddress() });
  } else if (url.pathname.startsWith("/api/vexcel/")) {
    response = await vexcel(new Request(url, { method: req.method }), { key: process.env.VEXCEL_API_KEY, lookup: id => points.get(id), cache });
  } else if (serveStatic) {
    const out = path.join(root, "out");
    const candidates = [url.pathname, url.pathname.replace(/\/$/, "") + ".html", path.join(url.pathname, "index.html")];
    for (const c of candidates) {
      const file = path.join(out, path.normalize(c));
      if (file.startsWith(out) && existsSync(file) && !file.endsWith(path.sep)) {
        try { response = new Response(await readFile(file), { headers: { "Content-Type": mime[file.split(".").pop()] || "application/octet-stream" } }); break; } catch {}
      }
    }
  }
  response ??= new Response("Not found", { status: 404 });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`HavenLens ${serveStatic ? "preview" : "API"} on http://localhost:${port} · Vexcel ${process.env.VEXCEL_API_KEY ? "configured" : "NOT configured (set VEXCEL_API_KEY in .env.local)"} · Claude agent ${agentConfigured() ? "configured" : "not configured (set ANTHROPIC_API_KEY in .env.local; rule-based planner is used)"}`));
