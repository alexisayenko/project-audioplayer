
const list = (v) => (Array.isArray(v) ? v : []);

export function hasStructure(payload) {
  return list(payload?.genres).some((g) => g && g.level === 1 && typeof g.name === 'string');
}

export function adaptGenresV2(payload) {
  const clusters = new Map(list(payload?.clusters).map((c) => [c.id, c]));
  const rows = list(payload?.genres).filter((g) => g && typeof g.name === 'string' && typeof g.id === 'string');
  const nameOf = new Map(rows.map((g) => [g.id, g.name]));
  const roots = rows.filter((g) => g.level === 1);
  const forms = {};
  const levels = {};
  const byName = {};
  const anchor = new Map();
  const hex = {};
  for (const g of rows) {
    const cluster = clusters.get(g.cluster);
    const synonyms = g.v1 && g.v1.toLowerCase() !== g.name.toLowerCase() ? [g.v1] : [];
    const common = {
      description: g.description || '', source_links: list(g.source_links), synonyms, discogs: true,
    };
    byName[g.name] = { ...g, clusterName: cluster?.name || '' };
    if (g.level === 1) {
      const colour = /^#[0-9a-f]{6}$/i.test(cluster?.colour) ? cluster.colour : null;
      if (colour && !anchor.has(g.cluster)) { anchor.set(g.cluster, g.name); hex[g.name] = colour; }
      forms[g.name] = { ...common, colour: colour && anchor.get(g.cluster) !== g.name ? anchor.get(g.cluster) : null, parents: [] };
    } else levels[g.name] = { ...common, parents: list(g.parents).map((p) => nameOf.get(p)).filter(Boolean) };
  }
  return {
    families: roots.map((g) => g.name),
    family_synonyms: {},
    forms,
    levels,
    groups: {},
    genres: [],
    modifiers: {},
    subfamilies: [],
    hex,
    v2: { clusters: [...clusters.values()], byName },
  };
}
