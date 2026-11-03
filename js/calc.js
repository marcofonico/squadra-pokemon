// Calcolo di debolezze, resistenze e coperture offensive (generazione 8, 18 tipi).

export class Calc {
  constructor(core, moves) {
    this.core = core;
    this.moves = moves;
    this.types = core.types;
    this.typeById = new Map(core.types.map(t => [t.id, t]));
    this.typeByKey = new Map(core.types.map(t => [t.key, t]));
    this.pokeById = new Map(core.pokemon.map(p => [p.id, p]));
    this.itemById = new Map(core.items.map(i => [i.id, i]));
    this.chart = core.chart;
  }

  /** Moltiplicatore base di un tipo attaccante su un bersaglio con 1–2 tipi. */
  base(atkTypeId, defTypes) {
    let m = 1;
    for (const d of defTypes) m *= this.chart[atkTypeId]?.[d] ?? 1;
    return m;
  }

  /** Danno subito da `atkTypeId` da un Pokémon di squadra (con abilità e strumento). */
  defense(slot, atkTypeId) {
    const p = this.pokeById.get(slot.pid);
    const key = this.typeById.get(atkTypeId).key;
    let m = this.base(atkTypeId, p.types);
    const ab = slot.ability != null ? this.core.abilities[slot.ability] : null;
    const fx = ab?.def;
    if (fx) {
      if (fx['*wonder']) { if (m <= 1) m = 0; }
      else {
        if (fx['*se'] && m > 1) m *= fx['*se'];
        if (fx[key] != null) m *= fx[key];
      }
    }
    const item = slot.item != null ? this.itemById.get(slot.item) : null;
    if (item?.def && item.def[key] != null) m *= item.def[key];
    if (item?.berry === key && (m > 1 || key === 'normal') && m > 0) m *= 0.5;
    return m;
  }

  /** Mosse offensive valide per la copertura (danneggianti). */
  damagingMoves(slot) {
    return (slot.moves || []).filter(Boolean).map(id => this.moves[id]).filter(m => m && m[3] !== 1);
  }

  /** Tipi con cui il Pokémon attacca: tipi delle mosse scelte, oppure STAB come stima. */
  attackTypes(slot) {
    const p = this.pokeById.get(slot.pid);
    const ab = slot.ability != null ? this.core.abilities[slot.ability] : null;
    const normalTo = ab?.off?.normalTo ? this.typeByKey.get(ab.off.normalTo).id : null;
    const normalId = this.typeByKey.get('normal').id;
    const moves = this.damagingMoves(slot);
    const est = moves.length === 0;
    let ids = est ? [...p.types] : [...new Set(moves.map(m => m[1]))];
    if (normalTo) ids = ids.map(t => (t === normalId ? normalTo : t));
    return { ids: [...new Set(ids)], est };
  }

  /** Miglior moltiplicatore offensivo di un Pokémon contro un tipo singolo. */
  offense(slot, targetTypeId) {
    const ab = slot.ability != null ? this.core.abilities[slot.ability] : null;
    const { ids, est } = this.attackTypes(slot);
    const ghost = this.typeByKey.get('ghost').id;
    let best = 0;
    for (const a of ids) {
      let m = this.chart[a]?.[targetTypeId] ?? 1;
      const aKey = this.typeById.get(a).key;
      if (ab?.off?.scrappy && targetTypeId === ghost && (aKey === 'normal' || aKey === 'fighting')) m = 1;
      if (ab?.off?.tinted && m > 0 && m < 1) m *= 2;
      best = Math.max(best, m);
    }
    return { m: best, est };
  }

  /** Tabella completa per la squadra: righe = tipi, colonne = slot. */
  table(team) {
    const rows = this.types.map(t => {
      const def = team.map(s => (s ? this.defense(s, t.id) : null));
      const off = team.map(s => (s ? this.offense(s, t.id) : null));
      const filled = def.filter(v => v != null);
      return {
        type: t,
        def,
        off,
        weak: filled.filter(v => v > 1).length,
        resist: filled.filter(v => v < 1).length,
        hit: off.filter(o => o && o.m > 1).length,
      };
    });
    return rows;
  }

  /** Statistiche effettive: valori base, con eventuali modifiche dell'utente. */
  stats(slot) {
    const base = this.pokeById.get(slot.pid).stats;
    return slot.stats ? base.map((b, i) => slot.stats[i] ?? b) : base;
  }

  statAverages(team) {
    const list = team.filter(Boolean).map(s => this.stats(s));
    if (!list.length) return null;
    return [0, 1, 2, 3, 4, 5].map(i => list.reduce((a, s) => a + s[i], 0) / list.length);
  }
}

export function fmtMult(m) {
  if (m === 0) return '0';
  if (m === 1) return '';
  const map = { 0.125: '⅛', 0.25: '¼', 0.5: '½', 0.75: '¾' };
  if (map[m]) return map[m];
  return `${String(+m.toFixed(2)).replace('.', ',')}×`;
}
