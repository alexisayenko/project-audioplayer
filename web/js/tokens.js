export const SEPARATOR = ' - ';
const DASHES = new Set(['-', '–', '—']);

const isWs = (c) => c !== undefined && c.trim() === '';

const SLASHES = new Set(['/', '／']);
const PIPES = new Set(['|', '｜']);

function coreLength(s, i) {
  const c = s[i];
  if (!(i > 0 && isWs(s[i - 1]))) return 0;
  if (DASHES.has(c) || PIPES.has(c)) return isWs(s[i + 1]) ? 1 : 0;
  if (!SLASHES.has(c)) return 0;
  const len = SLASHES.has(s[i + 1]) ? 2 : 1;
  return isWs(s[i + len]) ? len : 0;
}

function separatorEnd(s, from, len) {
  let end = from + len;
  for (;;) {
    while (end < s.length && isWs(s[end])) end += 1;
    const more = end < s.length ? coreLength(s, end) : 0;
    if (!more) return end;
    end += more;
  }
}

export function tokenize(text) {
  const s = String(text ?? '');
  const out = [];
  let start = 0;
  let i = 0;
  while (i < s.length) {
    const len = coreLength(s, i);
    if (!len) { i += 1; continue; }
    let sepStart = i;
    while (sepStart > start && isWs(s[sepStart - 1])) sepStart -= 1;
    const end = separatorEnd(s, i, len);
    out.push({ text: s.slice(start, sepStart), sep: s.slice(sepStart, end) });
    start = end;
    i = end;
  }
  out.push({ text: s.slice(start), sep: '' });
  return out;
}

export const compose = (tokens) => tokens.map((t) => t.text + t.sep).join('');

export const isBlankToken = (t) => t.text.trim() === '';

export function removeToken(text, i) {
  const toks = tokenize(text);
  if (!Number.isInteger(i) || i < 0 || i >= toks.length) return text;
  if (toks.length === 1) return '';
  if (i === toks.length - 1) {
    toks.pop();
    toks.at(-1).sep = '';
  } else {
    toks.splice(i, 1);
  }
  return compose(toks).trim();
}

export function replaceToken(text, i, newText) {
  const toks = tokenize(text);
  if (!Number.isInteger(i) || i < 0 || i >= toks.length) return text;
  const t = String(newText ?? '').trim();
  if (!t) return removeToken(text, i);
  toks[i].text = t;
  return compose(toks);
}

export function endsWithSeparator(text) {
  const toks = tokenize(text);
  return toks.length > 1 && isBlankToken(toks.at(-1));
}

export function appendToken(text, token, defaultSep) {
  const t = String(token ?? '').trim();
  const base = String(text ?? '');
  if (!t) return base;
  if (base.trim() === '') return t;
  if (endsWithSeparator(base)) {
    const trimmed = base.trimEnd();
    return (trimmed === base ? `${base} ` : base) + t;
  }
  return base.trimEnd() + defaultSep + t;
}

export function moveToken(srcText, i, dstText, dstDefaultSep) {
  const toks = tokenize(srcText);
  const t = toks[i];
  if (!t || isBlankToken(t)) return { src: srcText, dst: dstText };
  return { src: removeToken(srcText, i), dst: appendToken(dstText, t.text, dstDefaultSep) };
}

export function insertToken(text, index, tokenText, defaultSep) {
  const t = String(tokenText ?? '').trim();
  const base = String(text ?? '');
  if (!t) return base;
  if (base.trim() === '') return t;
  const toks = tokenize(base);
  let at = Number.isInteger(index) ? Math.max(0, index) : toks.length;
  if (at === 0 && isBlankToken(toks[0])) at = 1;
  if (at >= toks.length || (at === toks.length - 1 && isBlankToken(toks[at]))) return appendToken(base, t, defaultSep);
  toks.splice(at, 0, { text: t, sep: defaultSep });
  return compose(toks);
}

export function moveTokenTo(srcText, i, dstText, dstIndex, dstDefaultSep, sameField = srcText === dstText) {
  const tok = tokenize(srcText)[i];
  if (!tok || isBlankToken(tok)) return { src: srcText, dst: dstText };
  const at = Math.min(Number.isInteger(dstIndex) ? dstIndex : Infinity, tokenize(dstText).length);
  if (sameField) {
    if (at === i || at === i + 1) return { src: srcText, dst: srcText };
    const out = insertToken(removeToken(srcText, i), at > i ? at - 1 : at, tok.text, dstDefaultSep);
    return { src: out, dst: out };
  }
  return { src: removeToken(srcText, i), dst: insertToken(dstText, at, tok.text, dstDefaultSep) };
}

export function stripEdges(text) {
  const toks = tokenize(text);
  while (toks.length > 1 && isBlankToken(toks.at(-1))) {
    toks.pop();
    toks.at(-1).sep = '';
  }
  while (toks.length > 1 && isBlankToken(toks[0])) toks.shift();
  return compose(toks).trim();
}

export function commitTyped(text, typed, defaultSep) {
  const toks = tokenize(typed);
  if (toks.length < 2) return { value: text, rest: typed };
  const rest = toks.pop().text;
  const done = compose(toks);
  const lead = done.length - done.trimStart().length;
  const chunk = done.slice(lead);
  const base = String(text ?? '');
  let value;
  if (!chunk.trim() || toks.every(isBlankToken)) value = base;
  else if (base.trim() === '') value = chunk;
  else if (endsWithSeparator(base)) value = (base.trimEnd() === base ? `${base} ` : base) + chunk;
  else value = base.trimEnd() + defaultSep + chunk;
  return { value, rest };
}

export const splitTokens = (text) => tokenize(text).filter((t) => !isBlankToken(t)).map((t) => t.text.trim());

export const joinTokens = (parts) => parts.map((p) => String(p ?? '').trim()).filter(Boolean).join(SEPARATOR);
