
const list = (v) => (Array.isArray(v) ? v : []);

export function hasStructure(payload) {
  return list(payload?.genres).some((g) => g?.level === 1 && typeof g.name === 'string');
}

function familyEntry(g, key, common, cluster, anchor, hex) {
  const colour = /^#[0-9a-f]{6}$/i.test(cluster?.colour) ? cluster.colour : null;
  if (colour && !anchor.has(g.cluster)) {
    anchor.set(g.cluster, key);
    hex[key] = colour;
  }
  const shared = colour && anchor.get(g.cluster) !== key ? anchor.get(g.cluster) : null;
  return { ...common, colour: shared, parents: [] };
}

function synonymsOf(g) {
  return g.v1 && g.v1.toLowerCase() !== g.name.toLowerCase() ? [g.v1] : [];
}

export function adaptGenresV2(payload) {
  const clusters = new Map(list(payload?.clusters).map((c) => [c.id, c]));
  const valid = list(payload?.genres).filter((g) => g && typeof g.name === 'string' && typeof g.id === 'string');
  const rows = [...valid.filter((g) => !g.legacy), ...valid.filter((g) => g.legacy)];
  const keyOf = new Map();
  const taken = new Set();
  for (const g of rows) {
    const key = taken.has(g.name) ? g.id : g.name;
    taken.add(key);
    keyOf.set(g.id, key);
  }
  const roots = rows.filter((g) => g.level === 1);
  const forms = {};
  const levels = {};
  const byName = {};
  const anchor = new Map();
  const hex = {};
  for (const g of rows) {
    const key = keyOf.get(g.id);
    const cluster = clusters.get(g.cluster);
    const common = {
      description: g.description || '', source_links: list(g.source_links), synonyms: synonymsOf(g), discogs: true, ...(key !== g.name ? { display: g.name } : {}),
    };
    byName[key] = { ...g, key, clusterName: cluster?.name || '' };
    if (g.level === 1) {
      forms[key] = familyEntry(g, key, common, cluster, anchor, hex);
    } else levels[key] = { ...common, parents: list(g.parents).map((p) => keyOf.get(p)).filter(Boolean) };
  }
  return {
    families: roots.map((g) => keyOf.get(g.id)),
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
