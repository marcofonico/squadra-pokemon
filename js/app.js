import { Calc, fmtMult } from './calc.js?v=5';

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
const CLASS_NAME = { 1: 'Stato', 2: 'Fisico', 3: 'Speciale' };
const TEAM_COLORS = ['#3f8f1c', '#2f6fe4', '#f08030'];
const MAX_COMPARE = 3;
const PAGE_SIZE = 30;
const STORE_KEY = 'ptb.v2';
const OLD_KEY = 'ptb.team.gen8.v1';
const $ = s => document.querySelector(s);

/* ---------- stato ---------- */
const state = {
  teams: [],            // [{id, name, slots:[6], updated}]
  currentId: null,
  compare: [],          // id delle squadre confrontate (max 3)
  mode: 'build',        // 'build' | 'compare'
  selected: 0,
  view: 'def',
  box: { open: false, slot: 0, page: 0 },
  filter: { q: '', gen: null, dex: new Set(GAMES.map(g => g.dex)) },
  picker: null,         // {kind:'move'|'item', k, q}
};
let calc, core, moves;

const cur = () => state.teams.find(t => t.id === state.currentId);
const team = () => cur().slots;

/* ---------- utilità ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const iconUrl = id => `assets/icons/${id}.png`;
const pad = n => String(n).padStart(3, '0');
const uid = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

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

/* ---------- squadre: creazione e persistenza ---------- */
function newTeamObj(name) {
  return { id: uid(), name: name || `Squadra ${state.teams.length + 1}`, slots: Array(6).fill(null), updated: Date.now() };
}
function cleanSlot(s) {
  if (!s || !calc.pokeById.has(s.pid)) return null;
  const st = Array.isArray(s.stats) && s.stats.length === 6 ? s.stats.map(n => Math.min(255, Math.max(1, n | 0))) : null;
  const m = [...(s.moves || []), null, null, null, null].slice(0, 4).map(id => (id && moves[id] ? id : null));
  return { pid: s.pid, ability: s.ability ?? null, item: s.item != null && calc.itemById.has(s.item) ? s.item : null, moves: m, stats: st };
}
function cleanTeam(t) {
  const slots = [...(t.slots || [])].slice(0, 6).map(cleanSlot);
  while (slots.length < 6) slots.push(null);
  return { id: t.id || uid(), name: String(t.name || 'Squadra').slice(0, 32), slots, updated: t.updated || Date.now() };
}
function save() {
  const t = cur();
  if (t) t.updated = Date.now();
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ v: 2, teams: state.teams, currentId: state.currentId, compare: state.compare, selected: state.selected, view: state.view }));
  } catch { /* storage non disponibile */ }
}
function restore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && Array.isArray(raw.teams) && raw.teams.length) {
      state.teams = raw.teams.map(cleanTeam);
      state.currentId = state.teams.some(t => t.id === raw.currentId) ? raw.currentId : state.teams[0].id;
      state.compare = (raw.compare || []).filter(id => state.teams.some(t => t.id === id)).slice(0, MAX_COMPARE);
      state.selected = Math.min(5, Math.max(0, raw.selected | 0));
      state.view = raw.view === 'off' ? 'off' : 'def';
      return;
    }
    // migrazione dalla prima versione (una sola squadra)
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null');
    if (old && Array.isArray(old.team)) {
      const t = cleanTeam({ name: 'Squadra 1', slots: old.team });
      state.teams = [t]; state.currentId = t.id;
      state.selected = Math.min(5, Math.max(0, old.selected | 0));
      state.view = old.view === 'off' ? 'off' : 'def';
      return;
    }
  } catch { /* dati corrotti: si riparte da zero */ }
  const t = newTeamObj('Squadra 1');
  state.teams = [t]; state.currentId = t.id;
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

/* ---------- sintesi squadra (usata da costruttore e confronto) ---------- */
function summarize(slots) {
  const filled = slots.filter(Boolean);
  if (!filled.length) return null;
  const rows = calc.table(slots);
  const weak = rows.filter(r => r.weak >= 2 && r.weak > r.resist).sort((a, b) => (b.weak - b.resist) - (a.weak - a.resist));
  const missing = rows.filter(r => r.hit === 0);
  const avg = calc.statAverages(slots);
  const order = [0, 1, 2, 3, 4, 5].sort((a, b) => avg[b] - avg[a]);
  return {
    filled, rows, weak, missing, avg,
    top: order[0], worst: order[5],
    bst: avg.reduce((a, b) => a + b, 0),
    est: filled.some(s => calc.damagingMoves(s).length === 0),
  };
}

/* ---------- render: navigazione e nome ---------- */
function renderNav() {
  document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
  $('#teamSel').innerHTML = state.teams.map(t => `<option value="${t.id}"${t.id === state.currentId ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
  const inp = $('#teamName');
  if (document.activeElement !== inp) inp.value = cur().name;
  $('#buildView').hidden = state.mode !== 'build';
  $('#compareView').hidden = state.mode !== 'compare';
  $('#app').classList.toggle('compare', state.mode === 'compare');
  $('#teamSw').hidden = state.mode !== 'build';
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
  const T = team();
  const rows = calc.table(T);
  const def = state.view === 'def';
  let html = `<div class="mx-corner"></div>`;
  html += T.map((s, i) => s
    ? `<button class="mx-head${i === state.selected ? ' sel' : ''}" data-action="select" data-slot="${i}" title="${esc(poke(s.pid).name)}"><img src="${iconUrl(s.pid)}" alt="${esc(poke(s.pid).name)}" width="68" height="56"></button>`
    : `<button class="mx-head none" data-action="select" data-slot="${i}" aria-label="Slot ${i + 1} vuoto"><span>+</span></button>`).join('');
  html += `<div class="mx-head team-col" title="${def ? 'Squadra: deboli / resistenti' : 'Squadra: Pokémon che colpiscono superefficace'}">Sq.</div>`;
  const any = T.some(Boolean);
  for (const r of rows) {
    html += `<div class="mx-type">${typeBadge(r.type.id, true)}</div>`;
    r.def.forEach((v, i) => {
      const val = def ? v : r.off[i];
      const cls = cellClass(state.view, val);
      const text = val == null ? '' : fmtMult(def ? val : val.m);
      let tip = '';
      if (val != null) {
        const who = poke(T[i].pid).name;
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
      html += `<div class="mx-cell team-col ${r.hit === 0 && any ? 'alert' : ''}">${any ? `<b class="${r.hit ? 'good' : 'wk'}">${r.hit}</b>` : ''}</div>`;
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
  $('#team').innerHTML = team().map((s, i) => {
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

/* ---------- radar (una o più serie) ---------- */
function radarSVG(series, showValues) {
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
    return `<text x="${lx}" y="${ly - (showValues ? 3 : -4)}" class="lab">${STAT_SHORT[si]}</text>` +
      (showValues ? `<text x="${lx}" y="${ly + 10}" class="val">${Math.round(series[0].vals[si])}</text>` : '');
  }).join('');
  const shapes = series.map(s => `<polygon points="${poly(s.vals)}" fill="${s.fill ? s.color + '55' : 'none'}" stroke="${s.color}" stroke-width="${s.dash ? 2 : 2.5}" stroke-linejoin="round"${s.dash ? ' stroke-dasharray="5 4" opacity=".6"' : ''}/>`).join('');
  return `<svg viewBox="0 0 ${size} ${size}" class="radar" role="img" aria-label="Statistiche">${rings}${axes}${shapes}${labels}</svg>`;
}

/* ---------- render: dettaglio ---------- */
function renderDetail() {
  const s = team()[state.selected];
  const multi = team().filter(Boolean).length > 1;
  let html = '';
  if (!s) {
    html += `<div class="d-head empty"><span class="no">Slot ${state.selected + 1}</span><h2>Nessun Pokémon</h2></div>
      <div class="d-body"><p class="hint">Scegli un Pokémon dal box per vederne statistiche, abilità e mosse.</p>
      <button class="pill" data-action="open-box" data-slot="${state.selected}">Apri il box</button></div>`;
  } else {
    const p = poke(s.pid);
    const ab = s.ability != null ? core.abilities[s.ability] : null;
    const item = s.item != null ? calc.itemById.get(s.item) : null;
    const eff = calc.stats(s);
    const bst = eff.reduce((a, b) => a + b, 0);
    const edited = !!s.stats && eff.some((v, i) => v !== p.stats[i]);
    const avg = multi ? calc.statAverages(team()) : null;
    const series = [{ vals: eff, color: '#3f8f1c', fill: true }];
    if (avg) series.push({ vals: avg, color: '#2b3036', dash: true });
    html += `<div class="d-head">
        <span class="no">N. ${pad(p.sp)}</span>
        <h2>${esc(p.name)}</h2>
        <span class="types">${p.types.map(t => typeBadge(t)).join('')}</span>
      </div>
      <div class="d-body">
        <div class="radar-wrap">${radarSVG(series, true)}
          <p class="radar-note">Totale <b>${bst}</b>${edited ? ' <em class="edited">(modificato)</em>' : ''}${multi ? ' · tratteggio: media squadra' : ''}</p></div>

        <h3 class="sec">Statistiche</h3>
        <div class="stat-edit">
          ${[0, 1, 2, 3, 4, 5].map(i => `<label class="se${eff[i] !== p.stats[i] ? ' mod' : ''}"><span>${STAT_SHORT[i]}</span><input type="number" inputmode="numeric" min="1" max="255" value="${eff[i]}" data-stat="${i}" aria-label="${STAT_FULL[i]}"></label>`).join('')}
        </div>
        <p class="effect">Base: ${p.stats.join(' / ')}. <button class="link" data-action="reset-stats"${edited ? '' : ' disabled'}>Ripristina</button></p>

        <h3 class="sec">Abilità</h3>
        <div class="abil">
          ${p.abilities.map(a => {
            const d = core.abilities[a.id];
            return `<button class="chip${s.ability === a.id ? ' on' : ''}" data-action="ability" data-id="${a.id}">${esc(d.name)}${a.hidden ? ' <small>nascosta</small>' : ''}${d.def || d.off ? ' <i class="fx" title="Modifica tipi">◆</i>' : ''}</button>`;
          }).join('')}
        </div>
        <p class="effect">${ab ? esc(ab.effect) : ''}${ab && ab.effectLang === 'en' ? ' <em>(testo in inglese)</em>' : ''}</p>

        <h3 class="sec">Oggetto</h3>
        <button class="field" data-action="pick-item"><span class="fv${item ? '' : ' ph'}">${item ? esc(item.name) : '— nessuno —'}</span><i class="caret"></i></button>
        <p class="effect">${item ? esc(item.effect) : ''}${item && item.effectLang !== 'it' ? ' <em>(testo in inglese)</em>' : ''}</p>

        <h3 class="sec">Mosse</h3>
        <div class="moves">
          ${[0, 1, 2, 3].map(k => {
            const m = s.moves[k] ? moves[s.moves[k]] : null;
            return `<button class="field move" data-action="pick-move" data-k="${k}">
              <span class="mt">${m ? typeBadge(m[1], true) : '<span class="tb ph"><b>—</b></span>'}</span>
              <span class="fv${m ? '' : ' ph'}">${m ? esc(m[0]) : `— mossa ${k + 1} —`}</span><i class="caret"></i></button>`;
          }).join('')}
        </div>
      </div>`;
  }
  html += summaryHTML();
  $('#detail').innerHTML = html;
}

function summaryHTML() {
  const sm = summarize(team());
  let body;
  if (!sm) body = `<p class="hint">Aggiungi dei Pokémon per vedere la sintesi.</p>`;
  else body = summaryList(sm, sm.filled.length);
  return `<div class="d-sum"><h3 class="sec big">Sintesi squadra</h3>${body}</div>`;
}
function summaryList(sm, n) {
  return `<dl class="sum">
    <dt>Debolezze</dt>
    <dd>${sm.weak.length ? sm.weak.map(r => `<span class="tc">${typeBadge(r.type.id, true)}<em>${r.weak}/${n}</em></span>`).join('') : '<span class="ok">Nessuna debolezza condivisa</span>'}</dd>
    <dt>Coperture off. mancanti</dt>
    <dd>${sm.missing.length ? sm.missing.map(r => typeBadge(r.type.id, true)).join('') : '<span class="ok">Tutti i tipi sono coperti</span>'}${sm.est ? '<small class="note">Stima STAB per i Pokémon senza mosse.</small>' : ''}</dd>
    <dt>Top caratteristica</dt>
    <dd><b class="stat good">${STAT_FULL[sm.top]}</b> <span class="num">media ${Math.round(sm.avg[sm.top])}</span></dd>
    <dt>Worst caratteristica</dt>
    <dd><b class="stat bad">${STAT_FULL[sm.worst]}</b> <span class="num">media ${Math.round(sm.avg[sm.worst])}</span></dd>
  </dl>`;
}

/* ---------- render: confronto squadre ---------- */
function sprites(slots) {
  return `<span class="spr">${slots.map(s => (s ? `<img src="${iconUrl(s.pid)}" alt="${esc(poke(s.pid).name)}" title="${esc(poke(s.pid).name)}" width="68" height="56">` : '<i class="ph"></i>')).join('')}</span>`;
}
function renderCompare() {
  const ids = state.compare.filter(id => state.teams.some(t => t.id === id)).slice(0, MAX_COMPARE);
  state.compare = ids;
  const full = ids.length >= MAX_COMPARE;

  const list = state.teams.map(t => {
    const on = ids.includes(t.id), disabled = full && !on;
    const cnt = t.slots.filter(Boolean).length;
    return `<li class="tcard${on ? ' on' : ''}${t.id === state.currentId ? ' current' : ''}">
      <button class="cmp-check" data-action="cmp-toggle" data-id="${t.id}" aria-pressed="${on}" ${disabled ? 'disabled title="Massimo 3 squadre"' : ''} aria-label="Confronta ${esc(t.name)}"><span class="check"></span></button>
      <div class="tinfo"><b>${esc(t.name)}</b><small>${cnt}/6 Pokémon</small>${sprites(t.slots)}</div>
      <div class="tbtns">
        <button class="pill sm" data-action="open-team" data-id="${t.id}">Apri</button>
        <button class="pill ghost sm" data-action="dup-team" data-id="${t.id}">Duplica</button>
        <button class="round sm" data-action="del-team" data-id="${t.id}" aria-label="Elimina ${esc(t.name)}">✕</button>
      </div>
    </li>`;
  }).join('');

  let html = `<section class="card cmp-manager">
      <div class="cmp-title-row"><h2>Le tue squadre</h2><button class="pill sm" data-action="new-team">+ Nuova squadra</button></div>
      <p class="hint">Spunta da 2 a 3 squadre per confrontarle (${ids.length}/${MAX_COMPARE}). Le modifiche sono salvate automaticamente in questo browser.</p>
      <ul class="tlist">${list}</ul>
    </section>`;

  if (ids.length < 2) {
    html += `<section class="card cmp-empty"><p class="hint">Seleziona almeno due squadre per vedere il confronto.</p></section>`;
  } else {
    const teams = ids.map(id => state.teams.find(t => t.id === id));
    const sums = teams.map(t => summarize(t.slots));
    const n = teams.length;
    const row = (title, fn) => `<h3 class="cmp-h">${title}</h3><div class="cmp-row">${teams.map((t, i) => `<div class="cmp-cell">${sums[i] ? fn(sums[i], i) : '<span class="muted">Squadra vuota</span>'}</div>`).join('')}</div>`;

    html += `<section class="card cmp" style="--n:${n}"><div class="cmp-scroll"><div class="cmp-inner">
      <div class="cmp-row heads">${teams.map((t, i) => `<div class="cmp-head" style="--tc:${TEAM_COLORS[i]}"><b>${esc(t.name)}</b>${sprites(t.slots)}</div>`).join('')}</div>
      ${row('Debolezze', (sm) => sm.weak.length ? `<div class="chips">${sm.weak.map(r => `<span class="tc">${typeBadge(r.type.id, true)}<em>${r.weak}/${sm.filled.length}</em></span>`).join('')}</div>` : '<span class="ok">Nessuna condivisa</span>')}
      ${row('Coperture off. mancanti', (sm) => sm.missing.length ? `<div class="chips">${sm.missing.map(r => typeBadge(r.type.id, true)).join('')}</div>` : '<span class="ok">Tutti i tipi coperti</span>')}
      ${row('Top caratteristica', (sm) => `<b class="stat good">${STAT_FULL[sm.top]}</b> <span class="num">${Math.round(sm.avg[sm.top])}</span>`)}
      ${row('Worst caratteristica', (sm) => `<b class="stat bad">${STAT_FULL[sm.worst]}</b> <span class="num">${Math.round(sm.avg[sm.worst])}</span>`)}
      ${row('Statistiche medie', (sm) => `<div class="bars">${sm.avg.map((v, i) => `<div><span>${STAT_SHORT[i]}</span><i style="--w:${Math.min(100, v / 1.6)}%"></i><em>${Math.round(v)}</em></div>`).join('')}</div><p class="bsttot">Totale medio <b>${Math.round(sm.bst)}</b></p>`)}
    </div></div></section>`;

    const radarSeries = teams.map((t, i) => (sums[i] ? { vals: sums[i].avg, color: TEAM_COLORS[i], fill: i === 0 } : null)).filter(Boolean);
    html += `<section class="card cmp-radar"><h3 class="cmp-h">Profilo statistico medio</h3>
      <div class="radar-wrap">${radarSVG(radarSeries, false)}</div>
      <ul class="leg">${teams.map((t, i) => `<li><i style="background:${TEAM_COLORS[i]}"></i>${esc(t.name)}</li>`).join('')}</ul></section>`;

    // tabella debolezze per tipo
    const rowsBy = sums.map(sm => sm?.rows);
    html += `<section class="card cmp-types"><h3 class="cmp-h">Debolezze per tipo <small>deboli / resistenti per squadra</small></h3>
      <div class="ct" style="--n:${n}">
        <div class="ct-h"></div>${teams.map((t, i) => `<div class="ct-h" style="--tc:${TEAM_COLORS[i]}"><i></i>${esc(t.name)}</div>`).join('')}
        ${calc.types.map((ty, ti) => `<div class="ct-t">${typeBadge(ty.id, true)}</div>` + rowsBy.map(rows => {
          if (!rows) return '<div class="ct-c"></div>';
          const r = rows[ti];
          const alert = r.weak >= 3 && r.weak > r.resist;
          return `<div class="ct-c${alert ? ' alert' : ''}"><b class="wk">${r.weak || '·'}</b><i class="rs">${r.resist || '·'}</i></div>`;
        }).join('')).join('')}
      </div></section>`;
  }
  $('#compareView').innerHTML = html;
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
        const used = team().some((s, i) => s && s.pid === p.id && i !== slot);
        return `<button class="cell${used ? ' used' : ''}" data-action="pick" data-pid="${p.id}" data-info="${p.id}" title="${esc(p.name)}">
          <img src="${iconUrl(p.id)}" alt="${esc(p.name)}" width="68" height="56" loading="lazy"><span class="cn">${esc(p.name)}</span></button>`;
      }).join('')
    : `<p class="nores">Nessun Pokémon con questi filtri.</p>`;
  $('#boxRemove').hidden = !team()[slot];
  const c = team()[slot];
  showInfo(c ? c.pid : null);
}
function showInfo(pid) {
  const el = $('#boxInfo');
  if (!pid) { el.innerHTML = '<span class="muted">Passa sopra un Pokémon per vederne i dettagli.</span>'; return; }
  const p = poke(pid);
  el.innerHTML = `<img src="${iconUrl(p.id)}" alt="" width="68" height="56"><b>N. ${pad(p.sp)} ${esc(p.name)}</b><span class="types">${p.types.map(t => typeBadge(t, true)).join('')}</span><span class="bst">${p.stats.map((v, i) => `${STAT_SHORT[i]} ${v}`).join(' · ')}</span>`;
}
function syncSearch(value, source) {
  state.filter.q = value;
  if (source !== 'side') $('#search').value = value;
  if (source !== 'box') $('#boxSearch').value = value;
}
function openBox(slot) {
  state.box = { open: true, slot, page: 0 };
  state.selected = slot;
  $('#box').hidden = false;
  $('#boxSearch').value = state.filter.q;
  renderBox();
  renderAll(false);
  $('#boxGrid').scrollTop = 0;
  if (window.matchMedia('(min-width: 761px)').matches) $('#boxSearch').focus({ preventScroll: true });
}
function closeBox() {
  state.box.open = false;
  $('#box').hidden = true;
  closeFilters();
}
function openFilters() { $('#filters').classList.add('open'); $('#backdrop').classList.add('show'); }
function closeFilters() { $('#filters').classList.remove('open'); $('#backdrop').classList.remove('show'); }

/* ---------- selettore con ricerca (mosse / oggetti) ---------- */
function pickerOptions() {
  const s = team()[state.selected];
  const p = poke(s.pid);
  if (state.picker.kind === 'move') {
    return p.moves.map(id => ({ id, m: moves[id] })).sort((a, b) => a.m[0].localeCompare(b.m[0], 'it')).map(({ id, m }) => ({
      id, label: m[0], hay: norm(m[0] + ' ' + calc.typeById.get(m[1]).name + ' ' + CLASS_NAME[m[3]]),
      badge: typeBadge(m[1], true),
      sub: `${CLASS_NAME[m[3]]}${m[2] ? ' · Pot. ' + m[2] : ''}${m[4] ? ' · Prec. ' + m[4] : ''}`,
      current: s.moves.includes(id),
    }));
  }
  const items = [...core.items].sort((a, b) => (!!(b.def || b.berry) - !!(a.def || a.berry)) || a.name.localeCompare(b.name, 'it'));
  return items.map(i => ({
    id: i.id, label: i.name, hay: norm(i.name), sub: i.effect, fx: !!(i.def || i.berry), current: s.item === i.id,
  }));
}
function renderPicker() {
  const pk = state.picker;
  const q = norm(pk.q.trim());
  const opts = pickerOptions().filter(o => !q || o.hay.includes(q));
  const none = `<button class="popt none" data-action="pick-opt" data-id=""><span class="pl">— ${pk.kind === 'move' ? 'Nessuna mossa' : 'Nessun oggetto'} —</span></button>`;
  $('#pickerList').innerHTML = none + (opts.length
    ? opts.map(o => `<button class="popt${o.current ? ' cur' : ''}" data-action="pick-opt" data-id="${o.id}">
        ${o.badge ? `<span class="pb">${o.badge}</span>` : ''}
        <span class="pt"><span class="pl">${esc(o.label)}${o.fx ? ' <i class="fx" title="Influenza le resistenze">◆</i>' : ''}</span><small>${esc(o.sub)}</small></span>
      </button>`).join('')
    : `<p class="nores">Nessun risultato per “${esc(pk.q)}”.</p>`);
}
function openPicker(kind, k) {
  state.picker = { kind, k, q: '' };
  $('#pickerTitle').textContent = kind === 'move' ? `Mossa ${k + 1}` : 'Oggetto';
  $('#pickerSearch').value = '';
  $('#pickerSearch').placeholder = kind === 'move' ? 'Cerca mossa o tipo…' : 'Cerca oggetto…';
  $('#picker').hidden = false;
  renderPicker();
  $('#pickerList').scrollTop = 0;
  $('#pickerSearch').focus({ preventScroll: true });
}
function closePicker() { state.picker = null; $('#picker').hidden = true; }

/* ---------- aggiornamento ---------- */
function renderAll(withBox = true) {
  renderNav();
  if (state.mode === 'build') {
    renderFilters();
    renderMatrix();
    renderTeam();
    renderDetail();
    if (withBox) renderBox();
  } else {
    renderCompare();
  }
}
function commit() { save(); renderAll(); }

function defaultAbility(p) { return (p.abilities.find(a => !a.hidden) || p.abilities[0])?.id ?? null; }

function setMode(mode) {
  if (state.box.open) closeBox();
  closePicker();
  state.mode = mode;
  if (mode === 'compare' && !state.compare.length) {
    // preselezione: squadre più recenti con almeno un Pokémon
    state.compare = [...state.teams].filter(t => t.slots.some(Boolean)).sort((a, b) => b.updated - a.updated).slice(0, MAX_COMPARE).map(t => t.id);
  }
  save(); renderAll();
  window.scrollTo?.({ top: 0 }); $('#main').scrollTop = 0;
}
function switchTeam(id) {
  if (state.box.open) closeBox();
  closePicker();
  state.currentId = id; state.selected = 0;
  commit();
}
function addTeam(slots, name) {
  const t = newTeamObj(name);
  if (slots) t.slots = slots.map(s => (s ? { ...s, moves: [...s.moves], stats: s.stats ? [...s.stats] : null } : null));
  state.teams.push(t);
  return t;
}

/* ---------- eventi ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  switch (a) {
    case 'mode': setMode(el.dataset.mode); break;
    case 'new-team': {
      const t = addTeam();
      state.currentId = t.id; state.mode = 'build'; state.selected = 0;
      commit(); $('#teamName').focus(); $('#teamName').select();
      break;
    }
    case 'open-team': state.mode = 'build'; switchTeam(el.dataset.id); window.scrollTo?.({ top: 0 }); break;
    case 'dup-team': {
      const src = state.teams.find(t => t.id === el.dataset.id);
      const t = addTeam(src.slots, `${src.name} (copia)`.slice(0, 32));
      state.compare = state.compare.filter(id => id !== t.id);
      commit(); break;
    }
    case 'del-team': {
      const src = state.teams.find(t => t.id === el.dataset.id);
      if (!confirm(`Eliminare “${src.name}”?`)) break;
      state.teams = state.teams.filter(t => t.id !== src.id);
      if (!state.teams.length) state.teams.push(newTeamObj('Squadra 1'));
      state.compare = state.compare.filter(id => id !== src.id);
      if (state.currentId === src.id) { state.currentId = state.teams[0].id; state.selected = 0; }
      commit(); break;
    }
    case 'cmp-toggle': {
      const id = el.dataset.id;
      if (state.compare.includes(id)) state.compare = state.compare.filter(x => x !== id);
      else if (state.compare.length < MAX_COMPARE) state.compare.push(id);
      save(); renderCompare(); break;
    }
    case 'view': state.view = el.dataset.view; save(); renderMatrix(); break;
    case 'select': {
      const i = +el.dataset.slot;
      if (!team()[i]) { openBox(i); break; }
      state.selected = i; save(); renderAll(); break;
    }
    case 'open-box': e.stopPropagation(); openBox(+el.dataset.slot); break;
    case 'close-box': closeBox(); break;
    case 'remove-slot': team()[state.box.slot] = null; save(); closeBox(); renderAll(); break;
    case 'pick': {
      const pid = +el.dataset.pid, slot = state.box.slot, p = poke(pid);
      team()[slot] = { pid, ability: defaultAbility(p), item: null, moves: [null, null, null, null], stats: null };
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
    case 'ability': { team()[state.selected].ability = +el.dataset.id; commit(); break; }
    case 'reset-stats': { team()[state.selected].stats = null; commit(); break; }
    case 'pick-move': openPicker('move', +el.dataset.k); break;
    case 'pick-item': openPicker('item', 0); break;
    case 'close-picker': closePicker(); break;
    case 'pick-opt': {
      const s = team()[state.selected], pk = state.picker;
      const id = el.dataset.id ? +el.dataset.id : null;
      if (pk.kind === 'move') s.moves[pk.k] = id; else s.item = id;
      closePicker(); commit(); break;
    }
    case 'open-filters': openFilters(); break;
    case 'close-filters': closeFilters(); break;
    case 'clear-team':
      if (state.mode === 'build' && team().some(Boolean) && confirm('Svuotare tutta la squadra?')) { cur().slots = Array(6).fill(null); state.selected = 0; commit(); }
      break;
  }
});
function ensureBox() { if (state.mode === 'build' && !state.box.open && window.matchMedia('(min-width: 761px)').matches) openBox(state.selected); }

document.addEventListener('change', e => {
  if (e.target.id === 'teamSel') { switchTeam(e.target.value); return; }
  if (e.target.dataset.stat != null) {
    const s = team()[state.selected];
    if (!s) return;
    const i = +e.target.dataset.stat;
    let v = parseInt(e.target.value, 10);
    const base = poke(s.pid).stats;
    if (!Number.isFinite(v)) v = calc.stats(s)[i];
    v = Math.min(255, Math.max(1, v));
    const st = [...calc.stats(s)];
    st[i] = v;
    s.stats = st.every((x, k) => x === base[k]) ? null : st;
    commit();
  }
});

$('#teamName').addEventListener('input', e => {
  cur().name = e.target.value.slice(0, 32);
  const opt = $('#teamSel').querySelector(`option[value="${cur().id}"]`);
  if (opt) opt.textContent = cur().name || 'Senza nome';
  save();
});
$('#teamName').addEventListener('blur', e => {
  if (!e.target.value.trim()) { cur().name = `Squadra ${state.teams.indexOf(cur()) + 1}`; e.target.value = cur().name; save(); renderNav(); }
});
$('#teamName').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });

$('#search').addEventListener('input', e => { syncSearch(e.target.value, 'side'); state.box.page = 0; ensureBox(); renderBox(); });
$('#search').addEventListener('focus', () => ensureBox());
$('#boxSearch').addEventListener('input', e => { syncSearch(e.target.value, 'box'); state.box.page = 0; renderBox(); });
$('#pickerSearch').addEventListener('input', e => { state.picker.q = e.target.value; renderPicker(); $('#pickerList').scrollTop = 0; });

document.addEventListener('mouseover', e => {
  const c = e.target.closest('[data-info]');
  if (c && state.box.open) showInfo(+c.dataset.info);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (state.picker) closePicker();
    else if ($('#filters').classList.contains('open')) closeFilters();
    else if (state.box.open) closeBox();
    return;
  }
  if (e.target.closest('input,select,textarea')) return;
  if (e.key === 'Enter' && e.target.matches('.slot[data-action="select"]')) e.target.click();
  if (state.mode !== 'build' || state.picker) return;
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
