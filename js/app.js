import { Calc, fmtMult } from './calc.js';

/* ---------- costanti ---------- */
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
const AVAILABLE_GENS = new Set([1, 2, 3, 4, 5, 6, 7, 8]); // generazioni di origine presenti nel Pokédex di Galar
const GAMES = [
  { dex: 27, name: 'Spada / Scudo', sub: 'Pokédex di Galar' },
  { dex: 28, name: 'L’Isola Solitaria dell’Armatura', sub: 'Espansione 1' },
  { dex: 29, name: 'Le Terre Innevate della Corona', sub: 'Espansione 2' },
];
const STAT_SHORT = ['PS', 'Att', 'Dif', 'AttS', 'DifS', 'Vel'];
const STAT_FULL = ['PS', 'Attacco', 'Difesa', 'Att. Speciale', 'Dif. Speciale', 'Velocità'];
const RADAR_ORDER = [0, 1, 2, 5, 4, 3]; // PS, Att, Dif, Vel, DifS, AttS (senso orario)
const PAGE_SIZE = 30;
const STORE_KEY = 'ptb.team.gen8.v1';
const $ = s => document.querySelector(s);

/* ---------- stato ---------- */
const state = {
  team: Array(6).fill(null),   // {pid, ability, item, moves:[4]}
  selected: 0,
  view: 'def',
  box: { open: false, slot: 0, page: 0 },
  filter: { q: '', gen: null, dex: new Set(GAMES.map(g => g.dex)) },
};
let calc, core, moves;

/* ---------- utilità ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const iconUrl = id => `assets/icons/${id}.png`;
const pad = n => String(n).padStart(3, '0');

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
function typeBadge(id, short = false) {
  const t = calc.typeById.get(id);
  const dark = lum(t.color) > 0.62;
  return `<span class="tb${dark ? ' dark' : ''}${short ? ' short' : ''}" style="--c:${t.color}" title="${esc(t.name)}"><b>${esc(t.name)}</b></span>`;
}
const poke = id => calc.pokeById.get(id);

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ team: state.team, selected: state.selected, view: state.view })); } catch { /* storage non disponibile */ }
}
function restore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!raw) return;
    state.team = (raw.team || []).slice(0, 6).map(s => (s && calc.pokeById.has(s.pid) ? { pid: s.pid, ability: s.ability ?? null, item: s.item ?? null, moves: (s.moves || []).slice(0, 4).concat([null, null, null, null]).slice(0, 4) } : null));
    while (state.team.length < 6) state.team.push(null);
    state.selected = Math.min(5, Math.max(0, raw.selected | 0));
    state.view = raw.view === 'off' ? 'off' : 'def';
  } catch { /* dati corrotti: si riparte da zero */ }
}

/* ---------- filtro box ---------- */
function filtered() {
  const q = norm(state.filter.q.trim());
  const { gen, dex } = state.filter;
  return core.pokemon.filter(p => {
    if (gen && p.gen !== gen) return false;
    if (!p.dex.some(d => dex.has(d))) return false;
    if (q) {
      const hay = norm(p.name) + ' ' + p.key + ' ' + p.sp + ' ' + pad(p.sp);
      if (!hay.includes(q.replace(/^#/, ''))) return false;
    }
    return true;
  });
}

/* ---------- render: sidebar ---------- */
function renderFilters() {
  $('#genGrid').innerHTML =
    `<button class="gen-all" data-action="gen" data-gen="" aria-pressed="${state.filter.gen === null}">Tutte</button>` +
    ROMAN.map((r, i) => {
      const g = i + 1, ok = AVAILABLE_GENS.has(g);
      return `<button class="gen" data-action="gen" data-gen="${g}" aria-pressed="${state.filter.gen === g}" ${ok ? '' : 'disabled title="Non ancora disponibile"'}>${r}</button>`;
    }).join('');
  $('#games').innerHTML = GAMES.map(g => {
    const on = state.filter.dex.has(g.dex);
    return `<li><button class="game" data-action="game" data-dex="${g.dex}" aria-pressed="${on}"><span class="check"></span><span><b>${esc(g.name)}</b><small>${esc(g.sub)}</small></span></button></li>`;
  }).join('');
}

/* ---------- render: matrice ---------- */
function cellClass(view, v) {
  if (v == null) return 'empty';
  if (view === 'def') {
    const m = v;
    if (m === 0) return 'imm';
    if (m >= 4) return 'w4';
    if (m > 1) return 'w2';
    if (m <= 0.25) return 'r2';
    if (m < 1) return 'r1';
    return '';
  }
  const m = v.m;
  if (m === 0) return 'imm';
  if (m >= 4) return 'g4' + (v.est ? ' est' : '');
  if (m > 1) return 'g2' + (v.est ? ' est' : '');
  if (m < 1) return 'b' + (v.est ? ' est' : '');
  return v.est ? 'est' : '';
}
function renderMatrix() {
  const rows = calc.table(state.team);
  const def = state.view === 'def';
  let html = `<div class="mx-corner"></div>`;
  html += state.team.map((s, i) => s
    ? `<button class="mx-head${i === state.selected ? ' sel' : ''}" data-action="select" data-slot="${i}" title="${esc(poke(s.pid).name)}"><img src="${iconUrl(s.pid)}" alt="${esc(poke(s.pid).name)}" width="68" height="56"></button>`
    : `<button class="mx-head none" data-action="select" data-slot="${i}" aria-label="Slot ${i + 1} vuoto"><span>+</span></button>`).join('');
  html += `<div class="mx-head team-col" title="${def ? 'Squadra: deboli / resistenti' : 'Squadra: Pokémon che colpiscono superefficace'}">Sq.</div>`;
  for (const r of rows) {
    html += `<div class="mx-type">${typeBadge(r.type.id, true)}</div>`;
    r.def.forEach((v, i) => {
      const val = def ? v : r.off[i];
      const cls = cellClass(state.view, val);
      const text = val == null ? '' : fmtMult(def ? val : val.m);
      let tip = '';
      if (val != null) {
        const who = poke(state.team[i].pid).name;
        tip = def
          ? `${who} subisce ${fmtMult(val) || '1×'} da ${r.type.name}`
          : `${who} → ${r.type.name}: ${fmtMult(val.m) || '1×'}${val.est ? ' (stima STAB, nessuna mossa scelta)' : ''}`;
      }
      html += `<div class="mx-cell ${cls}${i === state.selected ? ' sel' : ''}" title="${esc(tip)}">${text}</div>`;
    });
    if (def) {
      const none = r.weak === 0 && r.resist === 0;
      html += `<div class="mx-cell team-col ${r.weak >= 3 && r.weak > r.resist ? 'alert' : ''}">${none ? '' : `<b class="wk">${r.weak || '·'}</b><i class="rs">${r.resist || '·'}</i>`}</div>`;
    } else {
      html += `<div class="mx-cell team-col ${r.hit === 0 && state.team.some(Boolean) ? 'alert' : ''}">${state.team.some(Boolean) ? `<b class="${r.hit ? 'good' : 'wk'}">${r.hit}</b>` : ''}</div>`;
    }
  }
  $('#matrix').innerHTML = html;
  $('#legend').innerHTML = def
    ? `<span class="lg w4">4×</span><span class="lg w2">2×</span><span class="lg">neutro</span><span class="lg r1">½</span><span class="lg r2">¼</span><span class="lg imm">0</span><em>Danno subito dal tipo in riga (con abilità e strumento). Sq.: <b class="wk">deboli</b> / <i class="rs">resistenti</i>.</em>`
    : `<span class="lg g4">4×</span><span class="lg g2">2×</span><span class="lg">neutro</span><span class="lg b">½</span><span class="lg imm">0</span><em>Miglior danno inflitto con le mosse scelte; senza mosse è una stima STAB (colori sbiaditi). Sq.: Pokémon che colpiscono superefficace.</em>`;
  document.querySelectorAll('.vbtn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
}

/* ---------- render: squadra ---------- */
function renderTeam() {
  $('#team').innerHTML = state.team.map((s, i) => {
    const sel = i === state.selected ? ' sel' : '';
    if (!s) return `<button class="slot empty${sel}" data-action="open-box" data-slot="${i}"><span class="sprite plus">+</span><span class="slot-body"><b>Slot ${i + 1}</b><small>Tocca per scegliere</small></span></button>`;
    const p = poke(s.pid);
    return `<div class="slot${sel}" data-action="select" data-slot="${i}" role="button" tabindex="0">
      <span class="sprite">${sel ? '<i class="mark"></i>' : ''}<img src="${iconUrl(p.id)}" alt="" width="68" height="56"></span>
      <span class="slot-body">
        <b class="pname">${esc(p.name)}</b>
        <span class="types">${p.types.map(t => typeBadge(t)).join('')}</span>
      </span>
      <button class="mini" data-action="open-box" data-slot="${i}" aria-label="Cambia Pokémon" title="Cambia">⇄</button>
    </div>`;
  }).join('');
}

/* ---------- render: dettaglio ---------- */
function radarSVG(values, avg) {
  const size = 220, c = size / 2, R = 78, max = 200;
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 6;
    const r = R * Math.min(1, v / max);
    return [c + r * Math.cos(a), c + r * Math.sin(a)];
  };
  const poly = vals => RADAR_ORDER.map((si, i) => pt(i, vals[si]).join(',')).join(' ');
  const rings = [0.25, 0.5, 0.75, 1].map(f => `<polygon points="${RADAR_ORDER.map((_, i) => pt(i, max * f).join(',')).join(' ')}" class="ring"/>`).join('');
  const axes = RADAR_ORDER.map((_, i) => { const [x, y] = pt(i, max); return `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" class="axis"/>`; }).join('');
  const labels = RADAR_ORDER.map((si, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 6;
    const lx = c + (R + 24) * Math.cos(a), ly = c + (R + 22) * Math.sin(a);
    return `<text x="${lx}" y="${ly - 3}" class="lab">${STAT_SHORT[si]}</text><text x="${lx}" y="${ly + 10}" class="val">${Math.round(values[si])}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" class="radar" role="img" aria-label="Statistiche base">
    ${rings}${axes}
    ${avg ? `<polygon points="${poly(avg)}" class="avg"/>` : ''}
    <polygon points="${poly(values)}" class="shape"/>
    ${labels}</svg>`;
}

function renderDetail() {
  const s = state.team[state.selected];
  const avg = calc.statAverages(state.team);
  let html = '';
  if (!s) {
    html += `<div class="d-head empty"><span class="no">Slot ${state.selected + 1}</span><h2>Nessun Pokémon</h2></div>
      <div class="d-body"><p class="hint">Scegli un Pokémon dal box per vederne statistiche, abilità e mosse.</p>
      <button class="pill" data-action="open-box" data-slot="${state.selected}">Apri il box</button></div>`;
  } else {
    const p = poke(s.pid);
    const ab = s.ability != null ? core.abilities[s.ability] : null;
    const item = s.item != null ? calc.itemById.get(s.item) : null;
    const bst = p.stats.reduce((a, b) => a + b, 0);
    html += `<div class="d-head">
        <span class="no">N. ${pad(p.sp)}</span>
        <h2>${esc(p.name)}</h2>
        <span class="types">${p.types.map(t => typeBadge(t)).join('')}</span>
      </div>
      <div class="d-body">
        <div class="radar-wrap">${radarSVG(p.stats, avg && state.team.filter(Boolean).length > 1 ? avg : null)}
          <p class="radar-note">Totale base <b>${bst}</b>${state.team.filter(Boolean).length > 1 ? ' · linea tratteggiata: media squadra' : ''}</p></div>

        <h3 class="sec">Abilità</h3>
        <div class="abil">
          ${p.abilities.map(a => {
            const d = core.abilities[a.id];
            return `<button class="chip${s.ability === a.id ? ' on' : ''}" data-action="ability" data-id="${a.id}">${esc(d.name)}${a.hidden ? ' <small>nascosta</small>' : ''}${d.def || d.off ? ' <i class="fx" title="Modifica tipi">◆</i>' : ''}</button>`;
          }).join('')}
        </div>
        <p class="effect">${ab ? esc(ab.effect) : ''}${ab && ab.effectLang === 'en' ? ' <em>(testo in inglese)</em>' : ''}</p>

        <h3 class="sec">Oggetto</h3>
        <select class="select" id="itemSel" aria-label="Oggetto">
          <option value="">— nessuno —</option>
          <optgroup label="Influenzano le resistenze">
            ${core.items.filter(i => i.def || i.berry).map(i => `<option value="${i.id}"${s.item === i.id ? ' selected' : ''}>${esc(i.name)}</option>`).join('')}
          </optgroup>
          <optgroup label="Altri oggetti">
            ${core.items.filter(i => !i.def && !i.berry).map(i => `<option value="${i.id}"${s.item === i.id ? ' selected' : ''}>${esc(i.name)}</option>`).join('')}
          </optgroup>
        </select>
        <p class="effect">${item ? esc(item.effect) : ''}${item && item.effectLang !== 'it' ? ' <em>(testo in inglese)</em>' : ''}</p>

        <h3 class="sec">Mosse</h3>
        <div class="moves">
          ${[0, 1, 2, 3].map(k => moveSelect(p, s, k)).join('')}
        </div>
      </div>`;
  }
  html += summaryHTML();
  $('#detail').innerHTML = html;
}

function moveSelect(p, s, k) {
  const cur = s.moves[k];
  const list = p.moves.map(id => ({ id, m: moves[id] })).sort((a, b) => a.m[0].localeCompare(b.m[0], 'it'));
  const m = cur ? moves[cur] : null;
  return `<div class="move">
    <span class="mt">${m ? typeBadge(m[1], true) : '<span class="tb ph"><b>—</b></span>'}</span>
    <select class="select" data-move="${k}" aria-label="Mossa ${k + 1}">
      <option value="">— mossa ${k + 1} —</option>
      ${list.map(({ id, m: mv }) => `<option value="${id}"${cur === id ? ' selected' : ''}>${esc(mv[0])} · ${esc(calc.typeById.get(mv[1]).name)}${mv[2] ? ' · ' + mv[2] : mv[3] === 1 ? ' · stato' : ''}</option>`).join('')}
    </select>
  </div>`;
}

function summaryHTML() {
  const filled = state.team.filter(Boolean);
  let body;
  if (!filled.length) {
    body = `<p class="hint">Aggiungi dei Pokémon per vedere la sintesi.</p>`;
  } else {
    const rows = calc.table(state.team);
    const weak = rows.filter(r => r.weak >= 2 && r.weak > r.resist).sort((a, b) => (b.weak - b.resist) - (a.weak - a.resist));
    const missing = rows.filter(r => r.hit === 0);
    const avg = calc.statAverages(state.team);
    const order = [0, 1, 2, 3, 4, 5].sort((a, b) => avg[b] - avg[a]);
    const top = order[0], worst = order[5];
    const anyEst = filled.some(s => calc.damagingMoves(s).length === 0);
    body = `
      <dl class="sum">
        <dt>Debolezze</dt>
        <dd>${weak.length ? weak.map(r => `<span class="tc">${typeBadge(r.type.id, true)}<em>${r.weak}/${filled.length}</em></span>`).join('') : '<span class="ok">Nessuna debolezza condivisa</span>'}</dd>
        <dt>Coperture off. mancanti</dt>
        <dd>${missing.length ? missing.map(r => typeBadge(r.type.id, true)).join('') : '<span class="ok">Tutti i tipi sono coperti</span>'}${anyEst ? '<small class="note">Stima STAB per i Pokémon senza mosse.</small>' : ''}</dd>
        <dt>Top caratteristica</dt>
        <dd><b class="stat good">${STAT_FULL[top]}</b> <span class="num">media ${Math.round(avg[top])}</span></dd>
        <dt>Worst caratteristica</dt>
        <dd><b class="stat bad">${STAT_FULL[worst]}</b> <span class="num">media ${Math.round(avg[worst])}</span></dd>
      </dl>`;
  }
  return `<div class="d-sum"><h3 class="sec big">Sintesi squadra</h3>${body}</div>`;
}

/* ---------- render: box ---------- */
function renderBox() {
  if (!state.box.open) return;
  const list = filtered();
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  state.box.page = Math.min(state.box.page, pages - 1);
  const start = state.box.page * PAGE_SIZE;
  const slice = list.slice(start, start + PAGE_SIZE);
  const slot = state.box.slot;
  $('#boxTitle').textContent = `Box · slot ${slot + 1}`;
  $('#pageLabel').textContent = list.length ? `${start + 1}-${start + slice.length}` : '0';
  $('#boxCount').textContent = `${list.length} Pokémon · pag. ${state.box.page + 1}/${pages}`;
  $('#boxGrid').innerHTML = slice.length
    ? slice.map(p => {
        const used = state.team.some((s, i) => s && s.pid === p.id && i !== slot);
        return `<button class="cell${used ? ' used' : ''}" data-action="pick" data-pid="${p.id}" data-info="${p.id}" title="${esc(p.name)}">
          <img src="${iconUrl(p.id)}" alt="${esc(p.name)}" width="68" height="56" loading="lazy"><span class="cn">${esc(p.name)}</span></button>`;
      }).join('')
    : `<p class="nores">Nessun Pokémon con questi filtri.</p>`;
  $('#boxRemove').hidden = !state.team[slot];
  const cur = state.team[slot];
  showInfo(cur ? cur.pid : null);
}
function showInfo(pid) {
  const el = $('#boxInfo');
  if (!pid) { el.innerHTML = '<span class="muted">Passa sopra un Pokémon per vederne i dettagli.</span>'; return; }
  const p = poke(pid);
  el.innerHTML = `<img src="${iconUrl(p.id)}" alt="" width="68" height="56"><b>N. ${pad(p.sp)} ${esc(p.name)}</b><span class="types">${p.types.map(t => typeBadge(t, true)).join('')}</span><span class="bst">${p.stats.map((v, i) => `${STAT_SHORT[i]} ${v}`).join(' · ')}</span>`;
}

function openBox(slot) {
  state.box = { open: true, slot, page: 0 };
  state.selected = slot;
  $('#box').hidden = false;
  renderBox();
  renderAll(false);
  $('#boxGrid').scrollTop = 0;
}
function closeBox() {
  state.box.open = false;
  $('#box').hidden = true;
  closeFilters();
}
function openFilters() { $('#filters').classList.add('open'); $('#backdrop').classList.add('show'); }
function closeFilters() { $('#filters').classList.remove('open'); $('#backdrop').classList.remove('show'); }

/* ---------- aggiornamento ---------- */
function renderAll(withBox = true) {
  renderFilters();
  renderMatrix();
  renderTeam();
  renderDetail();
  if (withBox) renderBox();
}
function commit() { save(); renderAll(); }

function defaultAbility(p) { return (p.abilities.find(a => !a.hidden) || p.abilities[0])?.id ?? null; }

/* ---------- eventi ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  switch (a) {
    case 'view': state.view = el.dataset.view; save(); renderMatrix(); break;
    case 'select': {
      const i = +el.dataset.slot;
      if (!state.team[i]) { openBox(i); break; }
      state.selected = i; save(); renderAll(); break;
    }
    case 'open-box': e.stopPropagation(); openBox(+el.dataset.slot); break;
    case 'close-box': closeBox(); break;
    case 'remove-slot': state.team[state.box.slot] = null; save(); closeBox(); renderAll(); break;
    case 'pick': {
      const pid = +el.dataset.pid, slot = state.box.slot, p = poke(pid);
      state.team[slot] = { pid, ability: defaultAbility(p), item: null, moves: [null, null, null, null] };
      state.selected = slot;
      save(); closeBox(); renderAll();
      break;
    }
    case 'page-next': state.box.page++; renderBox(); $('#boxGrid').scrollTop = 0; break;
    case 'page-prev': state.box.page = Math.max(0, state.box.page - 1); renderBox(); $('#boxGrid').scrollTop = 0; break;
    case 'gen': state.filter.gen = el.dataset.gen ? +el.dataset.gen : null; state.box.page = 0; renderFilters(); ensureBox(); renderBox(); break;
    case 'game': {
      const d = +el.dataset.dex;
      if (state.filter.dex.has(d)) { if (state.filter.dex.size > 1) state.filter.dex.delete(d); } else state.filter.dex.add(d);
      state.box.page = 0; renderFilters(); ensureBox(); renderBox(); break;
    }
    case 'ability': { const s = state.team[state.selected]; s.ability = +el.dataset.id; commit(); break; }
    case 'open-filters': openFilters(); break;
    case 'close-filters': closeFilters(); break;
    case 'clear-team':
      if (state.team.some(Boolean) && confirm('Svuotare tutta la squadra?')) { state.team = Array(6).fill(null); state.selected = 0; commit(); }
      break;
  }
});
function ensureBox() { if (!state.box.open && window.matchMedia('(min-width: 761px)').matches) openBox(state.selected); }

document.addEventListener('change', e => {
  const s = state.team[state.selected];
  if (!s) return;
  if (e.target.id === 'itemSel') { s.item = e.target.value ? +e.target.value : null; commit(); }
  else if (e.target.dataset.move != null) { s.moves[+e.target.dataset.move] = e.target.value ? +e.target.value : null; commit(); }
});

$('#search').addEventListener('input', e => {
  state.filter.q = e.target.value;
  state.box.page = 0;
  ensureBox();
  renderBox();
});
$('#search').addEventListener('focus', () => ensureBox());

document.addEventListener('mouseover', e => {
  const c = e.target.closest('[data-info]');
  if (c && state.box.open) showInfo(+c.dataset.info);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if ($('#filters').classList.contains('open')) closeFilters(); else if (state.box.open) closeBox(); return; }
  if (e.target.closest('input,select,textarea')) return;
  if (e.key === 'Enter' && e.target.matches('.slot[data-action="select"]')) e.target.click();
  if (e.key.toLowerCase() === 'a') { state.view = 'def'; save(); renderMatrix(); }
  if (e.key.toLowerCase() === 'b') { state.view = 'off'; save(); renderMatrix(); }
});

/* ---------- avvio ---------- */
async function init() {
  try {
    const [c, m] = await Promise.all([
      fetch('data/core.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch('data/moves.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    ]);
    core = c; moves = m;
    calc = new Calc(core, moves);
    restore();
    renderAll();
    $('#loading').remove();
  } catch (err) {
    $('#loading').textContent = 'Impossibile caricare i dati del Pokédex. Se stai aprendo il file in locale, usa un piccolo server (es. python3 -m http.server).';
    console.error(err);
  }
}
init();
