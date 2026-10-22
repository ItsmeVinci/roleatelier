const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  eacute: 'é',
  egrave: 'è',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  szlig: 'ß',
  cent: '¢',
  pound: '£',
  euro: '€',
  yen: '¥',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      const n = parseInt(code.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    if (code.startsWith('#')) {
      const n = parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Strip HTML to readable plain text, keeping paragraph and list structure. */
export function htmlToText(html: string): string {
  let s = (html ?? '').replace(/\r\n?/g, '\n');
  // Some boards (Arbeitnow) double-escape their markup.
  if (/&lt;\/?(p|div|br|li|ul|ol|h[1-6]|strong|em|a)\b/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|iframe|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|tr|h[1-6]|blockquote|pre)>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(li|ul|ol)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s;
}

export function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

/** Words that matter, for keyword matching. */
export function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter((w) => w.length > 2);
}

export function parseSalary(raw: string): { min: number | null; max: number | null; currency: string } {
  if (!raw) return { min: null, max: null, currency: '' };
  const currency = /£/.test(raw) ? 'GBP' : /€/.test(raw) ? 'EUR' : /\$|usd/i.test(raw) ? 'USD' : '';

  // Per-task/project/article/word rates are not salaries. Annualising them
  // produces absurd numbers (e.g. "$1000 per task" becoming $12k/year).
  if (/\bper[\s-]+(task|project|article|word)\b|\b(task|project|article|word)[\s-]+based\b/i.test(raw)) {
    return { min: null, max: null, currency };
  }

  const unit =
    /(?:\/|per\s+|an?\s+)(hour|hr|day|week|month|year|annum)\b|\b(hourly|daily|weekly|monthly|yearly|annual(?:ly)?)\b/i.exec(
      raw,
    );
  const word = (unit?.[1] || unit?.[2] || '').toLowerCase();
  let factor: number | null = null;
  if (word) {
    if (/^(hour|hr|hourly)$/.test(word)) factor = 2080;
    else if (/^(day|daily)$/.test(word)) factor = 240;
    else if (/^(week|weekly)$/.test(word)) factor = 52;
    else if (/^(month|monthly)$/.test(word)) factor = 12;
    else factor = 1;
  }

  const parsed: { value: number; suffix: string; at: number }[] = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(k|m)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    let n = parseFloat(m[1].replace(/,/g, ''));
    const suffix = (m[2] || '').toLowerCase();
    if (suffix === 'k') n *= 1_000;
    if (suffix === 'm') n *= 1_000_000;
    if (n > 0) parsed.push({ value: n, suffix, at: m.index });
  }
  if (!parsed.length) return { min: null, max: null, currency };

  let nums: number[];
  if (factor != null) {
    nums = parsed.map((n) => Math.round(n.value * factor));
  } else {
    const hasThousands = parsed.some((n) => n.value >= 1000);
    const firstK = parsed.find((n) => n.suffix === 'k')?.at ?? Infinity;
    nums = parsed
      .map((n) => (hasThousands && n.value < 1000 && n.at < firstK ? n.value * 1_000 : n.value))
      .filter((n) => (hasThousands ? n >= 1000 : n >= 10));
    if (!nums.length) return { min: null, max: null, currency };
    nums = nums.map((n) => (n < 200 ? n * 2080 : n < 5000 ? n * 12 : n));
  }

  const values = nums.slice(0, 2).sort((a, b) => a - b);
  return { min: values[0] ?? null, max: values[1] ?? values[0] ?? null, currency };
}

export function fmtSalary(min: number | null, max: number | null, currency: string): string {
  if (!min && !max) return '';
  const sym = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  if (min && max && min !== max) return `${sym}${k(min)}–${sym}${k(max)}`;
  return `${sym}${k((min ?? max) as number)}`;
}
