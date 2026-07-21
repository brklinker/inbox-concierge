const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

/** Gmail's snippet field arrives HTML-escaped ("Bryce &lt;&gt; Rich"); undo it. */
export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const code =
        entity[1]?.toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED[entity] ?? match;
  });
}

/**
 * Newsletters pad snippets with invisible characters (zero-width joiners,
 * soft hyphens) to control preview text; strip them and collapse whitespace.
 */
export function cleanSnippet(s: string): string {
  // Zero-width space/joiners, word joiner, soft hyphen, BOM, combining
  // grapheme joiner, braille blank.
  return decodeHtmlEntities(s)
    .replace(/[\u200b\u200c\u200d\u2060\u00ad\ufeff\u034f\u2800]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEncodedWord(charset: string, encoding: string, data: string): string {
  const bytes =
    encoding.toUpperCase() === "B"
      ? Buffer.from(data, "base64")
      : Buffer.from(
          data
            .replace(/_/g, " ")
            .replace(/=([0-9a-fA-F]{2})/g, (_, hex) =>
              String.fromCharCode(parseInt(hex, 16)),
            ),
          "latin1",
        );
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

/**
 * Non-ASCII headers arrive RFC 2047-encoded ("=?UTF-8?B?...?=") — the Gmail
 * API does not decode them. Whitespace between adjacent encoded words is
 * ignored per the RFC.
 */
export function decodeRfc2047(s: string): string {
  if (!s.includes("=?")) return s;
  return s
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, data) =>
      decodeEncodedWord(charset, enc, data),
    );
}
