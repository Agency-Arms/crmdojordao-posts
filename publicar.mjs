// Publicador do Instagram @crmdojordao (API oficial de publicação da Meta).
// Só publica o que está APROVADO em fila.json e cujo horário já chegou. Nunca repete (publicados.json).
//
//   node publicar.mjs check   confere página, Instagram, limite e se a próxima arte abre pela URL pública (não publica)
//   node publicar.mjs dry     mostra o que sairia agora e o que vem depois (não publica)
//   node publicar.mjs run     publica o que está vencido (o cron chama este)
//
// Trava geral: se existir o arquivo PAUSAR na raiz, nada é publicado.
// Credenciais: variáveis de ambiente (secrets do GitHub) ou, na máquina local,
// C:/Users/Mathe/.claude/secrets/ig-crm-jordao.env · IG_USER_ID, PAGE_TOKEN, MEDIA_BASE_URL
import { readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = dirname(fileURLToPath(import.meta.url));
const FILA = join(RAIZ, "fila.json");
const FEITOS = join(RAIZ, "publicados.json");
const LOG = join(RAIZ, "log.txt");
const API = "https://graph.facebook.com/v25.0";
const JANELA_MIN = 45; // item vencido há mais de 45 min não sai sozinho · cron parado não vira rajada
const MAX_POR_RODADA = 2;

const arquivoLocal = "C:/Users/Mathe/.claude/secrets/ig-crm-jordao.env";
const local = existsSync(arquivoLocal) ? Object.fromEntries(readFileSync(arquivoLocal, "utf8").split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])) : {};
const env = (k) => process.env[k] || local[k] || "";
const BASE = (env("MEDIA_BASE_URL") || "https://agency-arms.github.io/crmdojordao-posts").replace(/\/$/, "");

const ler = (f, pad) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : pad);
const log = (m) => { const l = `${new Date().toISOString()} ${m}`; console.log(l); appendFileSync(LOG, l + "\n"); };
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

async function g(path, params = {}, method = "GET") {
  const body = new URLSearchParams({ ...params, access_token: env("PAGE_TOKEN") });
  const r = method === "GET" ? await fetch(`${API}${path}?${body}`) : await fetch(API + path, { method, body });
  const j = await r.json();
  if (j.error) throw new Error(`${path}: ${j.error.message} (code ${j.error.code})`);
  return j;
}

// item: { id, quando: ISO, pasta: "midia/...", aprovado: true }
function midia(item) {
  const p = join(RAIZ, item.pasta);
  const f = readdirSync(p);
  const url = (n) => encodeURI(`${BASE}/${item.pasta}/${n}`);
  const legenda = readFileSync(join(p, "legenda.txt"), "utf8").trim();
  if (f.includes("reel.mp4")) return { tipo: "reel", video: url("reel.mp4"), capa: f.includes("capa.jpg") ? url("capa.jpg") : null, legenda };
  const fotos = f.filter((x) => /^\d+\.jpg$/.test(x)).sort((a, b) => parseInt(a) - parseInt(b)).map(url);
  return { tipo: fotos.length > 1 ? "carrossel" : "post", fotos, legenda };
}

async function esperarPronto(id) {
  for (let i = 0; i < 60; i++) {
    const s = await g(`/${id}`, { fields: "status_code" });
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`container ${id} ${s.status_code}`);
    await sleep(5000);
  }
  throw new Error(`container ${id} não ficou pronto em 5 min`);
}

async function publicarIG(item) {
  const IG = env("IG_USER_ID");
  const m = midia(item);
  if (m.legenda.length > 2200) throw new Error("legenda passa de 2.200 caracteres");
  let criacao;
  if (m.tipo === "reel") {
    criacao = (await g(`/${IG}/media`, { media_type: "REELS", video_url: m.video, caption: m.legenda, share_to_feed: "true", ...(m.capa ? { cover_url: m.capa } : {}) }, "POST")).id;
  } else if (m.tipo === "carrossel") {
    if (m.fotos.length > 10) throw new Error("carrossel com mais de 10 imagens");
    const filhos = [];
    for (const f of m.fotos) filhos.push((await g(`/${IG}/media`, { image_url: f, is_carousel_item: "true" }, "POST")).id);
    for (const c of filhos) await esperarPronto(c);
    criacao = (await g(`/${IG}/media`, { media_type: "CAROUSEL", children: filhos.join(","), caption: m.legenda }, "POST")).id;
  } else {
    criacao = (await g(`/${IG}/media`, { image_url: m.fotos[0], caption: m.legenda }, "POST")).id;
  }
  await esperarPronto(criacao);
  const pub = await g(`/${IG}/media_publish`, { creation_id: criacao }, "POST");
  const link = (await g(`/${pub.id}`, { fields: "permalink" })).permalink;
  return { mediaId: pub.id, link };
}

const cmd = process.argv[2];
const fila = ler(FILA, []);
const feitos = ler(FEITOS, {});
const pend = fila.filter((x) => x.aprovado && !feitos[x.id]);

if (cmd === "check") {
  const IG = env("IG_USER_ID");
  const perfil = await g(`/${IG}`, { fields: "username,name,media_count,followers_count" });
  console.log("Instagram:", perfil.username, "·", perfil.name, "·", perfil.media_count, "posts ·", perfil.followers_count, "seguidores");
  const lim = await g(`/${IG}/content_publishing_limit`, { fields: "config,quota_usage" });
  console.log("Limite:", JSON.stringify(lim.data?.[0]));
  if (pend[0]) { const m = midia(pend[0]); const u = m.video || m.fotos[0]; const r = await fetch(u, { method: "HEAD" }); console.log("Próxima mídia pública:", u, "→", r.status, r.headers.get("content-type")); }
  process.exit(0);
}

const agora = Date.now();
const vencidos = pend.filter((x) => Date.parse(x.quando) <= agora && agora - Date.parse(x.quando) <= JANELA_MIN * 60000);
const perdidos = pend.filter((x) => agora - Date.parse(x.quando) > JANELA_MIN * 60000);
const proximos = pend.filter((x) => Date.parse(x.quando) > agora).slice(0, 5);

if (cmd === "dry") {
  console.log("Sairia agora:", vencidos.map((x) => x.id).join(" | ") || "nada");
  console.log("Passou da janela (não sai sozinho, decidir):", perdidos.map((x) => x.id).join(" | ") || "nada");
  console.log("Próximos:", proximos.map((x) => `${x.id} @ ${new Date(x.quando).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`).join(" | ") || "nada");
  process.exit(0);
}

if (cmd === "run") {
  if (existsSync(join(RAIZ, "PAUSAR"))) { log("PAUSADO · arquivo PAUSAR existe"); process.exit(0); }
  if (!env("PAGE_TOKEN") || !env("IG_USER_ID")) { log("faltam credenciais"); process.exit(1); }
  for (const item of vencidos.slice(0, MAX_POR_RODADA)) {
    try {
      feitos[item.id] = { status: "publicando", em: new Date().toISOString() };
      writeFileSync(FEITOS, JSON.stringify(feitos, null, 2)); // marca antes: se cair no meio, não repete sozinho
      const r = await publicarIG(item);
      feitos[item.id] = { status: "ok", em: new Date().toISOString(), ...r };
      log(`OK ${item.id} ${r.link}`);
    } catch (e) {
      feitos[item.id] = { status: "erro", em: new Date().toISOString(), erro: String(e.message || e) };
      log(`ERRO ${item.id} ${e.message || e}`);
    }
    writeFileSync(FEITOS, JSON.stringify(feitos, null, 2));
  }
  if (!vencidos.length) console.log("nada vencido");
  process.exit(0);
}

console.log("Uso: check | dry | run");
