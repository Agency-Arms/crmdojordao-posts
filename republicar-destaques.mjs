// Uso único (06/10): republica os stories dos destaques pela API com o Arquivo ligado,
// pra eles entrarem no Arquivo e virarem destaque. Os de 05/10 saíram com o Arquivo desligado.
// Pula o que já foi republicado (registro em republicados-destaques.json). Ordem = ordem dos destaques.
import { readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = dirname(fileURLToPath(import.meta.url));
const REG = join(RAIZ, "republicados-destaques.json");
const API = "https://graph.facebook.com/v25.0";
const BASE = "https://agency-arms.github.io/crmdojordao-posts";
const env = Object.fromEntries(readFileSync("C:/Users/Mathe/.claude/secrets/ig-crm-jordao.env", "utf8").split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const reg = existsSync(REG) ? JSON.parse(readFileSync(REG, "utf8")) : { "1-comece-aqui/01-capa.jpg": "18028762181860443" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const g = async (p, b, m = "GET") => { const q = new URLSearchParams({ ...b, access_token: env.PAGE_TOKEN }); const r = m === "GET" ? await fetch(`${API}${p}?${q}`) : await fetch(API + p, { method: m, body: q }); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j; };

const D = join(RAIZ, "midia/02-destaques");
const lista = readdirSync(D).sort().flatMap((s) => readdirSync(join(D, s)).sort().map((f) => `${s}/${f}`));
for (const a of lista) {
  if (reg[a]) continue;
  const url = encodeURI(`${BASE}/midia/02-destaques/${a}`);
  try {
    const c = (await g(`/${env.IG_USER_ID}/media`, { media_type: "STORIES", ...(a.endsWith(".mp4") ? { video_url: url } : { image_url: url }) }, "POST")).id;
    for (let i = 0; i < 60; i++) { const s = await g(`/${c}`, { fields: "status_code" }); if (s.status_code === "FINISHED") break; if (s.status_code === "ERROR") throw new Error("container ERROR"); await sleep(5000); }
    const p = await g(`/${env.IG_USER_ID}/media_publish`, { creation_id: c }, "POST");
    reg[a] = p.id; writeFileSync(REG, JSON.stringify(reg, null, 2));
    const l = `${new Date().toISOString()} REPUBLICADO story ${a} ${p.id}`; console.log(l); appendFileSync(join(RAIZ, "log.txt"), l + "\n");
    await sleep(4000);
  } catch (e) { console.log("ERRO", a, e.message); break; }
}
console.log("fim", Object.keys(reg).length, "de", lista.length);
