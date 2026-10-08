// Writing HTML safely. Every value put into a page is escaped, so words from
// a customer or a caller always show as plain text and can never become part
// of the page (rule 17 in CLAUDE.md). Only pieces made by html`` itself go in
// as they are.

export class Html {
  constructor(readonly text: string) {}
  toString(): string {
    return this.text;
  }
}

type Piece = string | number | Html | readonly Html[] | null;

/** A piece of a page: html`<p>${words}</p>` escapes `words`. */
export function html(strings: TemplateStringsArray, ...pieces: Piece[]): Html {
  let out = strings[0] ?? '';
  pieces.forEach((piece, i) => {
    out += written(piece) + (strings[i + 1] ?? '');
  });
  return new Html(out);
}

/** Markup that is part of the system itself, such as the example's styles. Never words from a person. */
export function trusted(markup: string): Html {
  return new Html(markup);
}

function written(piece: Piece): string {
  if (piece === null) return '';
  if (piece instanceof Html) return piece.text;
  if (typeof piece === 'string' || typeof piece === 'number') return escape(String(piece));
  return piece.map((one) => one.text).join('');
}

const ENTITIES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escape(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ENTITIES[character] ?? character);
}
