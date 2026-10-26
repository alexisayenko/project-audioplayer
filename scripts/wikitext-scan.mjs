const WS = /\s/;
const NAME_CHAR = /[A-Za-z_ ]/;
const TERMINATOR = /[\n\r\u2028\u2029]/;
const BAR_OR_HASH = /[|#]/g;

const isTerminator = (c) => c !== undefined && TERMINATOR.test(c);
const isSpaceLike = (c) => c !== undefined && WS.test(c);

function skipSpace(text, from) {
  let i = from;
  while (i < text.length && WS.test(text[i])) i += 1;
  return i;
}

function nextLineStart(text, after) {
  let i = after + 1;
  while (i <= text.length && !isTerminator(text[i - 1])) i += 1;
  return i;
}

/**
 * Every `[[...]]` span without a `]` inside, left to right and non-overlapping, that `accept(text, from, to, nextSpecial)`
 * takes (from/to delimit the inside); one linear pass.
 */
export function scanLinks(text, accept) {
  const found = [];
  let special = -1;
  const nextSpecial = (from) => {
    if (special < from) {
      BAR_OR_HASH.lastIndex = from;
      const m = BAR_OR_HASH.exec(text);
      special = m ? m.index : Infinity;
    }
    return special;
  };
  let i = text.indexOf("[[");
  let close = -1;
  while (i >= 0) {
    if (close < i + 2) {
      close = text.indexOf("]", i + 2);
      if (close < 0) break;
    }
    const hit = text[close + 1] === "]" ? accept(text, i + 2, close, nextSpecial) : null;
    if (hit) {
      found.push({ index: i, end: close + 2, raw: text.slice(i, close + 2), ...hit });
      i = text.indexOf("[[", close + 2);
    } else {
      i = text.indexOf("[[", i + 1);
    }
  }
  return found;
}

export const anyLink = () => ({});

/** `[[Title]]`, `[[Title#Anchor]]`, `[[Title|Label]]`, `[[Title#Anchor|Label]]`. */
export function targetLink(text, from, to, nextSpecial) {
  if (from >= to || text[from] === "|" || text[from] === "#") return null;
  return { title: text.slice(from, Math.min(nextSpecial(from), to)) };
}

/** `[[Title]]` or `[[Title|Label]]`, no anchor. */
export function labelledLink(text, from, to, nextSpecial) {
  if (from >= to) return null;
  const sep = nextSpecial(from);
  if (sep === from) return null;
  if (sep >= to) return { title: text.slice(from, to), label: undefined };
  if (text[sep] === "#") return null;
  return { title: text.slice(from, sep), label: text.slice(sep + 1, to) };
}

export function replaceLinks(text, accept, render) {
  let out = "";
  let pos = 0;
  for (const link of scanLinks(text, accept)) {
    out += text.slice(pos, link.index) + render(link);
    pos = link.end;
  }
  return out + text.slice(pos);
}

function fieldHead(text, bar) {
  const s = skipSpace(text, bar + 1);
  let name;
  let eq;
  if (NAME_CHAR.test(text[s] ?? "")) {
    let e = s;
    while (e < text.length && NAME_CHAR.test(text[e])) e += 1;
    eq = skipSpace(text, e);
    name = text.slice(s, e).trimEnd();
  } else {
    if (text[s] !== "=" || !text.slice(bar + 1, s).includes(" ")) return null;
    eq = s;
    name = " ";
  }
  if (text[eq] !== "=") return null;
  return { key: name.toLowerCase().replaceAll(" ", "_"), valueStart: skipSpace(text, eq + 1) };
}

function closesTemplate(text, at) {
  if (!text.startsWith("}}", at)) return false;
  let r = at + 2;
  while (r < text.length && isSpaceLike(text[r]) && !isTerminator(text[r])) r += 1;
  return r >= text.length || isTerminator(text[r]);
}

function valueEnd(text, from) {
  const n = text.length;
  let line = from === 0 || isTerminator(text[from - 1]) ? from : nextLineStart(text, from);
  while (line <= n) {
    const q = skipSpace(text, line);
    if (q >= n) return n;
    if (closesTemplate(text, q)) {
      const nl = text.indexOf("\n", Math.max(from, line - 1));
      if (nl >= 0 && nl < q) return nl;
    } else if (text[q] === "|" && fieldHead(text, q)) {
      return line;
    }
    line = nextLineStart(text, q);
  }
  return n;
}

/** `| name = value` fields of an infobox block as { name_with_underscores: raw value }, a later field of the same name wins. */
export function infoboxFields(block) {
  const fields = {};
  let line = 0;
  while (line <= block.length) {
    const q = skipSpace(block, line);
    const head = block[q] === "|" ? fieldHead(block, q) : null;
    if (!head) {
      if (q >= block.length) break;
      line = nextLineStart(block, q);
      continue;
    }
    const end = valueEnd(block, head.valueStart);
    fields[head.key] = block.slice(head.valueStart, end);
    line = end === 0 || isTerminator(block[end - 1]) ? end : nextLineStart(block, end);
  }
  return fields;
}
