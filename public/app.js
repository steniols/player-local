'use strict';
/* Player Local — front-end (sem frameworks; pensado para navegador de TV + controle remoto) */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmt(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}
const fmtLong = s => { const m = Math.round((s || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}min` : `${m} min`; };
async function api(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
const post = (url, body, extra = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...extra });

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>',
  cc: '<svg viewBox="0 0 24 24"><path d="M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1z"/></svg>',
  vol: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.47 4.47 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z"/></svg>',
  volLow: '<svg viewBox="0 0 24 24"><path d="M5 9v6h4l5 5V4L9 9H5zm13.5 3A4.5 4.5 0 0 0 16 7.97v8.05A4.47 4.47 0 0 0 18.5 12z"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06A7 7 0 0 1 19 12zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a9 9 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>',
  audio: '<svg viewBox="0 0 24 24"><path d="M12 3v9.28A4.39 4.39 0 0 0 10.5 12C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M18 6l-8.5 6 8.5 6V6zM6 6v12h2V6H6z"/></svg>',
  fs: '<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>',
  rew: '<svg viewBox="0 0 24 24"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>',
  fwd: '<svg viewBox="0 0 24 24"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>',
};

/* ------------------------------------------------------------ app Android TV */
// Dentro do app da TV a tela já é cheia; o botão Voltar do controle chega via window.__appBack().
const IN_APP = /PlayerLocalApp/.test(navigator.userAgent);
if (IN_APP) document.documentElement.classList.add('in-app');
// TV: o app (v1.2+) marca o user agent com "TV"
if (/PlayerLocalApp\/[\d.]+ TV\b/.test(navigator.userAgent)) document.documentElement.classList.add('tv');
window.__appBack = () => {
  const atHome = (location.hash || '#/') === '#/' && !view?.isPlayer;
  if (atHome) return false; // deixa o app fechar
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  return true;
};

// No app do celular: player deitado e sem barras do sistema (na TV não muda nada).
const appPlayerMode = on => { try { window.PlayerLocalApp?.playerMode?.(on); } catch { /* app antigo */ } };

/* ------------------------------------------------------------ tela cheia */
const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
function enterFs() {
  if (IN_APP || isFs()) return;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  try { const p = req?.call(el, { navigationUI: 'hide' }); p?.catch?.(() => {}); } catch { /* sem suporte */ }
}
function exitFs() {
  if (!isFs()) return;
  try { const p = (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); p?.catch?.(() => {}); } catch { /* */ }
}
// Ao escolher algo para assistir (clique/OK = gesto do usuário), já entra em tela cheia.
document.addEventListener('click', e => { if (e.target.closest?.('a[href^="#/play/"]')) enterFs(); }, true);

/* ------------------------------------------------------------ navegação por controle remoto */
const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const BACK_KEYS = new Set(['Escape', 'Backspace', 'BrowserBack', 'GoBack']);
const isBack = e => BACK_KEYS.has(e.key) || e.keyCode === 461 || e.keyCode === 10009;
const visible = el => el.getClientRects().length > 0;

function navMove(dir, scope = document) {
  const items = $$('.nav', scope).filter(visible);
  const cur = document.activeElement;
  if (!items.includes(cur)) { items[0]?.focus(); return; }
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const dx = b.left + b.width / 2 - cx, dy = b.top + b.height / 2 - cy;
    const [main, cross] = dir === 'right' ? [dx, dy] : dir === 'left' ? [-dx, dy] : dir === 'down' ? [dy, dx] : [-dy, dx];
    if (main <= 1) continue;
    // prioriza itens na mesma linha (←/→) ou coluna (↑/↓): ex. de "10s" para "Legendas" e não para a barra
    const horiz = dir === 'left' || dir === 'right';
    const aligned = horiz ? b.top < r.bottom && b.bottom > r.top : b.left < r.right && b.right > r.left;
    const score = (aligned ? 0 : 1e6) + main + Math.abs(cross) * 2.5;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) {
    best.classList.add('kbd');
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
}

let view = null;
function setView(v) { const old = view; view = v; old?.destroy?.(); }

document.addEventListener('keydown', e => {
  if (e.target.matches?.('input, textarea')) return;
  if (view?.onKey?.(e)) { e.preventDefault(); return; }
  const dir = DIRS[e.key];
  if (dir) { e.preventDefault(); navMove(dir); }
  else if (isBack(e)) { e.preventDefault(); view?.back?.(); }
});
document.addEventListener('mousedown', () => $$('.kbd').forEach(el => el.classList.remove('kbd')));
// Modo de entrada: o destaque de foco (borda amarela) só aparece para quem navega por controle/teclado.
// .touch (celular) e .mouse (PC, e também o estado inicial em qualquer aparelho) escondem o foco;
// usar setas/Enter/Tab volta ao modo controle. Fora do player, a 1ª seta só revela o item selecionado.
const htmlCls = document.documentElement.classList;
const inputMode = m => { htmlCls.toggle('touch', m === 'touch'); htmlCls.toggle('mouse', m === 'mouse'); };
inputMode(matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse');
document.addEventListener('touchstart', () => inputMode('touch'), { passive: true, capture: true });
document.addEventListener('mousemove', e => { if ((e.movementX || e.movementY) && !htmlCls.contains('touch')) inputMode('mouse'); }, { passive: true, capture: true });
document.addEventListener('keydown', e => {
  if (!(DIRS[e.key] || e.key === 'Enter' || e.key === 'Tab')) return;
  const hidden = htmlCls.contains('mouse') || htmlCls.contains('touch');
  inputMode('keys');
  if (hidden && DIRS[e.key] && !view?.isPlayer && document.activeElement?.closest?.('.nav')) {
    e.preventDefault(); e.stopImmediatePropagation();
    document.activeElement.classList.add('kbd');
  }
}, true);

// lembra o item focado em cada página, para voltar ao mesmo lugar
const focusKey = el => el.getAttribute('href') || el.dataset.key;
document.addEventListener('focusin', e => {
  const el = e.target.closest?.('.nav');
  if (!el || view?.isPlayer || el.dataset.nofocus != null) return;
  const k = focusKey(el);
  if (k) try { sessionStorage.setItem('f:' + location.hash, k); } catch { /* */ }
});
function restoreFocus(fallback) {
  let k = null;
  try { k = sessionStorage.getItem('f:' + location.hash); } catch { /* */ }
  const el = (k && $$('.nav').find(x => focusKey(x) === k)) || (fallback && $(fallback)) || $('.nav');
  if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
}

/* ------------------------------------------------------------ rotas */
async function route() {
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  try {
    if (parts[0] === 'play' && parts[1]) return await playerView(parts[1]);
    if (isFs()) exitFs();
    if (parts[0] === 't' && parts[1]) return await titleView(parts[1]);
    return await homeView();
  } catch (err) {
    console.error(err);
    setView({ back: () => { location.hash = '#/'; } });
    app.innerHTML = `<div class="page"><div class="empty">Algo deu errado: ${esc(err.message)}<br><br><a class="btn nav" href="#/">Voltar ao início</a></div></div>`;
    $('.nav')?.focus();
  }
}
window.addEventListener('hashchange', route);
route();

const thumbHtml = (src, letter, pct) => `
  <div class="thumb" data-l="${esc(letter)}">
    <img loading="lazy" src="${src}" alt="" onerror="this.remove()">
    ${pct != null ? `<div class="prog"><i style="width:${Math.min(100, Math.max(0, pct * 100)).toFixed(1)}%"></i></div>` : ''}
  </div>`;

/* ------------------------------------------------------------ "Outros": fila do Próximo/Anterior */
// Guarda na sessão a ordem dos vídeos de "Outros" mostrada na tela inicial, para o Próximo/Anterior
// do player seguir a mesma sequência.
function outrosQueue(home) {
  const order = [];
  for (const s of home.sections) if (s.flat) for (const x of s.titles) order.push({ id: x.firstVideo, label: x.name });
  try { sessionStorage.setItem('outros', JSON.stringify(order)); } catch { /* */ }
  return order;
}
async function outrosOrder() {
  try { const o = JSON.parse(sessionStorage.getItem('outros') || 'null'); if (o) return o; } catch { /* */ }
  return outrosQueue(await api('/api/home'));
}
// Modo aleatório (botão no player): preferência lembrada no aparelho; a fila embaralhada fica na sessão
// e é refeita ao ligar o modo, começando pelo vídeo atual.
const shuffleOn = () => { try { return localStorage.getItem('outrosShuffle') === '1'; } catch { return false; } };
function setShuffleOn(on) { try { localStorage.setItem('outrosShuffle', on ? '1' : '0'); } catch { /* */ } }
function shuffledQueue(order, currentId, fresh = false) {
  if (!fresh) {
    try {
      const q = JSON.parse(sessionStorage.getItem('outrosShuf') || 'null');
      if (q && q.length === order.length && q.some(o => o.id === currentId)) return q;
    } catch { /* */ }
  }
  const q = order.slice();
  for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
  const k = q.findIndex(o => o.id === currentId);
  if (k > 0) q.unshift(...q.splice(k, 1));
  try { sessionStorage.setItem('outrosShuf', JSON.stringify(q)); } catch { /* */ }
  return q;
}

/* ------------------------------------------------------------ início */
async function homeView() {
  setView({ back() {} });
  app.innerHTML = '<div class="loading">Carregando…</div>';
  const d = await api('/api/home');
  outrosQueue(d);
  app.innerHTML = `
    <div class="page">
      <div class="brand"><i></i>Player Local</div>
      ${d.continue.length ? `
        <h2>Continuar assistindo</h2>
        <div class="row">${d.continue.map(c => `
          <a class="card wide nav" href="#/play/${c.id}">
            ${thumbHtml(`/api/thumb/${c.id}`, c.titleName[0], c.duration ? c.position / c.duration : null)}
            <div class="meta"><b>${esc(c.titleName)}</b>
              <span>${c.single ? '' : esc(c.label) + ' · '}${c.isNext ? 'Próximo' : `${fmtLong(c.duration - c.position)} restantes`}</span></div>
          </a>`).join('')}
        </div>` : ''}
      ${d.sections.filter(s => s.titles.length).map(s => `
        <h2>${esc(s.name)}</h2>
        <div class="grid">${s.titles.map(t => `
          <a class="card nav" href="${t.single ? `#/play/${t.firstVideo}` : `#/t/${t.id}`}">
            ${thumbHtml(`/api/poster/${t.id}`, t.name[0], t.progress)}
            <div class="meta"><b>${esc(t.name)}</b>
              <span>${t.flat ? 'Vídeo' : t.single ? 'Filme' : `${t.count} vídeos${t.watched ? ` · ${t.watched} assistidos` : ''}`}</span></div>
          </a>`).join('')}</div>`).join('')}
      ${d.sections.some(s => s.titles.length) ? '' : '<div class="empty">Nenhum vídeo encontrado nas pastas configuradas.</div>'}
    </div>`;
  restoreFocus();
}

/* ------------------------------------------------------------ série / coleção */
async function titleView(id) {
  setView({ back() { location.hash = '#/'; } });
  app.innerHTML = '<div class="loading">Carregando…</div>';
  const d = await api(`/api/title/${id}`);
  const watched = d.videos.filter(v => v.finished).length;
  const nu = d.nextUp;
  const nuLabel = nu.code || nu.name;
  app.innerHTML = `
    <div class="hero" style="--img:url('/api/poster/${id}')">
      <a class="link nav" href="#/" data-nofocus>← Início</a>
      <h1>${esc(d.name)}</h1>
      <p>${d.videos.length} vídeos${watched ? ` · ${watched} assistidos` : ''}</p>
      <a class="btn primary nav" href="#/play/${nu.id}" data-key="resume">${ICON.play.replace('<svg', '<svg width="22" height="22" fill="currentColor"')}
        ${nu.position > 30 && !nu.finished ? `Continuar ${esc(nuLabel)}` : `Assistir ${esc(nuLabel)}`}</a>
    </div>
    <div class="eplist">${d.videos.map(v => `
      <div class="ep">
        <a class="ep-main nav" href="#/play/${v.id}">
          ${thumbHtml(`/api/thumb/${v.id}`, v.code || v.name[0], v.finished ? 1 : v.position > 0 && v.duration ? v.position / v.duration : null)}
          <div class="txt">
            ${v.code ? `<small>${esc(v.code)}</small>` : ''}
            <b>${esc(v.name)}</b>
            <span>${v.duration ? fmtLong(v.duration) : ''}${!v.finished && v.position > 30 && v.duration ? ` · faltam ${fmtLong(v.duration - v.position)}` : ''}</span>
          </div>
        </a>
        <button class="ghost nav ${v.finished ? 'on' : ''}" data-key="w:${v.id}" data-watch="${v.id}" data-on="${v.finished ? 1 : 0}">${v.finished ? '✓ Assistido' : 'Marcar assistido'}</button>
      </div>`).join('')}
    </div>`;
  app.onclick = async e => {
    const b = e.target.closest('[data-watch]');
    if (!b) return;
    await post(`/api/watched/${b.dataset.watch}`, { watched: b.dataset.on !== '1' });
    titleView(id);
  };
  view.destroy = () => { app.onclick = null; };
  restoreFocus('[data-key="resume"]');
}

/* ------------------------------------------------------------ legendas (parser SRT/VTT) */
function parseTs(s) {
  const p = s.replace(',', '.').split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}
function cueHtml(t) {
  t = t.replace(/\{\\[^}]*\}/g, '').replace(/\\N/gi, '\n');
  t = t.replace(/<(\/?)([ibu])(?:\.[^>]*)?>/gi, '\u0001$1$2\u0002').replace(/<[^>]*>/g, '');
  return esc(t).replace(/\u0001(\/?)([ibu])\u0002/gi, '<$1$2>').replace(/\n/g, '<br>');
}
function parseCues(txt) {
  const re = /((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/;
  const out = [];
  for (const block of txt.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const i = lines.findIndex(l => re.test(l));
    if (i < 0) continue;
    const m = lines[i].match(re);
    const text = lines.slice(i + 1).join('\n').trim();
    if (text) out.push({ s: parseTs(m[1]), e: parseTs(m[2]), h: cueHtml(text) });
  }
  return out.sort((a, b) => a.s - b.s);
}

/* ------------------------------------------------------------ player */
async function playerView(id) {
  let destroyed = false;
  const S = {
    info: null, offset: 0, pending: null, seekSeq: 0, loaded: false,
    cues: [], subKey: 'off', subDelay: 0, audio: null,
    hideTimer: 0, saveTimer: 0, raf: 0, toastTimer: 0, cdTimer: 0,
    menuKind: null, dialogResolve: null, userPaused: false, recover: 0, lastHtml: '', lastSec: -1,
  };

  app.innerHTML = `
    <div class="player loading ovshow" id="pl">
      <video id="v" playsinline preload="auto"></video>
      <div class="subs" id="subs"></div>
      <div class="seekflash" id="seekflash"></div>
      <div class="spin"></div>
      <div class="ov" id="ov">
        <div class="ov-top">
          <button class="pbtn nav" data-act="back" aria-label="Voltar">${ICON.back}</button>
          <div class="ptitle"><b id="pt1"></b><span id="pt2"></span></div>
        </div>
        <div class="ov-mid" id="ovmid"></div>
        <div class="ov-bottom">
          <div class="bar nav" id="bar" tabindex="0" role="slider" aria-label="Posição">
            <div class="buf" id="buf"></div><div class="fill" id="fill"></div><div class="knob" id="knob"></div>
          </div>
          <div class="times"><span id="tcur">0:00</span><span id="tdur"></span></div>
          <div class="btns">
            <button class="pbtn nav" data-act="rew" aria-label="Voltar 10 segundos">${ICON.rew}<span>10s</span></button>
            <button class="pbtn big nav" data-act="play" id="bplay" aria-label="Reproduzir/Pausar">${ICON.play}</button>
            <button class="pbtn nav" data-act="fwd" aria-label="Avançar 10 segundos"><span>10s</span>${ICON.fwd}</button>
            <div class="vol" id="volbox">
              <button class="pbtn" data-act="mute" id="bmute" aria-label="Silenciar">${ICON.vol}</button>
              <input type="range" id="vol" min="0" max="1" step="0.05" aria-label="Volume">
            </div>
            <span class="sp"></span>
            <button class="pbtn nav" data-act="subs" id="bsubs">${ICON.cc}<span>Legendas</span></button>
            <button class="pbtn nav" data-act="audio" id="baudio" hidden>${ICON.audio}<span>Áudio</span></button>
            <button class="pbtn nav" data-act="shuffle" id="bshuf" hidden aria-pressed="false">${ICON.shuffle}<span>Aleatório</span></button>
            <button class="pbtn nav" data-act="prev" id="bprev" hidden>${ICON.prev}<span>Anterior</span></button>
            <button class="pbtn nav" data-act="next" id="bnext" hidden>${ICON.next}<span>Próximo</span></button>
            <button class="pbtn nav" data-act="fs" aria-label="Tela cheia">${ICON.fs}</button>
          </div>
        </div>
      </div>
      <button class="nextep nav" id="bnextep" hidden>${ICON.next}<span>Próximo episódio</span></button>
      <div class="toast" id="toast"></div>
      <div class="menu" id="menu" hidden></div>
    </div>`;

  const pl = $('#pl'), video = $('#v'), subsEl = $('#subs'), ov = $('#ov'), menu = $('#menu');
  const bar = $('#bar'), fill = $('#fill'), knob = $('#knob'), buf = $('#buf');
  const tcur = $('#tcur'), tdur = $('#tdur'), bplay = $('#bplay'), toastEl = $('#toast');

  const absTime = () => S.pending ?? (S.offset + (video.currentTime || 0));
  const dur = () => S.info?.duration || 0;

  function toast(msg, ms = 2500) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(S.toastTimer);
    if (ms) S.toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }
  const hideToast = () => toastEl.classList.remove('show');

  /* ---- overlay de controles */
  const ovVisible = () => pl.classList.contains('ovshow');
  function showOv(focus = true) {
    pl.classList.add('ovshow');
    pl.classList.remove('idle');
    if (focus && !ov.contains(document.activeElement) && menu.hidden) bplay.focus({ preventScroll: true });
    clearTimeout(S.hideTimer);
    // some se o usuário não pausou (durante o carregamento após avançar, o vídeo fica "pausado" por instantes)
    S.hideTimer = setTimeout(() => { if (!S.userPaused && menu.hidden) hideOv(); }, 4000);
  }
  function hideOv() {
    clearTimeout(S.hideTimer);
    pl.classList.remove('ovshow');
    pl.classList.add('idle');
    // ao reaparecer, os controles voltam com o Play selecionado (não a barra de progresso),
    // para as setas laterais andarem entre os botões (Legendas, Áudio…)
    if (ov.contains(document.activeElement)) bplay.focus({ preventScroll: true });
  }

  /* ---- reprodução / busca */
  function togglePlay() {
    if (!S.loaded) return;
    if (video.paused) { S.userPaused = false; video.play().catch(() => {}); }
    else { S.userPaused = true; video.pause(); }
  }

  const inBuffered = rel => {
    for (let i = 0; i < video.buffered.length; i++)
      if (rel >= video.buffered.start(i) && rel <= video.buffered.end(i) - 0.5) return true;
    return false;
  };

  async function seekTo(t, force = false) {
    const D = dur();
    t = Math.max(0, D ? Math.min(t, D - 2) : t);
    const seq = ++S.seekSeq;
    S.pending = t;
    renderBar(true);
    if (!force && S.loaded && inBuffered(t - S.offset)) {
      video.currentTime = t - S.offset;
      S.pending = null;
      return;
    }
    pl.classList.add('loading');
    try {
      const { start } = await api(`/api/seek/${id}?t=${t.toFixed(3)}`);
      if (seq !== S.seekSeq || destroyed) return;
      S.offset = start;
      S.pending = null;
      S.loaded = true;
      video.src = `/api/stream/${id}?t=${start}${S.audio != null ? `&a=${S.audio}` : ''}`;
      try { await video.play(); }
      catch (err) { if (err.name === 'NotAllowedError') { S.userPaused = true; pl.classList.remove('loading'); showOv(); toast('Pressione OK para reproduzir'); } }
    } catch (err) {
      if (seq === S.seekSeq) { S.pending = null; toast('Erro ao carregar: ' + err.message, 5000); }
    }
  }

  let nudgeTimer = 0;
  function nudge(delta) {
    if (!S.loaded) return;
    const base = S.pending ?? absTime();
    S.pending = Math.max(0, Math.min(base + delta, dur() - 2));
    S.seekSeq++; // invalida buscas em andamento
    showOv(false);
    renderBar(true);
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => { const t = S.pending; S.pending = null; seekTo(t); save(); }, 650);
  }

  /* ---- progresso salvo no servidor */
  function save(beacon = false, position) {
    if (!S.info || !S.loaded || (S.pending != null && position == null)) return;
    const body = { position: position ?? absTime(), duration: dur(), audio: S.audio };
    if (beacon && navigator.sendBeacon) navigator.sendBeacon(`/api/progress/${id}`, new Blob([JSON.stringify(body)], { type: 'application/json' }));
    else post(`/api/progress/${id}`, body, { keepalive: beacon }).catch(() => {});
  }

  /* ---- legendas */
  async function setSub(key, persist = true) {
    S.subKey = key || 'off';
    S.cues = [];
    if (persist) post(`/api/subpref/${id}`, { key: S.subKey }).catch(() => {});
    if (S.subKey === 'off') return;
    const my = S.subKey;
    const slow = setTimeout(() => toast('Carregando legenda…', 0), 500);
    try {
      const r = await fetch(`/api/sub/${id}?key=${encodeURIComponent(my)}`);
      if (!r.ok) throw new Error(await r.text());
      const txt = await r.text();
      if (my !== S.subKey || destroyed) return;
      S.cues = parseCues(txt);
      clearTimeout(slow); hideToast();
      if (!S.cues.length) toast('Legenda vazia ou em formato não suportado', 4000);
    } catch (err) {
      clearTimeout(slow);
      if (my === S.subKey) toast('Falha ao carregar legenda', 4000);
      console.error(err);
    }
  }

  /* ---- loop de renderização (legendas + barra) */
  function renderBar(forceText = false) {
    const D = dur();
    const t = absTime();
    const pct = D ? Math.min(100, (t / D) * 100) : 0;
    fill.style.width = pct + '%';
    knob.style.left = pct + '%';
    if (D && video.buffered.length) {
      const end = S.offset + video.buffered.end(video.buffered.length - 1);
      buf.style.left = (S.offset / D) * 100 + '%';
      buf.style.width = Math.max(0, Math.min(100, ((end - S.offset) / D) * 100)) + '%';
    } else buf.style.width = '0';
    const sec = Math.floor(t);
    if (sec !== S.lastSec || forceText) { S.lastSec = sec; tcur.textContent = fmt(t); tdur.textContent = D ? `-${fmt(D - t)}` : ''; }
  }
  function tick() {
    if (destroyed) return;
    S.raf = requestAnimationFrame(tick);
    let html = '';
    if (S.cues.length && S.pending == null && S.loaded) {
      const t = S.offset + video.currentTime - S.subDelay;
      const act = [];
      for (const c of S.cues) { if (c.s > t) break; if (c.e > t) act.push(c.h); }
      html = act.join('<br>');
    }
    if (html !== S.lastHtml) { S.lastHtml = html; subsEl.innerHTML = html ? `<span>${html}</span>` : ''; }
    renderBar();
    updateNextEp();
  }

  /* ---- botão "Próximo episódio" durante os créditos (séries) */
  const bnextep = $('#bnextep');
  // capítulo de créditos quando o arquivo tem; senão, os últimos 5 min (no máximo 10% do episódio)
  const creditsAt = () => S.info.creditsAt ?? dur() - Math.min(300, dur() * 0.1);
  function updateNextEp() {
    const D = dur(), t = absTime();
    const on = !!(S.info?.next && !S.info.flat && D && S.loaded && menu.hidden && t >= creditsAt() && t < D - 1);
    if (on === !bnextep.hidden) return;
    bnextep.hidden = !on;
    // controle remoto: já deixa o botão selecionado para bastar apertar OK
    if (on && !ovVisible()) bnextep.focus({ preventScroll: true });
    else if (!on && document.activeElement === bnextep) bplay.focus({ preventScroll: true });
  }

  /* ---- menus e diálogos */
  function openMenu(html, onPick, { center = false, kind = 'menu' } = {}) {
    clearTimeout(S.hideTimer);
    menu.className = 'menu' + (center ? ' center' : '');
    menu.innerHTML = html;
    menu.hidden = false;
    S.menuKind = kind;
    menu.onclick = e => { const b = e.target.closest('[data-v]'); if (b) onPick(b.dataset.v, b); };
    const first = $('.mi.sel', menu) || $('.nav', menu);
    first?.focus();
    first?.scrollIntoView({ block: 'center' });
  }
  function closeMenu() {
    clearInterval(S.cdTimer);
    menu.hidden = true;
    menu.innerHTML = '';
    S.menuKind = null;
    showOv();
  }
  function choose(title, options, subtitle = '') {
    return new Promise(resolve => {
      S.dialogResolve = resolve;
      openMenu(`<div class="panel"><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
        <div class="list">${options.map((o, i) => `<button class="mi nav" data-v="${i}"><b>${esc(o.label)}</b>${o.detail ? `<small>${esc(o.detail)}</small>` : ''}</button>`).join('')}</div></div>`,
      v => { S.dialogResolve = null; menu.hidden = true; menu.innerHTML = ''; S.menuKind = null; resolve(options[+v].value); },
      { center: true, kind: 'dialog' });
    });
  }

  function subsMenu() {
    const list = S.info.subtitle.list;
    const item = (key, label, detail) => `<button class="mi nav ${S.subKey === key ? 'sel' : ''}" data-v="${esc(key)}"><b>${esc(label)}</b>${detail ? `<small>${esc(detail)}</small>` : ''}</button>`;
    const delayTxt = () => `Sincronia: ${S.subDelay > 0 ? '+' : ''}${S.subDelay.toFixed(1).replace('.', ',')}s`;
    openMenu(`<div class="panel"><h3>Legendas</h3>
      <div class="list">${item('off', 'Desligada', '')}${list.map(s => item(s.key, s.label, s.detail)).join('')}
        ${S.info.subSearch ? item('search', '🔍 Buscar legenda online…', 'OpenSubtitles e Subdl') : ''}</div>
      <div class="delay">
        <button class="mi nav" data-v="d-">−0,5s</button><span id="dly">${delayTxt()}</span><button class="mi nav" data-v="d+">+0,5s</button>
      </div></div>`,
    v => {
      if (v === 'd-' || v === 'd+') { S.subDelay = Math.round((S.subDelay + (v === 'd+' ? 0.5 : -0.5)) * 10) / 10; $('#dly').textContent = delayTxt(); return; }
      if (v === 'search') { searchSubs(); return; }
      setSub(v);
      closeMenu();
    });
  }

  /* ---- busca de legendas online */
  const LANG_TXT = { 'pt-BR': 'Português (Brasil)', 'pt-PT': 'Português (Portugal)', en: 'Inglês' };
  function infoPanel(title, msg) {
    openMenu(`<div class="panel"><h3>${esc(title)}</h3><p>${esc(msg)}</p>
      <div class="list"><button class="mi nav" data-v="back"><b>Voltar</b></button></div></div>`,
    () => subsMenu(), { kind: 'menu' });
  }
  async function searchSubs() {
    if (!S.info.subSearchReady) return infoPanel('Busca online', 'Defina OPENSUBTITLES_API_KEY e/ou SUBDL_API_KEY no arquivo .env e reinicie o servidor.');
    openMenu('<div class="panel"><h3>Buscando legendas…</h3><p>Consultando OpenSubtitles e Subdl</p><div class="pspin"></div></div>', () => {}, { kind: 'menu' });
    let d;
    try { d = await api(`/api/subsearch/${id}`); }
    catch (err) { if (!destroyed && S.menuKind) infoPanel('Busca online', errText(err)); return; }
    if (destroyed || S.menuKind !== 'menu') return;
    if (!d.results.length) return infoPanel('Nenhuma legenda encontrada', `Busca: ${d.query}`);
    const results = d.results;
    openMenu(`<div class="panel wide"><h3>Legendas online</h3><p>Busca: ${esc(d.query)}${d.warnings?.length ? `<br><span class="warn">${d.warnings.map(esc).join(' · ')}</span>` : ''}</p>
      <div class="list">${results.map((r, i) => `<button class="mi nav${r.blocked ? ' dim' : ''}" data-v="${i}"><b>${r.hashMatch || r.sameRelease ? '✔ ' : ''}${esc(r.release || 'Sem nome')}</b>
        <small>${[r.src === 'sd' ? 'Subdl' : 'OpenSubtitles', LANG_TXT[r.lang] || r.lang, r.hashMatch ? 'sincronizada com este arquivo' : r.sameRelease && 'mesma versão do arquivo',
          r.blocked && 'limite diário atingido', r.downloads != null && `${r.downloads.toLocaleString('pt-BR')} downloads`, r.pack && 'pacote da temporada',
          r.sdh && 'SDH', r.machine && 'tradução automática'].filter(Boolean).map(esc).join(' · ')}</small></button>`).join('')}</div></div>`,
    v => downloadSub(results[+v]), { kind: 'menu' });
  }
  async function downloadSub(r) {
    openMenu('<div class="panel"><h3>Baixando legenda…</h3><div class="pspin"></div></div>', () => {}, { kind: 'menu' });
    try {
      const resp = await post(`/api/subdownload/${id}`, { src: r.src, ref: r.ref, lang: r.lang });
      const j = await resp.json();
      if (!resp.ok) throw new Error(j.error || resp.statusText);
      const fresh = await api(`/api/video/${id}`);
      if (destroyed) return;
      S.info.subtitle = fresh.subtitle;
      $('#bsubs').hidden = false;
      closeMenu();
      await setSub(j.key);
      toast(`Legenda baixada${j.remaining != null ? ` (restam ${j.remaining} downloads hoje)` : ''}`, 4000);
    } catch (err) {
      if (!destroyed) infoPanel('Falha ao baixar', errText(err));
    }
  }
  const errText = err => { const m = String(err.message || err); try { return JSON.parse(m.replace(/^\d+ /, '')).error || m; } catch { return m; } };

  function audioMenu() {
    openMenu(`<div class="panel"><h3>Áudio</h3><div class="list">${S.info.audio.map(a =>
      `<button class="mi nav ${a.index === S.audio ? 'sel' : ''}" data-v="${a.index}"><b>${esc(a.label)}</b></button>`).join('')}</div></div>`,
    v => {
      closeMenu();
      if (+v === S.audio) return;
      S.audio = +v;
      save();
      seekTo(absTime(), true);
    });
  }

  // "Outros": anterior/próximo seguem a ordem da tela inicial ou a fila aleatória (ambas circulares)
  function applyOutrosQueue(fresh = false) {
    const info = S.info, order = S.outros || [];
    const q = shuffleOn() ? shuffledQueue(order, info.id, fresh) : order;
    const i = q.findIndex(o => o.id === info.id);
    if (i >= 0 && q.length > 1) {
      info.next = q[(i + 1) % q.length];
      info.prev = q[(i - 1 + q.length) % q.length];
    }
    const b = $('#bshuf');
    b.hidden = order.length < 3;
    b.classList.toggle('on', shuffleOn());
    b.setAttribute('aria-pressed', String(shuffleOn()));
    $('#bnext').hidden = !info.next;
    $('#bprev').hidden = !info.prev;
  }
  function toggleShuffle() {
    setShuffleOn(!shuffleOn());
    applyOutrosQueue(true);
    toast(shuffleOn() ? 'Aleatório ligado' : 'Aleatório desligado');
  }
  function goNext() {
    if (!S.info?.next) return;
    location.replace(`#/play/${S.info.next.id}`);
  }
  function goPrev() {
    if (!S.info?.prev) return;
    location.replace(`#/play/${S.info.prev.id}`);
  }
  function exit() {
    location.hash = S.info && !S.info.single ? `#/t/${S.info.titleId}` : '#/';
  }

  function showNextCountdown() {
    let n = 10;
    openMenu(`<div class="panel"><small>A seguir</small><h3>${esc(S.info.next.label)}</h3><p id="cd">Começa em ${n}s</p>
      <div class="list"><button class="mi nav" data-v="go"><b>Assistir agora</b></button><button class="mi nav" data-v="no"><b>Cancelar</b></button></div></div>`,
    v => { clearInterval(S.cdTimer); if (v === 'go') goNext(); else closeMenu(); }, { kind: 'next' });
    S.cdTimer = setInterval(() => {
      n--;
      const cd = $('#cd');
      if (cd) cd.textContent = `Começa em ${n}s`;
      if (n <= 0) { clearInterval(S.cdTimer); goNext(); }
    }, 1000);
  }

  /* ---- eventos do vídeo */
  video.addEventListener('playing', () => { pl.classList.remove('loading'); S.recover = 0; });
  video.addEventListener('waiting', () => pl.classList.add('loading'));
  video.addEventListener('play', () => { bplay.innerHTML = ICON.pause; showOv(false); });
  video.addEventListener('pause', () => { bplay.innerHTML = ICON.play; if (!destroyed) { showOv(false); save(); } });
  video.addEventListener('ended', () => {
    const t = absTime();
    if (dur() && t < dur() - 30 && S.recover < 3) { // stream caiu antes do fim: reconecta
      S.recover++; toast('Reconectando…'); seekTo(t, true); return;
    }
    save(false, dur());
    if (S.info.next) showNextCountdown(); else showOv();
  });
  video.addEventListener('error', () => {
    if (!S.loaded || destroyed) return;
    if (S.recover < 3) { S.recover++; toast('Erro de reprodução, tentando novamente…'); seekTo(absTime(), true); }
    else { pl.classList.remove('loading'); toast('Não foi possível reproduzir este vídeo', 6000); }
  });

  /* ---- mouse / toque */
  pl.addEventListener('mousemove', () => showOv(false));
  // Toque duplo (celular): lado direito avança 10s, esquerdo volta 10s; toques seguidos acumulam.
  const isTouch = () => document.documentElement.classList.contains('touch');
  const tap = { t: 0, side: 0, timer: 0, total: 0, flashTimer: 0 };
  const flash = $('#seekflash');
  function seekFlash(side) {
    tap.total += 10;
    flash.className = 'seekflash show ' + (side > 0 ? 'right' : 'left');
    flash.textContent = side > 0 ? `+${tap.total}s ▸▸` : `◂◂ −${tap.total}s`;
    clearTimeout(tap.flashTimer);
    tap.flashTimer = setTimeout(() => { flash.className = 'seekflash'; tap.total = 0; }, 700);
  }
  pl.addEventListener('click', e => {
    if (!menu.hidden) { if (e.target === menu && S.menuKind === 'menu') closeMenu(); return; }
    if (e.target.closest('#bnextep')) { goNext(); return; }
    enterFs();
    const onVideo = !e.target.closest('[data-act], .bar, .ov-top, .ov-bottom');
    if (isTouch() && onVideo) {
      const x = e.clientX / pl.clientWidth;
      const side = x < 0.4 ? -1 : x > 0.6 ? 1 : 0;
      const now = Date.now();
      if (side && side === tap.side && now - tap.t < 400) { // 2º toque (ou mais) no mesmo lado
        clearTimeout(tap.timer);
        tap.t = now;
        nudge(side * 10);
        seekFlash(side);
        return;
      }
      tap.t = now; tap.side = side;
      if (side) { // toque simples nas laterais: espera para ver se vem o segundo toque
        const wasVisible = ovVisible();
        clearTimeout(tap.timer);
        tap.timer = setTimeout(() => { tap.side = 0; if (!wasVisible) showOv(false); else hideOv(); }, 400);
        return;
      }
    }
    if (!ovVisible()) {
      if (k === 'Enter' && !bnextep.hidden && document.activeElement === bnextep) { goNext(); return true; } showOv(false); return; }
    if (e.target.closest('#ovmid')) { togglePlay(); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    showOv(false);
    switch (b.dataset.act) {
      case 'back': exit(); break;
      case 'play': togglePlay(); break;
      case 'rew': nudge(-10); break;
      case 'fwd': nudge(10); break;
      case 'subs': subsMenu(); break;
      case 'audio': audioMenu(); break;
      case 'next': goNext(); break;
      case 'prev': goPrev(); break;
      case 'shuffle': toggleShuffle(); break;
      case 'fs': isFs() ? exitFs() : enterFs(); break;
      case 'mute': setVolume(video.volume || S.lastVol || 1, !video.muted); break;
    }
  });
  $('#ovmid').addEventListener('dblclick', () => { if (!isTouch()) isFs() ? exitFs() : enterFs(); });
  bar.addEventListener('click', e => {
    const r = bar.getBoundingClientRect();
    seekTo(((e.clientX - r.left) / r.width) * dur());
  });

  /* ---- teclado / controle remoto */
  const onKey = e => {
    const k = e.key, kc = e.keyCode, d = DIRS[k];
    if (k !== 'Escape' && !isFs() && S.menuKind !== 'dialog') enterFs();
    if (k === 'MediaPlayPause' || kc === 10252 || kc === 179) { togglePlay(); return true; }
    if (k === 'MediaPlay' || kc === 415) { S.userPaused = false; video.play().catch(() => {}); return true; }
    if (k === 'MediaPause' || kc === 19) { S.userPaused = true; video.pause(); return true; }
    if (k === 'MediaFastForward' || kc === 417) { nudge(30); return true; }
    if (k === 'MediaRewind' || kc === 412) { nudge(-30); return true; }
    if (k === 'MediaTrackNext' && S.info?.next) { goNext(); return true; }
    if (k === 'MediaTrackPrevious' && S.info?.prev) { goPrev(); return true; }

    if (!menu.hidden) {
      if (isBack(e)) { if (S.menuKind === 'dialog') exit(); else closeMenu(); return true; }
      if (d) { navMove(d, menu); return true; }
      return false; // Enter → clique nativo no botão focado
    }
    if (!S.loaded) { if (isBack(e)) { exit(); return true; } return false; }

    if (!ovVisible()) {
      if (d === 'left') { nudge(-10); return true; }
      if (d === 'right') { nudge(10); return true; }
      if (k === 'Enter' || k === ' ') { togglePlay(); showOv(); return true; }
      if (d) { showOv(); return true; }
      if (isBack(e)) { exit(); return true; }
      if (k === 'f') { isFs() ? exitFs() : enterFs(); return true; }
      if (k === 'm') { setVolume(video.volume || S.lastVol || 1, !video.muted); showOv(false); return true; }
      return false;
    }
    showOv(false);
    if (document.activeElement === bar) {
      if (d === 'left' || d === 'right') { nudge(d === 'left' ? -10 : 10); return true; }
      if (k === 'Enter') { togglePlay(); return true; }
    }
    // fim da linha de botões (ex.: Legendas) + → : vai para a barra de progresso
    if (d === 'right') {
      const row = $$('.btns .nav', ov).filter(visible);
      if (row.length && document.activeElement === row[row.length - 1]) { bar.classList.add('kbd'); bar.focus({ preventScroll: true }); return true; }
    }
    if (d) { navMove(d, pl); return true; } // controles + botão "Próximo episódio"
    if (k === ' ') { togglePlay(); return true; }
    if (isBack(e)) { if (!S.userPaused) hideOv(); else exit(); return true; }
    return false;
  };

  const onHide = () => { if (document.visibilityState === 'hidden') save(true); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);

  appPlayerMode(true);
  setView({
    isPlayer: true,
    onKey,
    back: exit,
    destroy() {
      destroyed = true;
      appPlayerMode(false);
      save(true);
      cancelAnimationFrame(S.raf);
      clearInterval(S.saveTimer); clearInterval(S.cdTimer);
      clearTimeout(S.hideTimer); clearTimeout(S.toastTimer); clearTimeout(nudgeTimer);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  });

  /* ---- volume (PC e celular; na TV o volume é o do controle) */
  const volEl = $('#vol'), bmute = $('#bmute');
  function setVolume(v, muted = false) {
    v = Math.max(0, Math.min(1, +v || 0));
    if (v > 0) S.lastVol = v;
    video.volume = v;
    video.muted = muted || v === 0;
    const shown = video.muted ? 0 : v;
    volEl.value = shown;
    volEl.style.setProperty('--p', shown * 100 + '%');
    bmute.innerHTML = shown === 0 ? ICON.mute : shown < 0.5 ? ICON.volLow : ICON.vol;
    bmute.setAttribute('aria-label', video.muted ? 'Ativar som' : 'Silenciar');
    try { localStorage.setItem('volume', JSON.stringify({ v: S.lastVol ?? v, m: video.muted })); } catch { /* */ }
  }
  volEl.addEventListener('input', () => { setVolume(volEl.value); showOv(false); });
  {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('volume') || 'null'); } catch { /* */ }
    setVolume(saved?.v ?? 1, !!saved?.m);
  }

  /* ---- inicialização */
  S.raf = requestAnimationFrame(tick);
  S.saveTimer = setInterval(() => { if (!video.paused && S.pending == null) save(); }, 10000);

  const info = await api(`/api/video/${id}`);
  if (info.flat) S.outros = await outrosOrder().catch(() => []);
  if (destroyed) return;
  S.info = info;
  S.audio = info.audioSelected;
  $('#pt1').textContent = info.titleName;
  $('#pt2').textContent = info.single ? '' : info.label;
  document.title = `${info.single ? info.titleName : info.label} — Player Local`;
  $('#bnext').hidden = !info.next;
  $('#bprev').hidden = !info.prev;
  if (info.flat) applyOutrosQueue();
  $('#baudio').hidden = info.audio.length < 2;
  $('#bsubs').hidden = !info.subtitle.list.length && !info.subSearch;
  renderBar(true);

  let subKey = info.subtitle.selected;
  if (subKey == null && info.subtitle.choices.length) {
    pl.classList.remove('loading');
    subKey = await choose('Qual legenda usar?',
      [...info.subtitle.choices.map(c => ({ value: c.key, label: c.label, detail: c.detail })), { value: 'off', label: 'Sem legenda' }],
      'Há mais de uma legenda em português. A escolha fica salva para os próximos episódios.');
    if (destroyed) return;
    setSub(subKey, true);
  } else setSub(subKey, false);

  let start = 0;
  const pr = info.progress;
  if (pr && !pr.finished && pr.position > 30) {
    pl.classList.remove('loading');
    start = await choose('Continuar de onde parou?', [
      { value: pr.position, label: `Continuar de ${fmt(pr.position)}` },
      { value: 0, label: 'Começar do início' },
    ]);
    if (destroyed) return;
  }
  hideOv();
  await seekTo(start, true);
  if (!destroyed && info.subSearch && !info.subtitle.list.some(s => s.lang === 'pt-BR'))
    toast('Sem legenda em português. Busque em Legendas → Buscar legenda online', 6000);
}
