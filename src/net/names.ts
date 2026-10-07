/**
 * Player names: shared by the game and the name server (server/api.ts), so both agree on what is
 * valid and on when two names count as the same one.
 */

export const NAME_MIN = 3;
export const NAME_MAX = 16;

/** Letters (accents included), digits, and single spaces, dots, dashes or underscores in between. */
const NAME_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N}]|[ ._-](?=[\p{L}\p{N}]))*$/u;

/** The tidied name, or null when it isn't allowed. */
export function cleanName(raw: string): string | null {
  const name = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  const length = [...name].length;
  return length >= NAME_MIN && length <= NAME_MAX && NAME_RE.test(name) ? name : null;
}

/** Names that differ only in accents, capitals or separators are the same name: "José_PR" = "jose pr". */
export function nameKey(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[ ._-]/g, '');
}

/** The table's own characters and words the game shows next to names. */
const RESERVED = new Set(['wiso', 'papo', 'donalola', 'lola', 'cheo', 'tu', 'you', 'invitado', 'guest', 'ia', 'ai',
  'anfitrion', 'host', 'capicu', 'admin', 'moderador', 'moderator'].map(nameKey));

export const isReserved = (name: string): boolean => RESERVED.has(nameKey(name));

export const CHAT_MAX = 160;

/** One line of chat: no control characters, no runs of spaces, not too long. Empty means nothing to send. */
export function cleanChat(raw: string): string {
  const text = raw.replace(/\p{Cc}/gu, ' ').replace(/[‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  return [...text].slice(0, CHAT_MAX).join('');
}
