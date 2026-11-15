import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

// Production builds are a static export served by the Worker (dist/server).
// In development, /api/vexcel is proxied to the local API (`npm run api`).
export default function config(phase) {
  if (phase === PHASE_DEVELOPMENT_SERVER) return {
    images: { unoptimized: true },
    async rewrites() { return [{ source: "/api/:path*", destination: "http://localhost:8787/api/:path*" }]; },
  };
  return { output: "export", images: { unoptimized: true } };
}
