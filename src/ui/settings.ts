import type { Difficulty } from '../engine/ai';
import type { Lang } from './i18n';

export interface Settings {
  lang: Lang;
  difficulty: Difficulty;
  targetScore: number;
  capicuBonus: boolean;
  countAllHands: boolean;
  volume: number;
  speed: 'slow' | 'normal' | 'fast';
}

export const DEFAULT_SETTINGS: Settings = {
  lang: 'es', difficulty: 'normal', targetScore: 500, capicuBonus: true,
  countAllHands: true, volume: 0.7, speed: 'normal',
};

const KEY = 'capicu.settings.v1';
const SAVE_KEY = 'capicu.match.v1';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(KEY) });
export const saveSettings = (s: Settings): void => write(KEY, s);
export const loadSavedMatch = <T>(): T | null => read<T>(SAVE_KEY);
export const saveMatch = (m: unknown): void => write(SAVE_KEY, m);
