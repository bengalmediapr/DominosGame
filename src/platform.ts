/** Bridge to the desktop shell (Electron preload). Falls back to browser behaviour. */
export interface PlatformBridge {
  isDesktop: boolean;
  quit(): void;
  toggleFullscreen(): void;
  unlockAchievement(id: string): void;
}

declare global {
  interface Window { dominoPlatform?: PlatformBridge }
}

const web: PlatformBridge = {
  isDesktop: false,
  quit: () => {},
  toggleFullscreen: () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  },
  unlockAchievement: () => {},
};

export const platform: PlatformBridge = window.dominoPlatform ?? web;

/** Achievement API names; configure the same IDs in Steamworks > Stats & Achievements. */
export const ACHIEVEMENTS = {
  firstHand: 'ACH_FIRST_HAND',
  firstMatch: 'ACH_FIRST_MATCH',
  capicu: 'ACH_CAPICU',
  pollona: 'ACH_POLLONA',
  tranque: 'ACH_TRANQUE_WIN',
  hardWin: 'ACH_HARD_WIN',
} as const;
