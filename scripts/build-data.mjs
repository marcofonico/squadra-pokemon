#!/usr/bin/env node
/**
 * Genera i dati statici del sito partendo dai CSV ufficiali di PokéAPI
 * (https://github.com/PokeAPI/pokeapi → data/v2/csv).
 *
 * Uso:  node scripts/build-data.mjs <cartella-csv> [cartella-output]
 *
 * Output (cartella-output, default ./data):
 *   core.json   tipi, tabella efficacia, Pokémon, abilità, oggetti
 *   moves.json  mosse apprendibili in Spada/Scudo (+ DLC)
 *
 * Ambito: Pokédex di Galar (base + Isola Solitaria dell'Armatura + Terre Innevate
 * della Corona), ottava generazione.
 */
import fs from 'node:fs';
import path from 'node:path';

const csvDir = process.argv[2];
const outDir = process.argv[3] || path.join(import.meta.dirname, '..', 'data');
if (!csvDir) {
  console.error('Uso: node scripts/build-data.mjs <cartella-csv> [cartella-output]');
  process.exit(1);
}

// ---------- configurazione ----------
const GEN = 8;
const LANG_IT = 8, LANG_EN = 9;
const GALAR_DEXES = [27, 28, 29]; // galar, isle-of-armor, crown-tundra
const GALAR_VERSION_GROUPS = [20, 21, 22]; // sword-shield, isle-of-armor, crown-tundra
const MAIN_TYPES = 18; // esclude shadow (10002) e ???(10001)

// Effetti delle abilità sulla tavola dei tipi (PokéAPI non li espone in forma strutturata).
// def: moltiplicatore sul danno subito per tipo ('*se' = scala i colpi superefficaci, '*wonder' = solo superefficaci).
// off: modificatori offensivi.
const ABILITY_FX = {
  'levitate':        { def: { ground: 0 },                 it: 'Immune alle mosse di tipo Terra.' },
  'flash-fire':      { def: { fire: 0 },                   it: 'Immune al tipo Fuoco (e ne potenzia le mosse).' },
  'water-absorb':    { def: { water: 0 },                  it: 'Immune al tipo Acqua (recupera PS).' },
  'storm-drain':     { def: { water: 0 },                  it: 'Immune al tipo Acqua (aumenta Att. Sp.).' },
  'dry-skin':        { def: { water: 0, fire: 1.25 },      it: 'Immune al tipo Acqua, ma subisce il 25% in più dal Fuoco.' },
  'volt-absorb':     { def: { electric: 0 },               it: 'Immune al tipo Elettro (recupera PS).' },
  'lightning-rod':   { def: { electric: 0 },               it: 'Immune al tipo Elettro (aumenta Att. Sp.).' },
  'motor-drive':     { def: { electric: 0 },               it: 'Immune al tipo Elettro (aumenta Velocità).' },
  'sap-sipper':      { def: { grass: 0 },                  it: 'Immune al tipo Erba (aumenta Attacco).' },
  'earth-eater':     { def: { ground: 0 },                 it: 'Immune al tipo Terra (recupera PS).' },
  'well-baked-body': { def: { fire: 0 },                   it: 'Immune al tipo Fuoco (aumenta Difesa).' },
  'thick-fat':       { def: { fire: 0.5, ice: 0.5 },       it: 'Dimezza i danni da Fuoco e Ghiaccio.' },
  'heatproof':       { def: { fire: 0.5 },                 it: 'Dimezza i danni da Fuoco.' },
  'water-bubble':    { def: { fire: 0.5 }, off: { boost: 'water' }, it: 'Dimezza i danni da Fuoco e raddoppia la potenza delle mosse Acqua.' },
  'fluffy':          { def: { fire: 2 },                   it: 'Dimezza i danni da contatto, ma raddoppia quelli da Fuoco.' },
  'filter':          { def: { '*se': 0.75 },               it: 'Riduce del 25% i danni delle mosse superefficaci.' },
  'solid-rock':      { def: { '*se': 0.75 },               it: 'Riduce del 25% i danni delle mosse superefficaci.' },
  'prism-armor':     { def: { '*se': 0.75 },               it: 'Riduce del 25% i danni delle mosse superefficaci.' },
  'wonder-guard':    { def: { '*wonder': true },           it: 'Subisce danni solo da mosse superefficaci.' },
  'purifying-salt':  { def: { ghost: 0.5 },                it: 'Dimezza i danni da Spettro.' },
  'scrappy':         { off: { scrappy: true },             it: 'Le mosse Normale e Lotta colpiscono i Pokémon Spettro.' },
  'tinted-lens':     { off: { tinted: true },              it: 'Le mosse poco efficaci infliggono danno doppio.' },
  'pixilate':        { off: { normalTo: 'fairy' },         it: 'Le mosse Normale diventano Folletto.' },
  'aerilate':        { off: { normalTo: 'flying' },        it: 'Le mosse Normale diventano Volante.' },
  'refrigerate':     { off: { normalTo: 'ice' },           it: 'Le mosse Normale diventano Ghiaccio.' },
  'galvanize':       { off: { normalTo: 'electric' },      it: 'Le mosse Normale diventano Elettro.' },
};

// Bacche che dimezzano un colpo superefficace del tipo indicato (una volta sola)
const BERRY_TYPE = {
  'occa-berry': 'fire', 'passho-berry': 'water', 'wacan-berry': 'electric', 'rindo-berry': 'grass',
  'yache-berry': 'ice', 'chople-berry': 'fighting', 'kebia-berry': 'poison', 'shuca-berry': 'ground',
  'coba-berry': 'flying', 'payapa-berry': 'psychic', 'tanga-berry': 'bug', 'charti-berry': 'rock',
  'kasib-berry': 'ghost', 'haban-berry': 'dragon', 'colbur-berry': 'dark', 'babiri-berry': 'steel',
  'roseli-berry': 'fairy', 'chilan-berry': 'normal',
};

const FORM_IT = {
  female: 'Femmina', 'low-key': 'Tono Basso', amped: 'Tono Alto', 'blue-striped': 'Striature Blu',
  midnight: 'Mezzanotte', dusk: 'Crepuscolo', crowned: 'Re', 'rapid-strike': 'Stile Fluido', 'single-strike': 'Stile Singolo',
  dada: 'Dada', ice: 'Cavaliere Glaciale', shadow: 'Cavaliere Spettrale', heat: 'Calore', wash: 'Lavaggio',
  frost: 'Gelo', fan: 'Ventola', mow: 'Taglio', small: 'Piccola', large: 'Grande', super: 'Maxi',
};
const FORM_SUFFIX = {
  galar: 'di Galar', alola: 'di Alola', hisui: 'di Hisui', paldea: 'di Paldea',
};

// ---------- CSV ----------
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const load = f => parseCSV(fs.readFileSync(path.join(csvDir, f + '.csv'), 'utf8'));
const num = v => (v === '' || v == null ? null : Number(v));

// ---------- tipi ----------
const typesRaw = load('types').filter(t => Number(t.id) <= MAIN_TYPES);
const typeNames = load('type_names').filter(r => +r.local_language_id === LANG_IT);
const TYPE_COLORS = {
  normal: '#a8a878', fire: '#f08030', water: '#6890f0', electric: '#f8d030', grass: '#78c850', ice: '#98d8d8',
  fighting: '#c03028', poison: '#a040a0', ground: '#e0c068', flying: '#a890f0', psychic: '#f85888', bug: '#a8b820',
  rock: '#b8a038', ghost: '#705898', dragon: '#7038f8', dark: '#705848', steel: '#b8b8d0', fairy: '#ee99ac',
};
const types = typesRaw.map(t => ({
  id: +t.id,
  key: t.identifier,
  name: typeNames.find(n => +n.type_id === +t.id)?.name ?? t.identifier,
  color: TYPE_COLORS[t.identifier],
}));
const typeById = new Map(types.map(t => [t.id, t]));
const typeIds = types.map(t => t.id);

// efficacia: chart[attaccante][difensore] (x100 → moltiplicatore); valori attuali (= Gen 8)
const chart = {};
for (const t of types) chart[t.id] = {};
for (const e of load('type_efficacy')) {
  const a = +e.damage_type_id, d = +e.target_type_id;
  if (typeById.has(a) && typeById.has(d)) chart[a][d] = +e.damage_factor / 100;
}
// dati storici: se la tabella a Gen 8 differisce da quella attuale, applica il valore passato più vicino
for (const e of load('type_efficacy_past').filter(r => +r.generation_id >= GEN)) {
  const a = +e.damage_type_id, d = +e.target_type_id;
  if (typeById.has(a) && typeById.has(d)) chart[a][d] = +e.damage_factor / 100;
}

// ---------- Pokémon ----------
const species = new Map(load('pokemon_species').map(s => [+s.id, s]));
const speciesNames = new Map(); // it con fallback en
for (const r of load('pokemon_species_names')) {
  const l = +r.local_language_id;
  if (l === LANG_EN && !speciesNames.has(+r.pokemon_species_id)) speciesNames.set(+r.pokemon_species_id, r.name);
}
for (const r of load('pokemon_species_names')) {
  if (+r.local_language_id === LANG_IT) speciesNames.set(+r.pokemon_species_id, r.name);
}

const dexNums = load('pokemon_dex_numbers').filter(r => GALAR_DEXES.includes(+r.pokedex_id));
const galarSpecies = new Map(); // species_id → set di dex
for (const r of dexNums) {
  if (!galarSpecies.has(+r.species_id)) galarSpecies.set(+r.species_id, new Set());
  galarSpecies.get(+r.species_id).add(+r.pokedex_id);
}

const pokemonRaw = load('pokemon');
const forms = load('pokemon_forms');
// forme che esistono solo in lotta (Zen, Lama, Banco, Sguardo ecc.): non sono scelte di squadra
const battleOnly = new Set(forms.filter(f => f.is_battle_only === '1').map(f => +f.pokemon_id));

// mosse apprendibili (uniche per Pokémon) in Spada/Scudo + DLC
const learn = new Map();
for (const r of load('pokemon_moves')) {
  if (!GALAR_VERSION_GROUPS.includes(+r.version_group_id)) continue;
  const pid = +r.pokemon_id;
  if (!learn.has(pid)) learn.set(pid, new Set());
  learn.get(pid).add(+r.move_id);
}

const stats = {}, statsPast = {};
for (const r of load('pokemon_stats')) (stats[r.pokemon_id] ??= {})[+r.stat_id] = +r.base_stat;
for (const r of load('pokemon_stats_past').filter(r => +r.generation_id >= GEN)) {
  const g = +r.generation_id;
  const cur = (statsPast[r.pokemon_id] ??= { g, v: {} });
  if (g < cur.g) { cur.g = g; cur.v = {}; }
  if (g === cur.g) cur.v[+r.stat_id] = +r.base_stat;
}
const typesOf = {}, typesPast = {};
for (const r of load('pokemon_types')) (typesOf[r.pokemon_id] ??= []).push({ t: +r.type_id, s: +r.slot });
for (const r of load('pokemon_types_past').filter(r => +r.generation_id >= GEN)) {
  const g = +r.generation_id;
  const cur = (typesPast[r.pokemon_id] ??= { g, v: [] });
  if (g < cur.g) { cur.g = g; cur.v = []; }
  if (g === cur.g) cur.v.push({ t: +r.type_id, s: +r.slot });
}
const abilitiesOf = {}, abilitiesPast = {};
for (const r of load('pokemon_abilities')) (abilitiesOf[r.pokemon_id] ??= []).push({ a: +r.ability_id, h: r.is_hidden === '1', s: +r.slot });
for (const r of load('pokemon_abilities_past').filter(r => +r.generation_id >= GEN)) {
  const g = +r.generation_id;
  const cur = (abilitiesPast[r.pokemon_id] ??= { g, v: [] });
  if (g < cur.g) { cur.g = g; cur.v = []; }
  if (g === cur.g) cur.v.push({ a: num(r.ability_id), h: r.is_hidden === '1', s: +r.slot });
}

const pokemon = [];
const usedAbilities = new Set();
const usedMoves = new Set();
for (const p of pokemonRaw) {
  const id = +p.id, sid = +p.species_id;
  if (!galarSpecies.has(sid)) continue;
  if (!learn.has(id)) continue;                       // non esiste in Spada/Scudo
  if (/-(gmax|totem|eternamax|mega|primal|starter|cap|own-tempo)/.test(p.identifier)) continue; // cosmetiche / non selezionabili
  if (battleOnly.has(id) && !/-crowned$/.test(p.identifier)) continue;                   // forme solo-lotta (es. Zen)
  const sp = species.get(sid);
  if (+sp.generation_id > GEN) continue;

  // tipi / stat / abilità validi a Gen 8
  let tps = typesOf[id] ?? [];
  if (typesPast[id]) tps = typesPast[id].v;
  tps = tps.sort((a, b) => a.s - b.s).map(x => x.t).filter(t => typeById.has(t));

  const st = { ...(stats[id] ?? {}) };
  if (statsPast[id]) Object.assign(st, statsPast[id].v);

  let abs = abilitiesOf[id] ?? [];
  if (abilitiesPast[id]) {
    // la tabella storica indica come erano gli slot: sostituisce/rimuove lo slot corrispondente
    for (const past of abilitiesPast[id].v) {
      abs = abs.filter(x => x.s !== past.s);
      if (past.a) abs.push({ a: past.a, h: past.h, s: past.s });
    }
  }
  abs.sort((a, b) => a.s - b.s);
  abs.forEach(a => usedAbilities.add(a.a));

  const moves = [...learn.get(id)].sort((a, b) => a - b);
  moves.forEach(m => usedMoves.add(m));

  // nome mostrato
  const baseName = speciesNames.get(sid) ?? p.identifier;
  let label = baseName, formKey = null;
  if (p.is_default !== '1') {
    const suffix = p.identifier.slice(sp.identifier.length + 1);
    formKey = suffix;
    const first = suffix.split('-')[0];
    label = FORM_SUFFIX[first] ? `${baseName} ${FORM_SUFFIX[first]}`
      : FORM_IT[suffix] ? `${baseName} (${FORM_IT[suffix]})` : `${baseName} (${suffix.replace(/-/g, ' ')})`;
  }

  pokemon.push({
    id,
    sp: sid,
    key: p.identifier,
    name: label,
    form: formKey,
    gen: +sp.generation_id,
    dex: [...galarSpecies.get(sid)].sort((a, b) => a - b), // 27=Galar, 28=Isola, 29=Corona
    types: tps,
    stats: [1, 2, 3, 4, 5, 6].map(i => st[i] ?? 0),        // PS, Att, Dif, AttSp, DifSp, Vel
    abilities: abs.map(a => ({ id: a.a, hidden: a.h })),
    moves,
    legendary: sp.is_legendary === '1' || sp.is_mythical === '1',
  });
}
pokemon.sort((a, b) => a.sp - b.sp || a.id - b.id);

// ---------- abilità ----------
const abilityRaw = new Map(load('abilities').map(a => [+a.id, a]));
const abilityName = new Map(), abilityEffect = new Map();
for (const r of load('ability_names')) {
  const l = +r.local_language_id;
  if (l === LANG_EN && !abilityName.has(+r.ability_id)) abilityName.set(+r.ability_id, r.name);
}
for (const r of load('ability_names')) if (+r.local_language_id === LANG_IT) abilityName.set(+r.ability_id, r.name);
for (const r of load('ability_prose')) if (+r.local_language_id === LANG_EN) abilityEffect.set(+r.ability_id, r.short_effect);
const abilities = {};
for (const id of usedAbilities) {
  const raw = abilityRaw.get(id);
  const key = raw.identifier;
  const fx = ABILITY_FX[key];
  abilities[id] = {
    key,
    name: abilityName.get(id) ?? key,
    effect: fx?.it ?? abilityEffect.get(id) ?? '',
    effectLang: fx ? 'it' : 'en',
    ...(fx?.def ? { def: fx.def } : {}),
    ...(fx?.off ? { off: fx.off } : {}),
  };
}

// ---------- mosse ----------
const moveNames = new Map();
for (const r of load('move_names')) if (+r.local_language_id === LANG_EN) moveNames.set(+r.move_id, r.name);
for (const r of load('move_names')) if (+r.local_language_id === LANG_IT) moveNames.set(+r.move_id, r.name);
const moves = {};
for (const m of load('moves')) {
  const id = +m.id;
  if (!usedMoves.has(id) || +m.generation_id > GEN) continue;
  const t = +m.type_id;
  if (!typeById.has(t)) continue;
  // [nome, tipo, potenza, classe (1 stato,2 fisico,3 speciale), precisione]
  moves[id] = [moveNames.get(id) ?? m.identifier, t, num(m.power), +m.damage_class_id, num(m.accuracy)];
}
// ripulisce gli id mossa non più validi
for (const p of pokemon) p.moves = p.moves.filter(id => moves[id]);

// ---------- oggetti ----------
const itemFlags = new Map(load('item_flags').map(f => [+f.id, f.identifier]));
const holdable = new Set(load('item_flag_map').filter(r => ['holdable', 'holdable-passive', 'holdable-active'].includes(itemFlags.get(+r.item_flag_id))).map(r => +r.item_id));
const inGen8 = new Set(load('item_game_indices').filter(r => +r.generation_id === GEN).map(r => +r.item_id));
const itemNames = new Map(), itemEffect = new Map();
for (const r of load('item_names')) if (+r.local_language_id === LANG_EN && !itemNames.has(+r.item_id)) itemNames.set(+r.item_id, r.name);
for (const r of load('item_names')) if (+r.local_language_id === LANG_IT) itemNames.set(+r.item_id, r.name);
for (const r of load('item_prose')) if (+r.local_language_id === LANG_EN) itemEffect.set(+r.item_id, r.short_effect);
const items = [];
for (const it of load('items')) {
  const id = +it.id;
  if (!holdable.has(id) || !inGen8.has(id)) continue;
  const entry = { id, key: it.identifier, name: itemNames.get(id) ?? it.identifier, effect: (itemEffect.get(id) ?? '').replace(/^Held:\s*/, '') };
  if (it.identifier === 'air-balloon') { entry.def = { ground: 0 }; entry.effect = 'Rende immune al tipo Terra finché non viene colpito.'; entry.effectLang = 'it'; }
  if (BERRY_TYPE[it.identifier]) {
    entry.berry = BERRY_TYPE[it.identifier];
    entry.effect = `Dimezza una volta un colpo superefficace di tipo ${typeById.get(typeIds.find(t => typeById.get(t).key === entry.berry)).name}.`;
    entry.effectLang = 'it';
  }
  items.push(entry);
}
items.sort((a, b) => a.name.localeCompare(b.name, 'it'));

// ---------- scrittura ----------
fs.mkdirSync(outDir, { recursive: true });
const core = { generation: GEN, types, chart, pokemon, abilities, items };
fs.writeFileSync(path.join(outDir, 'core.json'), JSON.stringify(core));
fs.writeFileSync(path.join(outDir, 'moves.json'), JSON.stringify(moves));
console.log(`Pokémon: ${pokemon.length} (specie: ${new Set(pokemon.map(p => p.sp)).size}) · abilità: ${Object.keys(abilities).length} · mosse: ${Object.keys(moves).length} · oggetti: ${items.length}`);
console.log(`core.json ${(fs.statSync(path.join(outDir, 'core.json')).size / 1024).toFixed(0)} KB · moves.json ${(fs.statSync(path.join(outDir, 'moves.json')).size / 1024).toFixed(0)} KB`);
