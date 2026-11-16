/**
 * Parse a typed number guess. Accepts a decimal comma or point, spaces as thousands
 * separators, and "1.234.567" / "1,234,567" / "1.234,5" style grouping. On a
 * whole-number question (decimals = 0), "1.400" or "1,400" means 1400, not 1.4.
 * Returns NaN for anything else (letters, units, stray symbols).
 */
export function parseNumber(raw: string, decimals = 2): number {
  let s = raw.replace(/[\s  ]/g, "").replace(/^[−–]/, "-");
  if (!/^-?[\d.,]+$/.test(s)) return NaN;
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  const seps = s.match(/[.,]/g) ?? [];
  let intPart = s;
  let frac = "";
  if (seps.length > 0) {
    const kinds = new Set(seps);
    const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    if (kinds.size === 2) {
      // Mixed: the last separator is the decimal one, the other kind groups thousands.
      const dec = s[last];
      if (s.indexOf(dec) !== last) return NaN;
      intPart = s.slice(0, last);
      frac = s.slice(last + 1);
      if (!grouped(intPart, dec === "." ? "," : ".")) return NaN;
      intPart = intPart.replace(/[.,]/g, "");
    } else if (seps.length > 1) {
      // One kind, several times: thousands grouping only.
      if (!grouped(s, s[last])) return NaN;
      intPart = s.replace(/[.,]/g, "");
    } else {
      const head = s.slice(0, last);
      const tail = s.slice(last + 1);
      const thousands = decimals === 0 && /^\d{3}$/.test(tail) && /^[1-9]\d{0,2}$/.test(head);
      intPart = thousands ? head + tail : head;
      frac = thousands ? "" : tail;
    }
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac) || intPart + frac === "") return NaN;
  const v = Number(`${intPart || "0"}.${frac || "0"}`);
  return neg ? -v : v;
}

function grouped(s: string, sep: string): boolean {
  const parts = s.split(sep);
  return /^[1-9]\d{0,2}$/.test(parts[0]) && parts.slice(1).every((p) => /^\d{3}$/.test(p));
}
