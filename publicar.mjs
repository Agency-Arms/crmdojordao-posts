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
// No servidor do CRM o repositório é só leitura: o registro vive em ESTADO_DIR (fora do git) e soma o histórico do repo.
const ESTADO = process.env.ESTADO_DIR || "";
const FEITOS = ESTADO ? join(ESTADO, "publicados.json") : join(RAIZ, "publicados.json");
const HIST = ESTADO ? join(RAIZ, "publicados.json") : "";
const LOG = ESTADO ? join(ESTADO, "log.txt") : join(RAIZ, "log.txt");
const API = "https://graph.facebook.com/v25.0";
const JANELA_MIN = 45; // item vencido há mais de 45 min não sai sozinho · cron parado não vira rajada
// Ritmo (decisão do Matheus 06/10): até 10 posts de feed/dia com ~1h entre eles e até 6 stories/dia com 30 min. A suspensão de 06/10 foi por 11 stories em 7 min. Nunca rajada.
const MAX_POR_RODADA = 1; // posts de feed por rodada
const MAX_STORIES_RODADA = 1; // stories por rodada
const INTERVALO_FEED_MIN = 55; // mínimo entre posts de feed, lido do próprio Instagram
const INTERVALO_STORY_MIN = 30; // mínimo entre stories
const TETO_FEED_24H = Number(process.env.TETO_FEED_24H || 10); // feed nas últimas 24h
const TETO_STORIES_24H = Number(process.env.TETO_STORIES_24H || 6); // stories no ar (últimas 24h)

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
  // story: item.arquivo aponta um .jpg ou .mp4 · sai como STORIES (a API não põe figurinha de link)
  if (item.arquivo) { const u = encodeURI(`${BASE}/${item.arquivo}`); return item.arquivo.endsWith(".mp4") ? { tipo: "story", video: u, legenda: "" } : { tipo: "story", fotos: [u], legenda: "" }; }
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
    await sleep(10000); // menos consultas à Meta enquanto o vídeo processa
  }
  throw new Error(`container ${id} não ficou pronto em 5 min`);
}

async function publicarIG(item) {
  const IG = env("IG_USER_ID");
  const m = midia(item);
  if (m.legenda.length > 2200) throw new Error("legenda passa de 2.200 caracteres");
  let criacao;
  if (m.tipo === "story") {
    criacao = (await g(`/${IG}/media`, { media_type: "STORIES", ...(m.video ? { video_url: m.video } : { image_url: m.fotos[0] }) }, "POST")).id;
  } else if (m.tipo === "reel") {
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
  const link = m.tipo === "story" ? "" : (await g(`/${pub.id}`, { fields: "permalink" })).permalink;
  return { mediaId: pub.id, link };
}

const cmd = process.argv[2];
const fila = ler(FILA, []);
const feitos = { ...(HIST ? ler(HIST, {}) : {}), ...ler(FEITOS, {}) };
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

// ── trava anti-repetição ─────────────────────────────────────────────
// 1) A FONTE DA VERDADE É O INSTAGRAM: antes de publicar, lê os últimos posts do perfil e compara a legenda.
//    Se já existe, marca como publicado e NÃO posta de novo (cobre registro perdido, push que falhou, bug no meio).
// 2) A mesma pasta nunca sai duas vezes, mesmo com outro id na fila.
// 3) Um item com erro só é tentado de novo depois da checagem 1, e no máximo 3 vezes.
// 4) Story parado em "publicando" (caiu no meio) nunca é repetido sozinho: fica pra decisão humana.
// 5) Intervalo mínimo de 2 min entre posts de feed, lido do próprio Instagram.
// 6) Story não tem legenda: antes de publicar, lê os stories no ar. Se existe um story que a gente não registrou,
//    publicado depois do horário deste item, assume que é ele (registro perdido) e NÃO repete: fica pra conferir.
const norm = (t) => (t || "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 180);
const chave = (x) => (x.arquivo ? x.arquivo + (x.rodada ? "#" + x.rodada : "") : x.pasta); // rodada: republicação aprovada do mesmo arquivo
const okPorPasta = new Set(Object.entries(feitos).filter(([, v]) => v.status === "ok").map(([k]) => chave(fila.find((x) => x.id === k) || {})).filter(Boolean));
const tentativas = (x) => feitos[x.id]?.tentativas || 0;
const elegivel = (x) => x.aprovado && !okPorPasta.has(chave(x)) && (!feitos[x.id] || (feitos[x.id].status === "erro" && tentativas(x) < 3) || (feitos[x.id].status === "publicando" && !x.arquivo));
const agora = Date.now();
const abertos = fila.filter(elegivel);
const vencidos = abertos.filter((x) => Date.parse(x.quando) <= agora && agora - Date.parse(x.quando) <= JANELA_MIN * 60000);
const perdidos = abertos.filter((x) => agora - Date.parse(x.quando) > JANELA_MIN * 60000);
const proximos = abertos.filter((x) => Date.parse(x.quando) > agora).slice(0, 5);
const travados = fila.filter((x) => (feitos[x.id]?.status === "publicando" && x.arquivo) || feitos[x.id]?.status === "conferir");

async function storiesNoAr() {
  const r = await g(`/${env("IG_USER_ID")}/stories`, { fields: "id,timestamp", limit: "100" });
  return r.data || [];
}

async function noPerfil() {
  const r = await g(`/${env("IG_USER_ID")}/media`, { fields: "id,caption,permalink,timestamp", limit: "100" });
  return r.data || [];
}

if (cmd === "dry") {
  console.log("Sairia agora:", vencidos.map((x) => x.id).join(" | ") || "nada");
  console.log("Passou da janela (não sai sozinho, decidir):", perdidos.map((x) => x.id).join(" | ") || "nada");
  console.log("Story pra conferir no perfil (não sai sozinho):", travados.map((x) => x.id).join(" | ") || "nada");
  console.log("Próximos:", proximos.map((x) => `${x.id} @ ${new Date(x.quando).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`).join(" | ") || "nada");
  process.exit(0);
}

if (cmd === "run") {
  if (existsSync(join(RAIZ, "PAUSAR"))) { log("PAUSADO · arquivo PAUSAR existe"); process.exit(0); }
  if (!env("PAGE_TOKEN") || !env("IG_USER_ID")) { log("faltam credenciais"); process.exit(1); }
  if (!vencidos.length) { console.log("nada vencido"); process.exit(0); }
  const perfil = await noPerfil();
  const legendasNoAr = new Map(perfil.map((p) => [norm(p.caption), p]));
  let ultimoFeed = perfil.length ? Date.parse(perfil[0].timestamp) : 0;
  let feed24h = perfil.filter((p) => Date.now() - Date.parse(p.timestamp) < 24 * 3600000).length;
  const temStory = vencidos.some((x) => x.arquivo);
  const stories = temStory ? await storiesNoAr() : [];
  let ultimoStory = stories.reduce((a, st) => Math.max(a, Date.parse(st.timestamp)), 0);
  let stories24h = stories.length;
  const idsNossos = new Set(Object.values(feitos).map((v) => v.mediaId).filter(Boolean));
  let feitosNestaRodada = 0, storiesNestaRodada = 0;
  for (const item of vencidos) {
    const m = midia(item);
    if (m.tipo === "story" ? storiesNestaRodada >= MAX_STORIES_RODADA : feitosNestaRodada >= MAX_POR_RODADA) continue;
    if (m.tipo !== "story") {
      const igual = legendasNoAr.get(norm(m.legenda));
      if (igual) { feitos[item.id] = { status: "ok", em: new Date().toISOString(), mediaId: igual.id, link: igual.permalink, nota: "já estava no ar · não repostado" }; log(`JA-NO-AR ${item.id} ${igual.permalink}`); writeFileSync(FEITOS, JSON.stringify(feitos, null, 2)); continue; }
      if (Date.now() - ultimoFeed < INTERVALO_FEED_MIN * 60000) { console.log("intervalo mínimo entre posts · fica pra próxima rodada"); continue; }
      if (feed24h >= TETO_FEED_24H) { console.log("teto de posts em 24h · fica pra próxima rodada"); continue; }
    } else {
      if (Date.now() - ultimoStory < INTERVALO_STORY_MIN * 60000) { console.log("intervalo mínimo entre stories · fica pra próxima rodada"); continue; }
      if (stories24h >= TETO_STORIES_24H) { console.log("teto de stories em 24h · fica pra próxima rodada"); continue; }
      const solto = stories.find((st) => !idsNossos.has(st.id) && Date.parse(st.timestamp) >= Date.parse(item.quando) - 60000);
      if (solto) { feitos[item.id] = { status: "conferir", em: new Date().toISOString(), mediaId: solto.id, nota: "tem story no ar sem registro depois do horário deste item · não repostado, conferir no perfil" }; log(`CONFERIR ${item.id} story ${solto.id} no ar sem registro`); writeFileSync(FEITOS, JSON.stringify(feitos, null, 2)); continue; }
    }
    const n = tentativas(item) + 1;
    try {
      feitos[item.id] = { status: "publicando", em: new Date().toISOString(), tentativas: n };
      writeFileSync(FEITOS, JSON.stringify(feitos, null, 2)); // marca antes: se cair no meio, a checagem do perfil decide
      const r = await publicarIG(item);
      feitos[item.id] = { status: "ok", em: new Date().toISOString(), tentativas: n, ...r };
      if (m.tipo !== "story") { legendasNoAr.set(norm(m.legenda), { id: r.mediaId, permalink: r.link }); ultimoFeed = Date.now(); feed24h++; } else { ultimoStory = Date.now(); stories24h++; }
      okPorPasta.add(chave(item));
      idsNossos.add(r.mediaId);
      if (m.tipo === "story") storiesNestaRodada++; else feitosNestaRodada++;
      log(`OK ${item.id} ${r.link || ""}`);
    } catch (e) {
      feitos[item.id] = { status: "erro", em: new Date().toISOString(), tentativas: n, erro: String(e.message || e) };
      log(`ERRO ${item.id} (tentativa ${n}/3) ${e.message || e}`);
    }
    writeFileSync(FEITOS, JSON.stringify(feitos, null, 2));
  }
  process.exit(0);
}

console.log("Uso: check | dry | run");
