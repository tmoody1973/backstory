import { stripHtml } from "./cds";

export interface CdsArticle {
  id: string;
  layout?: { href: string }[];
  assets?: Record<string, { text?: string }>;
}

/** CDS marks quoted lyrics as italic lines joined by <br>: every visible run is inside <em>, and there is a <br>. */
export function isLyricBlock(html: string): boolean {
  if (!/<br\s*\/?>/i.test(html)) return false;
  const outside = html
    .replace(/<em>[\s\S]*?<\/em>/gi, "")
    .replace(/<br\s*\/?>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
  return outside === "";
}

/** The article's text in layout order, one paragraph (or list item) per entry, lyrics removed. */
export function articleParagraphs(doc: CdsArticle): string[] {
  const out: string[] = [];
  for (const { href } of doc.layout ?? []) {
    const html = doc.assets?.[href.replace("#/assets/", "")]?.text;
    if (!html || isLyricBlock(html)) continue;
    const items = /<li>/i.test(html) ? [...html.matchAll(/<li>([\s\S]*?)<\/li>/gi)].map((m) => m[1]) : [html];
    for (const item of items) {
      const text = stripHtml(item);
      if (text) out.push(text);
    }
  }
  return out;
}
