import {readdir,readFile,writeFile,mkdir,copyFile} from "node:fs/promises";
import path from "node:path";
const assets={};
const mime={png:"image/png",jpg:"image/jpeg",html:"text/html",js:"application/javascript",css:"text/css",txt:"text/plain",woff2:"font/woff2",json:"application/json",ico:"image/x-icon",svg:"image/svg+xml"};
async function collect(dir) {
  for(const entry of await readdir(dir,{withFileTypes:true})) {
    const file=path.join(dir,entry.name);
    if(entry.isDirectory()) await collect(file);
    else assets["/"+path.relative("out",file)]=[mime[entry.name.split(".").pop()] || "application/octet-stream",(await readFile(file)).toString("base64")];
  }
}
await collect("out");
await mkdir("dist/server",{recursive:true});
await mkdir("dist/.openai",{recursive:true});
await copyFile(".openai/hosting.json","dist/.openai/hosting.json");
const api=(await readFile("server/vexcel.mjs","utf8"))+"\n"+(await readFile("server/reports.mjs","utf8"));
const index=JSON.parse(await readFile("public/dossier-data/index.json","utf8"));
const points=Object.fromEntries(index.buildings.map(b=>[b.id,[b.lon,b.lat]]));
await writeFile("dist/server/index.js",api+"\nconst points="+JSON.stringify(points)+";\nconst assets="+JSON.stringify(assets)+";\n"+`
function bucketCache(bucket){return {
  async get(key){if(!bucket)return null;const o=await bucket.get(key);return o?{bytes:new Uint8Array(await o.arrayBuffer())}:null;},
  async put(key,bytes,type){if(bucket)await bucket.put(key,bytes,{httpMetadata:{contentType:type}});}
};}
export default {async fetch(request, env) {
  const route=new URL(request.url).pathname;
  if(route.startsWith("/api/vexcel/")) return vexcel(request,{key:env.VEXCEL_API_KEY,lookup:id=>points[id],cache:bucketCache(env.BUCKET)});
  if(route==="/api/reports") return reports(request,{known:id=>Boolean(points[id]),store:{
    async read(){const o=env.BUCKET&&await env.BUCKET.get("field-reports");return o?await o.json():{};},
    async write(d){if(env.BUCKET)await env.BUCKET.put("field-reports",JSON.stringify(d));}}});
  if(route==="/api/agent/status") return Response.json({configured:false});
  if(route==="/api/agent") return Response.json({error:"The Claude agent runs on the local API server (npm run api)."},{status:503});
  if(route==="/api/host") return Response.json({lan:null});
  const file=assets[route] || assets[route.replace(/\\/$/,"")+".html"] || (route==="/" && assets["/index.html"]);
  if(!file) return new Response("Not found",{status:404});
  return new Response(request.method==="HEAD"?null:Uint8Array.from(atob(file[1]),c=>c.charCodeAt(0)),{headers:{"Content-Type":file[0]}});
}};
`);
