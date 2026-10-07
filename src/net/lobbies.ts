import type { Mode } from '../engine/game';
import { API_BASE } from './api';

/** A table anyone can join from the public list (server/api.ts, /api/tables). */
export interface PublicTable {
  code: string;
  host: string;
  mode: Mode;
  humans: number;
}

export async function listTables(): Promise<PublicTable[]> {
  const res = await fetch(`${API_BASE}/tables`, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`tables ${res.status}`);
  return ((await res.json()) as { tables: PublicTable[] }).tables;
}

/** The server forgets a table after 45 s without news. */
const REFRESH_MS = 15_000;

/**
 * Keeps your table on the public list while its lobby is open. Only this browser knows the secret,
 * so nobody else can change or remove the listing.
 */
export class PublicListing {
  private readonly secret = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  private timer: ReturnType<typeof setInterval> | null = null;
  private soon: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly code: string, private readonly info: () => Omit<PublicTable, 'code'> | null) {
    window.addEventListener('pagehide', this.stop);
    this.timer = setInterval(() => this.send(), REFRESH_MS);
    this.send();
  }

  /** Something changed (someone sat down, the mode): tell the list shortly. */
  refresh(): void {
    if (this.timer && !this.soon) this.soon = setTimeout(() => { this.soon = null; this.send(); }, 500);
  }

  private send(): void {
    const info = this.info();
    if (!info) return;
    void fetch(`${API_BASE}/tables`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: this.code, ...info, secret: this.secret }),
    }).catch(() => { /* try again next time */ });
  }

  readonly stop = (): void => {
    if (!this.timer) return;
    clearInterval(this.timer);
    if (this.soon) clearTimeout(this.soon);
    this.timer = this.soon = null;
    window.removeEventListener('pagehide', this.stop);
    void fetch(`${API_BASE}/tables/close`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ code: this.code, secret: this.secret }),
    }).catch(() => { /* it expires on its own */ });
  };
}
