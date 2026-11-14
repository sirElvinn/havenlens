import {readdir,readFile,writeFile,mkdir,copyFile} from "node:fs/promises";
import path from "node:path";
const assets={};
const mime={html:"text/html",js:"application/javascript",css:"text/css",txt:"text/plain",woff2:"font/woff2",json:"application/json",ico:"image/x-icon",svg:"image/svg+xml"};
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
const api=await readFile("worker/rooms.mjs","utf8");
await writeFile("dist/server/index.js",api+"\nconst assets="+JSON.stringify(assets)+";\n"+`
export default {async fetch(request, env) {
  const route=new URL(request.url).pathname;
  if(route==="/api/rooms" || route.startsWith("/api/rooms/")) return rooms(request,env.BUCKET);
  const file=assets[route] || assets[route.replace(/\\/$/,"")+".html"] || (route==="/" && assets["/index.html"]);
  if(!file) return new Response("Not found",{status:404});
  return new Response(request.method==="HEAD"?null:Uint8Array.from(atob(file[1]),c=>c.charCodeAt(0)),{headers:{"Content-Type":file[0]}});
}};
`);
