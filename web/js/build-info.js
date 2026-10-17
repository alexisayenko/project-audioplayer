const pad = (n) => String(n).padStart(2, '0');
const shaOk = (s) => typeof s === 'string' && /^[0-9a-f]{7,40}$/.test(s);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function local(d) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function utc(d) {
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function describeBuild(raw) {
  if (!raw || typeof raw !== 'object' || !shaOk(raw.sha)) return null;
  const short = raw.sha.slice(0, 7);
  const when = (v) => new Date(typeof v === 'string' ? v : Number.NaN);
  const deployed = when(raw.deployed_at);
  const committed = when(raw.committed_at);
  const text = Number.isNaN(deployed.getTime()) ? short : `${short} · ${local(deployed)}`;
  const parts = [`Commit ${raw.sha}`];
  if (!Number.isNaN(committed.getTime())) parts.push(`committed ${utc(committed)}`);
  if (!Number.isNaN(deployed.getTime())) parts.push(`deployed ${utc(deployed)}`);
  return { text, title: parts.join('\n') };
}
