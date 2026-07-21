import { describe, expect, it } from "vitest";
import { cleanSnippet, decodeHtmlEntities, decodeRfc2047 } from "../html-entities";
import { extractDomain } from "../gmail";
import { senderName } from "../format";

// These helpers exist because each of these cases showed up in real mail.

describe("decodeHtmlEntities", () => {
  it("decodes the entities Gmail actually emits", () => {
    expect(decodeHtmlEntities("Bryce &lt;&gt; Rich")).toBe("Bryce <> Rich");
    expect(decodeHtmlEntities("Tom &amp; Jerry &#39;24")).toBe("Tom & Jerry '24");
    expect(decodeHtmlEntities("caf&#233; &#x2014; menu")).toBe("café — menu");
  });

  it("leaves unknown or malformed entities alone", () => {
    expect(decodeHtmlEntities("&unknown; &#xzz; 5 &lt 3")).toBe("&unknown; &#xzz; 5 &lt 3");
  });
});

describe("cleanSnippet", () => {
  it("strips newsletter preview padding and collapses whitespace", () => {
    expect(cleanSnippet("Sale!‌‌‌   ends ­﻿ soon")).toBe(
      "Sale! ends soon",
    );
  });
});

describe("decodeRfc2047", () => {
  it("decodes B-encoded UTF-8 words", () => {
    expect(decodeRfc2047("=?UTF-8?B?WsO2w6s=?= <z@x.com>")).toBe("Zöë <z@x.com>");
  });

  it("decodes Q-encoded words with underscores and hex bytes", () => {
    expect(decodeRfc2047("=?utf-8?Q?Caf=C3=A9_Deals?=")).toBe("Café Deals");
  });

  it("joins adjacent encoded words without the separating whitespace", () => {
    expect(decodeRfc2047("=?UTF-8?B?SGVsbG8g?= =?UTF-8?B?d29ybGQ=?=")).toBe(
      "Hello world",
    );
  });

  it("falls back to utf-8 for unknown charsets and passes plain text through", () => {
    expect(decodeRfc2047("=?x-nope?B?aGk=?=")).toBe("hi");
    expect(decodeRfc2047("Plain subject")).toBe("Plain subject");
  });
});

describe("senderName", () => {
  it("extracts display names, including quoted ones with commas", () => {
    expect(senderName('Jane Doe <jane@x.com>')).toBe("Jane Doe");
    expect(senderName('"Ha, Rich" <redacted@sequoiacap.com>')).toBe("Ha, Rich");
    expect(senderName("bare@address.com")).toBe("bare@address.com");
    expect(senderName(null)).toBe("(unknown sender)");
  });
});

describe("extractDomain", () => {
  it("pulls the lowercased domain out of a From header", () => {
    expect(extractDomain("Jane <Jane@Example.COM>")).toBe("example.com");
    expect(extractDomain("no address here")).toBeNull();
    expect(extractDomain(null)).toBeNull();
  });
});
