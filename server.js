// Player Local — servidor de streaming caseiro (sem dependências externas além do ffmpeg/ffprobe)
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- configuração (.env)
// Formato: CHAVE=valor por linha (# comenta). Pastas de vídeos (vários caminhos separados por ; ou ,):
//   PASTA_VIDEOS_<CATEGORIA>=...  → cada categoria vira uma seção na tela inicial
//   PASTA_VIDEOS=...              → seção "Biblioteca"
// A categoria OUTROS é especial: todo vídeo da pasta e das subpastas aparece solto, sem legendas.
// Variáveis de ambiente do sistema têm prioridade sobre o .env.
const mediaEntries = []; // { cat, value }
try {
  for (const raw of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toUpperCase();
    const val = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (/^PASTA_VIDEOS(_\w+)?$/.test(key)) mediaEntries.push({ cat: key.replace(/^PASTA_VIDEOS_?/, '') || 'BIBLIOTECA', value: val });
    else if (!(key in process.env)) process.env[key] = val;
  }
} catch { /* sem .env */ }
for (const k of ['PASTA_VIDEOS', 'MEDIA_DIR']) if (process.env[k]) mediaEntries.unshift({ cat: 'BIBLIOTECA', value: process.env[k] });

const CAT_LABELS = { BIBLIOTECA: 'Biblioteca', FILMES: 'Filmes', SERIES: 'Séries', OUTROS: 'Outros', ANIMES: 'Animes', DESENHOS: 'Desenhos', DOCUMENTARIOS: 'Documentários', INFANTIL: 'Infantil', MUSICAS: 'Músicas' };
const catLabel = c => CAT_LABELS[c] || (c[0] + c.slice(1).toLowerCase()).replace(/_/g, ' ');

const ROOTS = [];      // { abs, cat, flat }
const CATEGORIES = []; // { key, name, flat }, na ordem do .env
for (const { cat, value } of mediaEntries) {
  if (!CATEGORIES.some(c => c.key === cat)) CATEGORIES.push({ key: cat, name: catLabel(cat), flat: cat === 'OUTROS' });
  for (const item of value.split(/[;,]/)) {
    const p = item.trim().replace(/^PASTA_VIDEOS\w*\s*=\s*/i, '').replace(/^(['"])(.*)\1$/, '$2');
    if (!p) continue;
    const abs = path.resolve(ROOT, p);
    if (ROOTS.some(r => r.abs === abs)) continue;
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) ROOTS.push({ abs, cat, flat: cat === 'OUTROS' });
    else console.warn(`  !! Pasta de vídeos não encontrada (ignorada): ${abs}`);
  }
}
if (!mediaEntries.length) {
  ROOTS.push({ abs: path.join(ROOT, 'videos'), cat: 'BIBLIOTECA', flat: false });
  CATEGORIES.push({ key: 'BIBLIOTECA', name: 'Biblioteca', flat: false });
}
// mais específica primeiro, para o caso de uma pasta estar dentro de outra
const MEDIA_ROOTS = ROOTS.map(r => r.abs).sort((a, b) => b.length - a.length);
const rootInfo = abs => ROOTS.find(r => r.abs === rootOf(abs));

const PORT = Number(process.env.PORT || process.env.PORTA) || 8765;
const HOST = process.env.HOST || '0.0.0.0';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const DATA_FILE = path.join(ROOT, 'data', 'state.json');
const CACHE_DIR = path.join(ROOT, '.cache');
const PUBLIC_DIR = path.join(ROOT, 'public');

const VIDEO_EXT = new Set(['.mkv', '.mp4', '.m4v', '.avi', '.mov', '.webm', '.ts', '.m2ts', '.wmv', '.mpg', '.mpeg', '.flv']);
const SUB_EXT = new Set(['.srt', '.vtt', '.ass', '.ssa']);
const SUB_DIRS = new Set(['subtitles', 'subtitle', 'subs', 'sub', 'legendas', 'legenda']);
const TEXT_SUB_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);
const POSTER_NAMES = ['poster.jpg', 'poster.jpeg', 'poster.png', 'poster.webp', 'folder.jpg', 'folder.png', 'cover.jpg', 'cover.png'];

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
for (const d of ['subs', 'thumbs']) fs.mkdirSync(path.join(CACHE_DIR, d), { recursive: true });

// ---------------------------------------------------------------- utilidades
const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
const collate = (a, b) => collator.compare(a, b);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// IDs e chaves do estado são o caminho absoluto (único mesmo com várias pastas de vídeos).
const encId = abs => Buffer.from(abs, 'utf8').toString('base64url');
const rootOf = abs => MEDIA_ROOTS.find(r => abs.startsWith(r + path.sep)) || null;
const relOf = abs => path.relative(rootOf(abs) || '', abs).split(path.sep).join('/');

function decId(id) {
  if (!/^[\w-]+$/.test(id || '')) return null;
  const abs = path.resolve(Buffer.from(id, 'base64url').toString('utf8'));
  return rootOf(abs) ? abs : null;
}

function run(cmd, args, { timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    const out = [], err = [];
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => err.push(d));
    const timer = timeout ? setTimeout(() => p.kill('SIGKILL'), timeout) : null;
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(`${path.basename(cmd)} falhou (código ${code}): ${Buffer.concat(err).toString().slice(-600)}`));
    });
  });
}

function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
const thumbLimit = limiter(2);
const probeLimit = limiter(4);

async function fileKey(abs) {
  const st = await fsp.stat(abs);
  return crypto.createHash('sha1').update(`${abs}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 20);
}

// ---------------------------------------------------------------- estado persistido
let store = { progress: {}, prefs: {} };
try { store = { progress: {}, prefs: {}, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch { /* primeiro uso */ }
// migra chaves antigas: relativas (à pasta ./videos) ou de arquivos que mudaram de pasta de vídeos.
// Procura o mesmo caminho relativo em cada pasta configurada.
const OLD_VIDEOS = path.join(ROOT, 'videos');
for (const section of [store.progress, store.prefs])
  for (const k of Object.keys(section)) {
    let rel = null;
    if (!path.isAbsolute(k)) rel = k;
    else if (!fs.existsSync(k)) rel = k.startsWith(OLD_VIDEOS + path.sep) ? path.relative(OLD_VIDEOS, k) : null;
    if (rel == null) continue;
    const abs = MEDIA_ROOTS.map(r => path.join(r, rel)).find(p => fs.existsSync(p)) || path.join(OLD_VIDEOS, rel);
    if (abs === k) continue;
    section[abs] = { ...section[k], ...section[abs] };
    delete section[k];
  }
let saveTimer = null;
function flushStore() {
  clearTimeout(saveTimer); saveTimer = null;
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 1));
  fs.renameSync(tmp, DATA_FILE);
}
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(flushStore, 500); }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (saveTimer) flushStore(); process.exit(0); });

// ---------------------------------------------------------------- nomes / episódios
function parseEpisode(name) {
  const m = name.match(/\bS(\d{1,2})[ ._-]?E(\d{1,3})(?!\d)/i) || name.match(/\b(\d{1,2})x(\d{2,3})\b/);
  return m ? { season: +m[1], episode: +m[2], start: m.index, end: m.index + m[0].length } : null;
}

const JUNK = /\b(2160p|1080p|720p|576p|480p|4k|uhd|web[- ]?dl|webrip|bluray|blu[- ]ray|brrip|bdrip|hdrip|hdtv|dvdrip|x26[45]|h ?26[45]|hevc|dsnp|amzn|hmax|atvp|ddp?\s?\d|e?ac3|dts|atmos|remux|proper|repack|10bit)\b/i;
function prettyName(s) {
  let t = String(s).replace(/\[[^\]]*\]/g, ' ').replace(/[._]+/g, ' ');
  const m = t.match(JUNK);
  if (m) t = t.slice(0, m.index);
  return t.replace(/\s+/g, ' ').replace(/^[\s-]+|[\s-]+$/g, '').trim();
}

// Nome para exibir: sem prefixo de site, tags [..] e lixo técnico; ano no fim vira "(ano)".
function displayName(s) {
  let t = String(s).replace(/^\s*(www\.)?[\w-]+\.(org|com|net|to|me|io|mx|cc)\s*-\s*/i, '')
    .replace(/\[[^\]]*\]/g, ' ').replace(/[._]+/g, ' ');
  const m = t.match(JUNK);
  if (m) t = t.slice(0, m.index);
  t = t.replace(/\s+/g, ' ').replace(/^[\s-]+|[\s-]+$/g, '').trim();
  t = t.replace(/\s\(?((?:19|20)\d\d)\)?$/, ' ($1)');
  return t || String(s);
}

function videoMeta(abs, title) {
  const base = path.basename(abs, path.extname(abs));
  if (title.videos.length === 1) return { label: title.name, name: title.name, code: '' };
  const ep = parseEpisode(base);
  if (ep) {
    const code = `T${ep.season}:E${ep.episode}`;
    const name = prettyName(base.slice(ep.end)) || `Episódio ${ep.episode}`;
    return { code, name, label: `${code} · ${name}` };
  }
  const name = prettyName(base) || base;
  return { code: '', name, label: name };
}

// ---------------------------------------------------------------- biblioteca
async function walkVideos(dir, out = [], all = false) {
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.') || e.name.startsWith('$')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (MEDIA_ROOTS.includes(p)) continue; // pasta configurada separadamente
      if (all || !SUB_DIRS.has(e.name.toLowerCase())) await walkVideos(p, out, all);
    }
    else if (VIDEO_EXT.has(path.extname(e.name).toLowerCase()) && !/(^|[ ._-])sample([ ._-]|$)/i.test(e.name)) out.push(p);
  }
  return out;
}

function sortVideos(list) {
  return list
    .map(abs => ({ abs, rel: relOf(abs), ep: parseEpisode(path.basename(abs)) }))
    .sort((a, b) => (a.ep && b.ep)
      ? (a.ep.season - b.ep.season || a.ep.episode - b.ep.episode || collate(a.rel, b.rel))
      : collate(a.rel, b.rel))
    .map(x => x.abs);
}

async function loadTitle(abs) {
  const st = await fsp.stat(abs);
  const id = encId(abs);
  const ri = rootInfo(abs);
  const base = { abs, id, cat: ri?.cat, flat: !!ri?.flat };
  if (st.isDirectory()) return { ...base, name: displayName(path.basename(abs)), dir: abs, videos: sortVideos(await walkVideos(abs)) };
  return { ...base, name: displayName(path.basename(abs, path.extname(abs))), dir: null, videos: [abs] };
}

// Pastas normais: cada subpasta vira um título (série/coleção, com todas as subpastas dela) e
// vídeos soltos viram filmes. Pastas "OUTROS": cada vídeo encontrado (em qualquer subpasta) é um item.
let libCache = null;
async function scanLibrary() {
  if (libCache && Date.now() - libCache.at < 15000) return libCache.titles;
  const titles = [];
  for (const { abs: root, flat } of ROOTS) {
    if (flat) {
      for (const v of await walkVideos(root, [], true)) titles.push(await loadTitle(v));
      continue;
    }
    let ents = [];
    try { ents = await fsp.readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name.startsWith('$')) continue;
      const p = path.join(root, e.name);
      if (e.isDirectory()) {
        if (SUB_DIRS.has(e.name.toLowerCase()) || MEDIA_ROOTS.includes(p)) continue;
        const t = await loadTitle(p); if (t.videos.length) titles.push(t);
      }
      else if (VIDEO_EXT.has(path.extname(e.name).toLowerCase())) titles.push(await loadTitle(p));
    }
  }
  titles.sort((a, b) => collate(a.name, b.name));
  libCache = { at: Date.now(), titles };
  return titles;
}

const titleOfVideo = abs => rootInfo(abs)?.flat ? loadTitle(abs) : loadTitle(path.join(rootOf(abs), relOf(abs).split('/')[0]));

// ---------------------------------------------------------------- ffprobe
const probeCache = new Map();
async function probe(abs) {
  const st = await fsp.stat(abs);
  const k = `${abs}|${st.size}|${st.mtimeMs}`;
  if (!probeCache.has(k)) {
    const pr = probeLimit(() => run(FFPROBE, ['-v', 'error',
      '-show_entries', 'format=duration:stream=index,codec_type,codec_name,pix_fmt,channels:stream_tags:stream_disposition=default,forced,attached_pic',
      '-of', 'json', abs], { timeout: 60000 })).then(o => {
      const j = JSON.parse(o);
      j.duration = parseFloat(j.format?.duration) || 0;
      j.streams = j.streams || [];
      return j;
    });
    pr.catch(() => probeCache.delete(k));
    probeCache.set(k, pr);
  }
  return probeCache.get(k);
}

const videoStream = p => p.streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
const canCopyVideo = v => v && v.codec_name === 'h264' && ['yuv420p', 'yuvj420p'].includes(v.pix_fmt);

// ---------------------------------------------------------------- legendas
const LANG_NAMES = {
  'pt-BR': 'Português (Brasil)', 'pt-PT': 'Português (Portugal)', por: 'Português', pt: 'Português',
  eng: 'Inglês', en: 'Inglês', spa: 'Espanhol', es: 'Espanhol', fre: 'Francês', fra: 'Francês', fr: 'Francês',
  ger: 'Alemão', deu: 'Alemão', de: 'Alemão', ita: 'Italiano', it: 'Italiano', jpn: 'Japonês', ja: 'Japonês',
  kor: 'Coreano', chi: 'Chinês', zho: 'Chinês',
};
const lowerKeys = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.toLowerCase(), v]));
const isBRText = t => /brasil|brazil|\(br\)|\bbr\b|pt-br/.test(t);

function extLang(rel) {
  const s = ' ' + norm(rel).replace(/[^a-z0-9]+/g, ' ') + ' ';
  if (/ (pt ?br|ptbr|pob|pb|bra|brazil|brazilian|brasil|brasileiro) /.test(s)) return 'pt-BR';
  if (/ (pt ?pt|portugal) /.test(s)) return 'pt-PT';
  if (/ (pt|por|portuguese|portugues) /.test(s)) return 'pt-BR';
  if (/ (en|eng|english|ingles) /.test(s)) return 'en';
  if (/ (es|spa|spanish|espanol) /.test(s)) return 'es';
  return '';
}

async function walkSubs(dir, out = []) {
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walkSubs(p, out);
    else if (SUB_EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

async function externalSubs(title, videoAbs) {
  const vbase = path.basename(videoAbs, path.extname(videoAbs));
  const vb = norm(vbase);
  const vep = parseEpisode(vbase);
  const single = title.videos.length === 1;
  const matches = rel => {
    const hay = norm(rel);
    if (hay.includes(vb)) return true;
    const sep = parseEpisode(rel);
    if (sep && vep) return sep.season === vep.season && sep.episode === vep.episode;
    if (sep) return false;
    return single;
  };
  const found = new Map();
  const roots = new Set([path.dirname(videoAbs)]);
  if (title.dir) roots.add(title.dir);
  for (const root of roots) {
    let ents = [];
    try { ents = await fsp.readdir(root, { withFileTypes: true }); } catch { /* ignore */ }
    for (const e of ents) {
      const p = path.join(root, e.name);
      if (e.isFile() && SUB_EXT.has(path.extname(e.name).toLowerCase())) { if (matches(e.name)) found.set(p, e.name); }
      else if (e.isDirectory() && SUB_DIRS.has(e.name.toLowerCase())) {
        for (const s of await walkSubs(p)) { const rel = path.relative(p, s); if (matches(rel)) found.set(s, rel); }
      }
    }
  }
  return [...found].map(([abs, rel]) => ({ abs, rel }));
}

function buildSubs(pr, externals) {
  const streams = pr.streams.filter(s => s.codec_type === 'subtitle');
  const tagsOf = s => lowerKeys(s.tags);
  const hasBR = streams.some(s => {
    const t = tagsOf(s); const l = (t.language || '').toLowerCase();
    return ['pob', 'pt-br'].includes(l) || (['por', 'pt'].includes(l) && isBRText(norm(t.title)));
  });
  const list = [];
  for (const s of streams) {
    if (!TEXT_SUB_CODECS.has(s.codec_name)) continue; // legendas em imagem (PGS/VobSub) não são suportadas
    const tags = tagsOf(s);
    const lang = (tags.language || '').toLowerCase();
    const title = tags.title || '';
    const nt = norm(title);
    let group = lang;
    if (['pob', 'pt-br', 'ptbr'].includes(lang)) group = 'pt-BR';
    else if (['por', 'pt'].includes(lang)) group = isBRText(nt) ? 'pt-BR' : /portugal|europe/.test(nt) ? 'pt-PT' : (hasBR ? 'pt-PT' : 'pt-BR');
    const sdh = /sdh|\bcc\b|closed cap|hearing/.test(nt);
    const forced = !!s.disposition?.forced || /forced|forcad/.test(nt);
    const frames = Object.entries(tags).find(([k]) => k.startsWith('number_of_frames'))?.[1];
    list.push({
      key: `e:${s.index}`, index: s.index, source: 'embedded', lang: group, sdh, forced,
      label: title || LANG_NAMES[group] || LANG_NAMES[lang] || lang || `Faixa ${s.index}`,
      detail: ['Embutida', frames && `${frames} falas`, sdh && 'SDH', forced && 'Forçada'].filter(Boolean).join(' · '),
    });
  }
  for (const x of externals) {
    const lang = extLang(x.rel);
    const n = ' ' + norm(x.rel).replace(/[^a-z0-9]+/g, ' ') + ' ';
    const sdh = / (sdh|cc|hi) /.test(n);
    const forced = / (forced|forcada|forcadas) /.test(n);
    list.push({
      key: `x:${encId(x.abs)}`, abs: x.abs, source: 'external', lang, sdh, forced,
      label: LANG_NAMES[lang] || path.basename(x.abs, path.extname(x.abs)),
      detail: ['Arquivo', path.basename(x.abs), sdh && 'SDH', forced && 'Forçada'].filter(Boolean).join(' · '),
    });
  }
  const rank = s => s.lang === 'pt-BR' ? (s.forced ? 2 : s.sdh ? 1 : 0) : (s.source === 'external' && !s.lang) ? 3 : s.lang === 'pt-PT' ? 4 : 5;
  return list.map((s, i) => [s, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]);
}

function chooseSub(list, videoRel, titleRel) {
  const keys = new Set(list.map(s => s.key));
  const saved = store.progress[videoRel]?.sub;
  if (saved === 'off' || keys.has(saved)) return { selected: saved, choices: [] };
  const pref = store.prefs[titleRel]?.sub;
  if (pref?.off) return { selected: 'off', choices: [] };
  if (pref) {
    const same = list.filter(s => s.source === pref.source && s.label === pref.label);
    if (same.length) return { selected: (same[pref.ordinal] || same[0]).key, choices: [] };
  }
  let pool = list.filter(s => s.lang === 'pt-BR' && !s.forced);
  if (!pool.length) pool = list.filter(s => s.source === 'external' && !s.lang && !s.forced);
  const main = pool.filter(s => !s.sdh);
  const cand = main.length ? main : pool;
  if (cand.length === 1) return { selected: cand[0].key, choices: [] };
  if (cand.length > 1) return { selected: null, choices: pool };
  return { selected: 'off', choices: [] };
}

const subJobs = new Map();
async function ensureEmbeddedSubs(abs, indices) {
  const key = await fileKey(abs);
  const proms = [], todo = [];
  for (const i of new Set(indices)) {
    const out = path.join(CACHE_DIR, 'subs', `${key}-${i}.vtt`);
    if (subJobs.has(out)) proms.push(subJobs.get(out));
    else if (fs.existsSync(out)) proms.push(Promise.resolve(out));
    else todo.push({ i, out });
  }
  if (todo.length) {
    const args = ['-v', 'error', '-y', '-i', abs];
    for (const { i, out } of todo) args.push('-map', `0:${i}`, '-c:s', 'webvtt', '-f', 'webvtt', out + '.tmp');
    const job = run(FFMPEG, args, { timeout: 15 * 60e3 }).then(async () => {
      for (const { out } of todo) await fsp.rename(out + '.tmp', out);
    });
    for (const { out } of todo) {
      const p = job.then(() => out).finally(() => subJobs.delete(out));
      subJobs.set(out, p);
      proms.push(p);
    }
  }
  return Promise.all(proms);
}

function decodeText(buf) {
  let s;
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { s = new TextDecoder('windows-1252').decode(buf); }
  return s.replace(/^﻿/, '');
}

async function externalSubText(abs) {
  const text = decodeText(await fsp.readFile(abs));
  const ext = path.extname(abs).toLowerCase();
  if (ext === '.srt' || ext === '.vtt') return text;
  // .ass / .ssa → converte para WebVTT via ffmpeg (com cache)
  const out = path.join(CACHE_DIR, 'subs', `${await fileKey(abs)}-ext.vtt`);
  if (!fs.existsSync(out)) {
    const tmpIn = out + ext;
    await fsp.writeFile(tmpIn, text, 'utf8');
    try { await run(FFMPEG, ['-v', 'error', '-y', '-i', tmpIn, '-c:s', 'webvtt', '-f', 'webvtt', out + '.tmp']); await fsp.rename(out + '.tmp', out); }
    finally { fsp.unlink(tmpIn).catch(() => {}); }
  }
  return fsp.readFile(out, 'utf8');
}

// ---------------------------------------------------------------- busca online (OpenSubtitles)
const OS_API = 'https://api.opensubtitles.com/api/v1';
const OS_KEY = (process.env.OPENSUBTITLES_API_KEY || '').trim();
const OS_USER = (process.env.OPENSUBTITLES_USUARIO || process.env.OPENSUBTITLES_USER || '').trim();
const OS_PASS = (process.env.OPENSUBTITLES_SENHA || process.env.OPENSUBTITLES_PASSWORD || '').trim();
let osAuth = null; // { token, base } após login (opcional: aumenta o limite de downloads)

async function osFetch(pathAndQuery, { method = 'GET', body, auth = false } = {}) {
  if (auth && OS_USER && OS_PASS && !osAuth) {
    const r = await osFetch('/login', { method: 'POST', body: { username: OS_USER, password: OS_PASS } });
    osAuth = { token: r.token, base: r.base_url ? `https://${r.base_url}/api/v1` : OS_API };
  }
  const headers = { 'Api-Key': OS_KEY, 'User-Agent': 'PlayerLocal v1.0', Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (auth && osAuth) headers.Authorization = `Bearer ${osAuth.token}`;
  const r = await fetch((auth && osAuth ? osAuth.base : OS_API) + pathAndQuery,
    { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { j = { message: txt.slice(0, 200) }; }
  if (r.status === 401 && osAuth) osAuth = null;
  if (!r.ok) throw Object.assign(new Error(j.message || j.errors?.join(', ') || `OpenSubtitles: HTTP ${r.status}`), { status: r.status, reset: j.reset_time_utc });
  return j;
}

// Hash do OpenSubtitles: tamanho + soma (uint64) dos primeiros e últimos 64 KB.
async function osHash(abs) {
  const CH = 65536;
  const fh = await fsp.open(abs, 'r');
  try {
    const { size } = await fh.stat();
    if (size < CH * 2) return null;
    let h = BigInt(size);
    for (const pos of [0, size - CH]) {
      const b = Buffer.alloc(CH);
      await fh.read(b, 0, CH, pos);
      for (let i = 0; i < CH; i += 8) h = (h + b.readBigUInt64LE(i)) & 0xffffffffffffffffn;
    }
    return h.toString(16).padStart(16, '0');
  } finally { await fh.close(); }
}

const osQuery = params => '?' + Object.keys(params).filter(k => params[k] != null && params[k] !== '').sort()
  .map(k => `${k}=${encodeURIComponent(String(params[k]).toLowerCase())}`).join('&');
const OS_LANG = { 'pt-br': 'pt-BR', 'pt-pt': 'pt-PT', en: 'en' };

// Limite diário do OpenSubtitles: quando acaba, os resultados dele aparecem como "limite atingido".
let osBlockedUntil = 0;
const osBlocked = () => Date.now() < osBlockedUntil;
function osBlockFrom(resetUtc) {
  const t = Date.parse(resetUtc || '');
  osBlockedUntil = Number.isFinite(t) && t > Date.now() ? t : Date.now() + 6 * 3600e3;
}

// ---- Subdl (subdl.com)
const SD_KEY = (process.env.SUBDL_API_KEY || '').trim();
const SD_LANG = { BR_PT: 'pt-BR', PT: 'pt-PT', EN: 'en' };

async function sdSearch({ query, year, ep }) {
  const q = new URLSearchParams({ api_key: SD_KEY, film_name: query, type: ep ? 'tv' : 'movie', languages: 'BR_PT,PT,EN', subs_per_page: '30' });
  if (year) q.set('year', year);
  if (ep) { q.set('season_number', ep.season); q.set('episode_number', ep.episode); }
  const r = await fetch(`https://api.subdl.com/api/v1/subtitles?${q}`, { signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status === false) throw new Error(`Subdl: ${j.error || j.message || `HTTP ${r.status}`}`);
  return (j.subtitles || []).filter(s => {
    if (!ep) return true;
    if (s.season != null && +s.season !== ep.season) return false;
    if (s.full_season) return true;
    const from = s.episode_from ?? s.episode, to = s.episode_end || from;
    return from == null || (ep.episode >= +from && ep.episode <= +to);
  }).map(s => ({
    src: 'sd', ref: String(s.url || '').split('?')[0], lang: SD_LANG[s.language] || (s.language || '').toLowerCase(),
    release: s.release_name || s.name || '', downloads: null, hashMatch: false, sdh: !!s.hi, machine: false,
    pack: !!s.full_season,
  })).filter(s => /^\/subtitle\/[\w.-]+\.zip$/.test(s.ref));
}

// Extrai arquivos de um .zip (só "stored" e "deflate", que é o que os sites de legenda usam).
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('arquivo zip inválido');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = [];
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.slice(start, start + csize);
    try {
      if (method === 0) files.push({ name, data: raw });
      else if (method === 8) files.push({ name, data: zlib.inflateRawSync(raw) });
    } catch { /* arquivo corrompido: ignora */ }
  }
  return files;
}

// ---- busca combinada
function searchTerms(title, abs) {
  const base = path.basename(abs, path.extname(abs));
  const ep = parseEpisode(base);
  // tira prefixos de site ("www.Site.org - Nome") antes de limpar o nome
  const clean = s => prettyName(String(s).replace(/^\s*(\[[^\]]*\]\s*)?(www\.)?[\w-]+\.(org|com|net|to|me|io|mx|cc)\s*-\s*/i, ''));
  let query, year;
  if (ep) query = title.dir && title.videos.length > 1 ? clean(title.name) : clean(base.slice(0, ep.start)) || clean(title.name);
  else {
    const name = clean(title.videos.length === 1 && title.dir ? title.name : base);
    year = (name.match(/\b(19[2-9]\d|20[0-4]\d)\b/) || [])[1];
    query = name.replace(/\(?\b(19[2-9]\d|20[0-4]\d)\b\)?/g, '').replace(/\s+/g, ' ').trim() || name;
  }
  return { base, ep, query, year };
}

async function osSearch({ abs, query, year, ep }) {
  const languages = 'en,pt-br,pt-pt';
  const hash = await osHash(abs).catch(() => null);
  const reqs = [osFetch('/subtitles' + osQuery({ languages, query, year, season_number: ep?.season, episode_number: ep?.episode }))];
  if (hash) reqs.push(osFetch('/subtitles' + osQuery({ languages, moviehash: hash })).catch(() => ({ data: [] })));
  const [byName, byHash = { data: [] }] = await Promise.all(reqs);
  const seen = new Map();
  const add = (x, fromHash) => {
    const a = x.attributes || {};
    const f = a.files?.[0];
    if (!f) return;
    // por hash, só aceita se for o mesmo episódio (o hash às vezes aponta para outro)
    if (fromHash && ep && a.feature_details?.episode_number != null && (a.feature_details.season_number !== ep.season || a.feature_details.episode_number !== ep.episode)) return;
    const prev = seen.get(f.file_id);
    if (prev) { prev.hashMatch ||= fromHash || !!a.moviehash_match; return; }
    seen.set(f.file_id, {
      src: 'os', ref: String(f.file_id), lang: OS_LANG[(a.language || '').toLowerCase()] || a.language || '',
      release: a.release || f.file_name || '', downloads: a.download_count || 0,
      hashMatch: fromHash || !!a.moviehash_match, sdh: !!a.hearing_impaired,
      machine: !!(a.machine_translated || a.ai_translated),
    });
  };
  for (const x of byHash.data || []) add(x, true);
  for (const x of byName.data || []) add(x, false);
  return [...seen.values()];
}

async function searchSubsOnline(abs) {
  const title = await titleOfVideo(abs);
  const t = searchTerms(title, abs);
  const sources = [];
  if (OS_KEY) sources.push(['OpenSubtitles', osSearch({ abs, ...t })]);
  if (SD_KEY) sources.push(['Subdl', sdSearch(t)]);
  const settled = await Promise.allSettled(sources.map(s => s[1]));
  const all = [], warnings = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') all.push(...s.value);
    else { console.warn('[legendas online]', sources[i][0], s.reason?.message); warnings.push(`${sources[i][0]} indisponível`); }
  });
  if (!all.length && warnings.length === sources.length) throw new Error(warnings.join(' · '));

  // mesma versão (release) do arquivo → provavelmente sincronizada; contém o título → relevante
  const toks = s => new Set(norm(s).split(/[^a-z0-9]+/).filter(Boolean));
  const vt = toks(t.base), qt = [...toks(t.query)];
  const blocked = osBlocked();
  for (const r of all) {
    const rt = toks(r.release);
    const common = [...rt].filter(x => vt.has(x)).length;
    r.titleMatch = qt.every(x => rt.has(x));
    r.sameRelease = !r.hashMatch && r.titleMatch && rt.size > 2 && common / rt.size >= 0.8;
    r.blocked = r.src === 'os' && blocked;
  }
  const langRank = l => l === 'pt-BR' ? 0 : l === 'pt-PT' ? 1 : 2;
  const results = all.sort((a, b) =>
    langRank(a.lang) - langRank(b.lang) || a.blocked - b.blocked || b.hashMatch - a.hashMatch || b.sameRelease - a.sameRelease ||
    b.titleMatch - a.titleMatch || a.machine - b.machine || (b.downloads || 0) - (a.downloads || 0));
  return {
    query: [t.query, t.year, t.ep && `T${t.ep.season}:E${t.ep.episode}`].filter(Boolean).join(' · '),
    warnings: [...warnings, ...(blocked ? ['Limite diário do OpenSubtitles atingido'] : [])],
    results: results.slice(0, 60),
  };
}

async function downloadSubOnline(abs, src, ref, lang) {
  const title = await titleOfVideo(abs);
  let buf, remaining = null, tag, ext = '.srt';
  if (src === 'os') {
    if (osBlocked()) throw Object.assign(new Error('Limite diário do OpenSubtitles atingido. Escolha uma legenda do Subdl.'), { status: 406 });
    let d;
    try { d = await osFetch('/download', { method: 'POST', body: { file_id: Number(ref), sub_format: 'srt' }, auth: true }); }
    catch (e) {
      if (e.status === 406 || /quota|limit|allowed/i.test(e.message)) { osBlockFrom(e.reset); e.status = 406; e.message = `Limite diário do OpenSubtitles atingido. Escolha uma legenda do Subdl. (${e.message})`; }
      throw e;
    }
    if (!d.link) throw new Error(d.message || 'OpenSubtitles não retornou o arquivo');
    remaining = d.remaining;
    if (remaining === 0) osBlockFrom(d.reset_time_utc);
    const r = await fetch(d.link, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`Falha ao baixar a legenda (HTTP ${r.status})`);
    buf = Buffer.from(await r.arrayBuffer());
    tag = `os${Number(ref)}`;
  } else if (src === 'sd') {
    if (!/^\/subtitle\/[\w.-]+\.zip$/.test(ref)) throw new Error('legenda inválida');
    const r = await fetch(`https://dl.subdl.com${ref}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`Subdl: falha ao baixar (HTTP ${r.status})`);
    const files = unzip(Buffer.from(await r.arrayBuffer())).filter(f => /\.(srt|vtt|ass|ssa)$/i.test(f.name));
    if (!files.length) throw new Error('O pacote do Subdl não tem legenda em formato suportado');
    // pacote de temporada: escolhe o arquivo do episódio
    const ep = parseEpisode(path.basename(abs));
    let pick = files[0];
    if (files.length > 1) {
      pick = (ep && files.find(f => { const e = parseEpisode(path.basename(f.name)); return e && e.season === ep.season && e.episode === ep.episode; }))
        || files.find(f => /\.srt$/i.test(f.name)) || files[0];
      if (ep && !parseEpisode(path.basename(pick.name))) throw new Error('Pacote da temporada sem o arquivo deste episódio');
    }
    buf = pick.data;
    tag = `sd${ref.replace(/\D+/g, '').slice(-12)}`;
    ext = path.extname(pick.name).toLowerCase();
  } else throw new Error('fonte inválida');

  // salva em <pasta do título>/subtitles/<nome do vídeo>.<idioma>.<fonte+id>.srt → entra na lista como legenda externa
  const dir = path.join(title.dir || path.dirname(abs), 'subtitles');
  await fsp.mkdir(dir, { recursive: true });
  const safeLang = /^[\w-]{2,6}$/.test(lang || '') ? lang : 'und';
  const dest = path.join(dir, `${path.basename(abs, path.extname(abs))}.${safeLang}.${tag}${ext}`);
  await fsp.writeFile(dest, buf);
  return { key: `x:${encId(dest)}`, remaining };
}

// ---------------------------------------------------------------- info de vídeo
async function videoContext(abs) {
  const [pr, title] = await Promise.all([probe(abs), titleOfVideo(abs)]);
  const subs = title.flat ? [] : buildSubs(pr, await externalSubs(title, abs)); // "Outros": sem legendas
  return { pr, title, subs, vrel: abs, trel: title.abs };
}

function audioTracks(pr) {
  return pr.streams.filter(s => s.codec_type === 'audio').map(s => {
    const t = lowerKeys(s.tags); const lang = (t.language || '').toLowerCase().replace(/^und$/, '');
    const ch = s.channels === 6 ? '5.1' : s.channels === 8 ? '7.1' : s.channels === 2 ? 'Estéreo' : s.channels === 1 ? 'Mono' : `${s.channels}ch`;
    return { index: s.index, label: [t.title || LANG_NAMES[lang] || lang || `Faixa ${s.index}`, ch].join(' · '), default: !!s.disposition?.default };
  });
}

async function videoInfo(abs) {
  const { pr, title, subs, vrel, trel } = await videoContext(abs);
  const i = title.videos.indexOf(abs);
  const meta = videoMeta(abs, title);
  const prog = store.progress[vrel] || {};
  const audio = audioTracks(pr);
  const audioSelected = audio.some(a => a.index === prog.audio) ? prog.audio : (audio.find(a => a.default) || audio[0])?.index ?? null;
  const pick = chooseSub(subs, vrel, trel);

  // pré-extrai as legendas PT embutidas em segundo plano (MKV precisa ser lido inteiro)
  const warm = subs.filter(s => s.source === 'embedded' && (s.lang === 'pt-BR' || s.key === pick.selected)).map(s => s.index);
  if (warm.length) ensureEmbeddedSubs(abs, warm).catch(e => console.warn('[legenda]', e.message));

  const nb = j => title.videos[j] ? { id: encId(title.videos[j]), label: videoMeta(title.videos[j], title).label } : null;
  const pub = s => ({ key: s.key, label: s.label, detail: s.detail, lang: s.lang });
  return {
    id: encId(vrel), titleId: title.id, titleName: title.name, single: title.videos.length === 1, flat: title.flat,
    subSearch: !title.flat, subSearchReady: !!(OS_KEY || SD_KEY),
    ...meta, duration: pr.duration,
    audio, audioSelected,
    subtitle: { list: subs.map(pub), selected: pick.selected, choices: pick.choices.map(pub) },
    progress: prog.position != null ? { position: prog.position, finished: !!prog.finished } : null,
    next: nb(i + 1), prev: nb(i - 1),
  };
}

async function keyframeBefore(abs, t) {
  if (t <= 0.5) return 0;
  for (const win of [15, 90]) {
    const a = Math.max(0, t - win);
    const out = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-read_intervals', `${a}%${t + 0.05}`,
      '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', abs], { timeout: 20000 });
    let best = -1;
    for (const line of out.split(/\r?\n/)) {
      const [pts, flags] = line.split(',');
      const v = parseFloat(pts);
      if (flags?.includes('K') && v <= t + 0.001 && v > best) best = v;
    }
    if (best >= 0) return best;
  }
  return t;
}

// ---------------------------------------------------------------- miniaturas
async function thumbnail(abs) {
  const out = path.join(CACHE_DIR, 'thumbs', `${await fileKey(abs)}.jpg`);
  if (fs.existsSync(out)) return out;
  return thumbLimit(async () => {
    if (fs.existsSync(out)) return out;
    const { duration } = await probe(abs);
    const t = duration ? Math.min(duration * 0.15, 900) : 30;
    await run(FFMPEG, ['-v', 'error', '-y', '-ss', t.toFixed(2), '-i', abs, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', '-f', 'image2', out + '.tmp'], { timeout: 60000 });
    await fsp.rename(out + '.tmp', out);
    return out;
  });
}

// ---------------------------------------------------------------- dados de páginas
function continueItem(t) {
  const vids = t.videos.map(abs => ({ abs, pr: store.progress[abs] }));
  let last = null;
  for (const v of vids) if (v.pr?.updatedAt && (!last || v.pr.updatedAt > last.pr.updatedAt)) last = v;
  if (!last) return { vids, item: null };
  let item = null;
  if (!last.pr.finished && (last.pr.position || 0) >= 30) item = last;
  else if (last.pr.finished) item = vids.slice(vids.indexOf(last) + 1).find(v => !v.pr?.finished) || null;
  return { vids, item, last };
}

async function homeData() {
  const titles = await scanLibrary();
  const cont = [];
  const sections = CATEGORIES.map(c => ({ name: c.name, flat: c.flat, key: c.key, titles: [] }));
  for (const t of titles) {
    const list = sections.find(s => s.key === t.cat)?.titles;
    if (!list) continue;
    const { vids, item, last } = continueItem(t);
    if (item) cont.push({
      id: encId(item.abs), titleId: t.id, titleName: t.name, single: t.videos.length === 1,
      label: videoMeta(item.abs, t).label, isNext: item !== last,
      position: item.pr?.finished ? 0 : (item.pr?.position || 0), duration: item.pr?.duration || 0,
      updatedAt: last.pr.updatedAt,
    });
    const single = t.videos.length === 1;
    const p0 = vids[0].pr;
    list.push({
      id: t.id, name: t.name, count: t.videos.length, single, flat: t.flat, firstVideo: encId(vids[0].abs),
      watched: vids.filter(v => v.pr?.finished).length,
      progress: single && p0?.duration ? (p0.finished ? 1 : (p0.position || 0) / p0.duration) : null,
    });
  }
  cont.sort((a, b) => b.updatedAt - a.updatedAt);
  return { continue: cont, sections: sections.map(({ key, ...s }) => s) };
}

async function titleData(t) {
  const probes = await Promise.all(t.videos.map(v => probe(v).catch(() => ({ duration: 0 }))));
  const videos = t.videos.map((abs, i) => {
    const pr = store.progress[abs] || {};
    return { id: encId(abs), ...videoMeta(abs, t), duration: probes[i].duration, position: pr.position || 0, finished: !!pr.finished };
  });
  const { item } = continueItem(t);
  const nextId = item ? encId(item.abs) : (videos.find(v => !v.finished) || videos[0]).id;
  return { id: t.id, name: t.name, videos, nextUp: videos.find(v => v.id === nextId) };
}

// ---------------------------------------------------------------- HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };

function json(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length, 'Cache-Control': 'no-store' });
  res.end(b);
}
function text(res, code, body, type = 'text/plain; charset=utf-8') {
  const b = Buffer.from(body, 'utf8');
  res.writeHead(code, { 'Content-Type': type, 'Content-Length': b.length, 'Cache-Control': 'no-store' });
  res.end(b);
}
async function sendFile(res, abs, maxAge = 0) {
  const data = await fsp.readFile(abs);
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': maxAge ? `max-age=${maxAge}` : 'no-cache' });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 65536) { reject(new Error('corpo muito grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

async function stream(req, res, abs, t, audioIdx) {
  const pr = await probe(abs);
  const v = videoStream(pr);
  if (!v) return text(res, 415, 'Arquivo sem vídeo');
  const audios = pr.streams.filter(s => s.codec_type === 'audio');
  const a = audios.find(s => s.index === audioIdx) || audios.find(s => s.disposition?.default) || audios[0];
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', t.toFixed(3), '-i', abs, '-map', `0:${v.index}`];
  if (a) args.push('-map', `0:${a.index}`);
  if (canCopyVideo(v)) args.push('-c:v', 'copy');
  else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-vf', "scale='min(1920,iw)':-2");
  if (a) {
    if (a.codec_name === 'aac' && a.channels <= 2) args.push('-c:a', 'copy');
    else args.push('-c:a', 'aac', '-ac', '2', '-b:a', '192k');
  }
  args.push('-sn', '-dn', '-avoid_negative_ts', 'make_zero', '-max_muxing_queue_size', '2048',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1');

  const ff = spawn(FFMPEG, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let errLog = '';
  ff.stderr.on('data', d => { errLog = (errLog + d).slice(-2000); });
  ff.on('error', e => { console.error('[stream]', e.message); res.destroy(); });
  ff.on('close', code => { if (code && !res.destroyed && errLog) console.warn('[stream] ffmpeg:', errLog.trim()); });
  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' });
  ff.stdout.pipe(res);
  const kill = () => { if (ff.exitCode === null) ff.kill('SIGKILL'); };
  req.on('close', kill);
  res.on('close', kill);
}

async function handle(req, res) {
  const u = new URL(req.url, 'http://local');
  const p = u.pathname;
  const M = req.method;
  let m;

  if (M === 'GET' && p === '/api/home') return json(res, 200, await homeData());

  if (M === 'GET' && (m = p.match(/^\/api\/title\/([\w-]+)$/))) {
    const abs = decId(m[1]);
    if (!abs || !fs.existsSync(abs)) return json(res, 404, { error: 'Título não encontrado' });
    return json(res, 200, await titleData(await loadTitle(abs)));
  }

  if ((m = p.match(/^\/api\/(video|seek|stream|sub|thumb|progress|subpref|watched|subsearch|subdownload)\/([\w-]+)$/))) {
    const [, kind, id] = m;
    const abs = decId(id);
    if (!abs || !fs.existsSync(abs) || !VIDEO_EXT.has(path.extname(abs).toLowerCase())) return json(res, 404, { error: 'Vídeo não encontrado' });

    if (M === 'GET' && kind === 'video') return json(res, 200, await videoInfo(abs));

    if (M === 'GET' && kind === 'seek') {
      const t = Math.max(0, parseFloat(u.searchParams.get('t')) || 0);
      const pr = await probe(abs);
      const start = canCopyVideo(videoStream(pr)) ? await keyframeBefore(abs, t) : t;
      return json(res, 200, { start });
    }

    if (M === 'GET' && kind === 'stream') {
      const t = Math.max(0, parseFloat(u.searchParams.get('t')) || 0);
      const a = u.searchParams.has('a') ? parseInt(u.searchParams.get('a'), 10) : null;
      return stream(req, res, abs, t, a);
    }

    if (M === 'GET' && kind === 'sub') {
      const { subs } = await videoContext(abs);
      const s = subs.find(x => x.key === u.searchParams.get('key'));
      if (!s) return text(res, 404, 'Legenda não encontrada');
      if (s.source === 'embedded') {
        const [file] = await ensureEmbeddedSubs(abs, [s.index]);
        return text(res, 200, await fsp.readFile(file, 'utf8'), 'text/vtt; charset=utf-8');
      }
      return text(res, 200, await externalSubText(s.abs), 'text/plain; charset=utf-8');
    }

    if (M === 'GET' && kind === 'thumb') return sendFile(res, await thumbnail(abs), 86400);

    if (kind === 'subsearch' || kind === 'subdownload') {
      if (!OS_KEY && !SD_KEY) return json(res, 400, { error: 'Busca online não configurada: defina OPENSUBTITLES_API_KEY e/ou SUBDL_API_KEY no .env e reinicie o servidor.' });
      if (rootInfo(abs)?.flat) return json(res, 400, { error: 'Vídeos de "Outros" não usam legendas.' });
      try {
        if (M === 'GET' && kind === 'subsearch') return json(res, 200, await searchSubsOnline(abs));
        if (M === 'POST' && kind === 'subdownload') {
          const { src, ref, lang } = await readBody(req);
          if (!['os', 'sd'].includes(src) || typeof ref !== 'string') return json(res, 400, { error: 'legenda inválida' });
          if ((src === 'os' && !OS_KEY) || (src === 'sd' && !SD_KEY)) return json(res, 400, { error: 'fonte não configurada' });
          const r = await downloadSubOnline(abs, src, ref, lang);
          store.progress[abs] = { ...store.progress[abs], sub: r.key };
          persist();
          return json(res, 200, r);
        }
      } catch (e) {
        console.warn('[legendas online]', e.message);
        const msg = e.status === 401 || e.status === 403 ? `OpenSubtitles recusou a chave/login: ${e.message}` : e.message;
        return json(res, 502, { error: msg });
      }
    }

    if (M === 'POST' && kind === 'progress') {
      const body = await readBody(req);
      const pos = Number(body.position), dur = Number(body.duration);
      if (!Number.isFinite(pos) || pos < 0) return json(res, 400, { error: 'posição inválida' });
      const rel = abs;
      const prev = store.progress[rel] || {};
      const finished = dur > 0 && (pos / dur >= 0.92 || dur - pos < 30);
      store.progress[rel] = { ...prev, position: pos, duration: dur || prev.duration || 0, finished, updatedAt: Date.now(), ...(Number.isInteger(body.audio) ? { audio: body.audio } : {}) };
      persist();
      return json(res, 200, { ok: true, finished });
    }

    if (M === 'POST' && kind === 'subpref') {
      const { key } = await readBody(req);
      const { subs, vrel, trel } = await videoContext(abs);
      if (key === 'off') store.prefs[trel] = { ...store.prefs[trel], sub: { off: true } };
      else {
        const s = subs.find(x => x.key === key);
        if (!s) return json(res, 400, { error: 'legenda inválida' });
        const same = subs.filter(x => x.source === s.source && x.label === s.label);
        store.prefs[trel] = { ...store.prefs[trel], sub: { source: s.source, label: s.label, ordinal: same.indexOf(s) } };
      }
      store.progress[vrel] = { ...store.progress[vrel], sub: key };
      persist();
      return json(res, 200, { ok: true });
    }

    if (M === 'POST' && kind === 'watched') {
      const { watched } = await readBody(req);
      const rel = abs;
      const prev = store.progress[rel] || {};
      const dur = prev.duration || (await probe(abs)).duration;
      store.progress[rel] = watched
        ? { ...prev, position: dur, duration: dur, finished: true, updatedAt: Date.now() }
        : { ...prev, position: 0, duration: dur, finished: false, updatedAt: Date.now() };
      persist();
      return json(res, 200, { ok: true });
    }
  }

  if (M === 'GET' && (m = p.match(/^\/api\/poster\/([\w-]+)$/))) {
    const abs = decId(m[1]);
    if (!abs || !fs.existsSync(abs)) return json(res, 404, { error: 'não encontrado' });
    const t = await loadTitle(abs);
    if (t.dir) {
      const files = await fsp.readdir(t.dir);
      const poster = files.find(f => POSTER_NAMES.includes(f.toLowerCase()));
      if (poster) return sendFile(res, path.join(t.dir, poster), 3600);
    }
    if (!t.videos.length) return json(res, 404, { error: 'sem vídeos' });
    return sendFile(res, await thumbnail(t.videos[0]), 86400);
  }

  // APK do app (TV/celular): abra http://IP_DO_PC:PORTA/app.apk no aparelho para instalar
  if (M === 'GET' && p === '/app.apk') {
    const apk = path.join(ROOT, 'android', 'build', 'PlayerLocal.apk');
    if (!fs.existsSync(apk)) return text(res, 404, 'APK ainda não compilado (bash android/build.sh)');
    const data = await fsp.readFile(apk);
    res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': data.length,
      'Content-Disposition': 'attachment; filename="PlayerLocal.apk"', 'Cache-Control': 'no-store' });
    return res.end(data);
  }

  if (M === 'GET' && !p.startsWith('/api/')) {
    const f = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
    const abs = path.resolve(PUBLIC_DIR, f);
    if (abs.startsWith(PUBLIC_DIR + path.sep) && fs.existsSync(abs) && fs.statSync(abs).isFile()) return sendFile(res, abs);
  }
  return json(res, 404, { error: 'não encontrado' });
}

const server = http.createServer(async (req, res) => {
  try { await handle(req, res); }
  catch (e) {
    console.error(`[erro] ${req.method} ${req.url}:`, e.message);
    if (!res.headersSent) json(res, 500, { error: e.message }); else res.destroy();
  }
});

run(FFMPEG, ['-version']).catch(() => console.error('\n  !! ffmpeg não encontrado. Instale-o ou defina FFMPEG_PATH/FFPROBE_PATH.\n'));

// Descoberta automática na rede: o app da TV manda um broadcast UDP e o servidor responde com sua porta HTTP.
const DISCOVERY_PORT = Number(process.env.DISCOVERY_PORT) || 8765;
function startDiscovery(httpPort) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('message', (msg, rinfo) => {
    if (msg.toString('utf8').trim() !== 'PLAYER_LOCAL_DISCOVER') return;
    const reply = Buffer.from(JSON.stringify({ app: 'player-local', name: os.hostname(), port: httpPort }));
    sock.send(reply, rinfo.port, rinfo.address);
  });
  sock.on('error', e => console.warn(`  (descoberta automática indisponível: ${e.message})`));
  sock.bind(DISCOVERY_PORT, HOST);
}

// Tenta a porta configurada; se estiver ocupada/bloqueada, tenta as próximas.
function listen(port, attempt = 0) {
  const onError = err => {
    server.off('listening', onListening);
    if ((err.code === 'EADDRINUSE' || err.code === 'EACCES') && attempt < 20) {
      console.warn(`  Porta ${port} indisponível (${err.code}), tentando ${port + 1}…`);
      listen(port + 1, attempt + 1);
    } else {
      console.error(`\n  !! Não foi possível abrir o servidor: ${err.message}\n`);
      process.exit(1);
    }
  };
  function onListening() {
    server.off('error', onError);
    startDiscovery(port);
    console.log('\n  Player Local rodando!');
    console.log(`  Neste PC:  http://localhost:${port}`);
    for (const [name, addrs] of Object.entries(os.networkInterfaces()))
      for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) console.log(`  Na rede:   http://${a.address}:${port}   (${name})`);
    console.log('  Pastas:');
    for (const c of CATEGORIES) {
      const rs = ROOTS.filter(r => r.cat === c.key);
      console.log(`    ${c.name}${c.flat ? ' (todos os vídeos, sem legendas)' : ''}:`);
      for (const r of rs) console.log(`      ${r.abs}`);
      if (!rs.length) console.log('      (nenhuma pasta válida)');
    }
    if (!MEDIA_ROOTS.length) console.log('  !! Nenhuma pasta de vídeos válida. Configure PASTA_VIDEOS no arquivo .env');
    console.log('');
  }
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, HOST);
}
listen(PORT);
