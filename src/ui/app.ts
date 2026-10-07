import {
  CHAMBERS, MatchState, Mode, Move, Rules, Side, fireChance, legalMoves, teamOf,
} from '../engine/game';
import { Tile, handPips, sameTile } from '../engine/tiles';
import {
  LeaderRow, Profile, ProfileFailure, createName, leaderboard, matchPoints, newMatchId, refreshProfile, reportResult, savedProfile,
  signIn, signOut, updateProfile,
} from '../net/profile';
import { ChatLine, GuestSession, HostSession, LocalSession, Session, TableConfig } from '../net/session';
import type { TableEvent } from '../net/table';
import {
  NetError, SteamBridge, Transport, hostInTabs, hostOnInternet, hostOnSteam, joinInTabs, joinOnInternet, joinOnSteam,
} from '../net/transport';
import { View, toEngine, toView } from '../net/view';
import { ACHIEVEMENTS, platform } from '../platform';
import { SEAT_LOOKS } from '../three/characters';
import { TableScene } from '../three/scene';
import { bang, clack, coqui, dryClick, fanfare, setVolume, spin } from './audio';
import { setLang, t } from './i18n';
import { Settings, loadSavedMatch, loadSettings, saveMatch, saveSettings } from './settings';
import { star } from './tileSvg';

type Screen = 'menu' | 'options' | 'howto' | 'online' | 'lobby' | 'game' | 'profile';
const ME = 0; // in every view you sit at seat 0
const DELAYS = { slow: 1300, normal: 800, fast: 350 };

/** Automated tests play tab-to-tab (BroadcastChannel) instead of over the internet. */
function tabsOnly(): boolean {
  try {
    return localStorage.getItem('capicu.net') === 'tabs';
  } catch {
    return false;
  }
}

interface Bubble { text: string; big?: boolean }

/** Text from other players goes into innerHTML: escape it. */
const esc = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const CHAT_LINES = 8;

export class App {
  private settings: Settings = loadSettings();
  private screen: Screen = 'menu';
  private session: Session | null = null;
  private unsubscribe: (() => void) | null = null;
  private selected: Tile | null = null;
  private bubbles: (Bubble | null)[] = [null, null, null, null];
  private animateOverlay = false;
  /** The hand result card waits a moment so the "¡Dominó!" call can be seen. */
  private resultHoldUntil = 0;
  /** You were shot online but the match goes on: you may keep watching. */
  private watching = false;
  private notice: string | null = null;
  private steamName: string | null = null;
  private steam: SteamBridge | null = null;
  private generation = 0;
  /** Hands played so far in the match on screen; a drop means a new match started (online). */
  private historyLength = 0;
  private readonly scene: TableScene;
  private readonly ui: HTMLElement;
  private readonly chatBox: HTMLElement;
  private readonly chatLog: HTMLElement;
  private readonly chatInput: HTMLInputElement;
  private chatLines: { name: string; text: string; mine: boolean }[] = [];
  private offChat: (() => void) | null = null;
  private profile: Profile | null = savedProfile();
  private leaders: LeaderRow[] | 'error' | null = null;
  private profileNotice: { text: string; ok: boolean } | null = null;
  /** Identifies the match on screen, so its result is counted once. */
  private matchId = newMatchId();
  private reportedMatch: string | null = null;

  constructor(root: HTMLElement) {
    setLang(this.settings.lang);
    setVolume(this.settings.volume);
    // The chat lives outside .ui, which is redrawn on every change: typing must survive redraws.
    root.innerHTML = `<canvas class="gl"></canvas><div class="ui"></div>
      <aside class="chat" hidden><ul class="chat-log" aria-live="polite"></ul>
        <form id="chat-form" class="chat-form"><input id="chat-input" maxlength="160" autocomplete="off"></form></aside>`;
    this.ui = root.querySelector('.ui')!;
    this.chatBox = root.querySelector('.chat')!;
    this.chatLog = root.querySelector('.chat-log')!;
    this.chatInput = root.querySelector('#chat-input')!;
    this.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.chatInput.blur(); });
    this.scene = new TableScene(root.querySelector('canvas')!);
    this.scene.onPick = (p) => (p.kind === 'tile' ? this.tryTile(p.tile) : this.chooseSide(p.side));
    this.scene.onFrame = () => this.positionTags();
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('submit', (e) => this.onSubmit(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
    (window as unknown as { __domino: unknown }).__domino = { state: () => this.debugState() };
    void this.initSteam();
    void refreshProfile().then((p) => { this.profile = p; this.render(); }).catch(() => { /* keep the saved one */ });
    this.render();
  }

  // ---------- sessions ----------

  private config(): TableConfig {
    const s = this.settings;
    return {
      rules: (mode: Mode): Rules => ({ mode, targetScore: s.targetScore, capicuBonus: s.capicuBonus ? 100 : 0, countAllHands: s.countAllHands }),
      difficulty: s.difficulty,
      aiDelayMs: DELAYS[s.speed],
    };
  }

  private savedMatch(): MatchState | null {
    const saved = loadSavedMatch<MatchState>();
    if (!saved?.hand?.seated || !saved.pendingShooters) return null;
    const over = saved.winnerTeam !== null || saved.winnerPlayer !== null || (saved.rules.mode === 'ruleta' && !saved.alive[0]);
    return over ? null : saved;
  }

  private use(session: Session): void {
    this.leaveSession(false);
    this.session = session;
    this.generation++;
    this.selected = null;
    this.bubbles = [null, null, null, null];
    this.watching = false;
    this.resultHoldUntil = 0;
    this.historyLength = 0;
    this.matchId = newMatchId();
    this.chatLines = [];
    this.scene.resetMatch();
    this.unsubscribe = session.subscribe((events) => this.onEvents(events));
    this.offChat = session.onChat((line) => this.onChatLine(line));
  }

  private leaveSession(render = true): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.offChat?.();
    this.offChat = null;
    this.chatInput.blur();
    this.session?.leave();
    this.session = null;
    this.generation++;
    if (render) {
      this.screen = 'menu';
      this.scene.setMode('menu');
      this.render();
    }
  }

  private playOffline(mode: Mode, resume = false): void {
    const saved = resume ? this.savedMatch() ?? undefined : undefined;
    this.use(new LocalSession(this.config(), saved?.rules.mode ?? mode, saved, saveMatch));
    this.enterGame();
  }

  private enterGame(): void {
    this.screen = 'game';
    this.scene.setMode('game');
    coqui();
    const v = this.view();
    if (v?.status?.kind === 'opens') this.say(v.status.seat, `${this.nameOf(v.status.seat)} ${t().opens}`);
    this.render();
  }

  private async initSteam(): Promise<void> {
    const steam = platform.steam;
    if (!steam) return;
    try {
      const info = await steam.info();
      if (!info.available) return;
      this.steam = steam;
      this.steamName = info.name ?? null;
      steam.onJoinRequested((lobbyId) => void this.joinSteam(lobbyId));
      const pending = await steam.takePendingJoin();
      if (pending) await this.joinSteam(pending);
      else this.render();
    } catch (err) {
      console.warn('Steam unavailable', err);
    }
  }

  private myName(): string {
    return this.profile?.name ?? this.steamName ?? `${t().guest} ${Math.floor(Math.random() * 90 + 10)}`;
  }

  private async hostOnline(viaSteam: boolean): Promise<void> {
    this.notice = t().connecting;
    this.render();
    try {
      const transport: Transport & { code?: string } = viaSteam && this.steam
        ? await hostOnSteam(this.steam)
        : tabsOnly() ? hostInTabs() : await hostOnInternet();
      this.use(new HostSession(this.config(), transport, this.myName()));
      this.notice = null;
      this.screen = 'lobby';
      this.scene.setMode('menu');
      this.render();
    } catch (err) {
      console.error(err);
      this.notice = t().couldNotConnect;
      this.render();
    }
  }

  private async joinByCode(code: string): Promise<void> {
    if (tabsOnly()) return this.joinWith(joinInTabs(code));
    this.notice = t().connecting;
    this.render();
    try {
      this.joinWith(await joinOnInternet(code));
    } catch (err) {
      console.error(err);
      const reason = err instanceof NetError ? err.reason : null;
      this.notice = reason === 'notFound' ? t().tableNotFound : reason === 'blocked' ? t().tableBlocked : t().couldNotConnect;
      this.render();
    }
  }

  private async joinSteam(lobbyId: string): Promise<void> {
    if (!this.steam) return;
    this.notice = t().connecting;
    this.screen = 'online';
    this.render();
    try {
      this.joinWith(await joinOnSteam(this.steam, lobbyId));
    } catch (err) {
      console.error(err);
      this.notice = t().couldNotConnect;
      this.render();
    }
  }

  private joinWith(transport: Transport): void {
    this.use(new GuestSession(transport, this.myName()));
    this.notice = null;
    this.screen = 'lobby';
    this.render();
  }

  // ---------- reacting to the table ----------

  private view(): View | null {
    return this.session?.view() ?? null;
  }

  private get ruleta(): boolean {
    return this.view()?.match.rules.mode === 'ruleta';
  }

  private nameOf(viewSeat: number): string {
    const s = t();
    if (viewSeat === ME) return s.you;
    const v = this.view();
    const info = v?.seats[viewSeat];
    if (info?.kind === 'human' && info.name) return esc(info.name);
    const engineSeat = v ? toEngine(viewSeat, v.me) : viewSeat;
    return s.lookNames[SEAT_LOOKS[engineSeat]];
  }

  private onEvents(events: TableEvent[]): void {
    const s = t();
    if (this.session instanceof GuestSession && this.session.ended) {
      const reason = this.session.ended;
      this.notice = reason === 'full' ? s.tableFull : reason === 'noAnswer' ? s.tableNoAnswer : s.hostLeft;
      this.leaveSession(false);
      this.screen = 'online';
      this.scene.setMode('menu');
      this.render();
      return;
    }
    const v = this.view();
    if (v && this.screen === 'lobby') this.enterGame();
    if (v) {
      if (v.match.history.length < this.historyLength) {
        this.scene.resetMatch();
        this.watching = false;
        this.matchId = newMatchId();
      }
      this.historyLength = v.match.history.length;
    }
    for (const e of events) {
      switch (e.kind) {
        case 'played':
          clack(false);
          this.selected = null;
          break;
        case 'passed':
          this.say(e.seat, s.pass);
          break;
        case 'handEnded': {
          const r = e.result;
          clack(true);
          this.bubbles = [null, null, null, null];
          if (r.reason === 'domino') this.say(r.winnerPlayer!, r.capicu ? s.capicu : s.domino, true);
          else if (r.winnerPlayer !== null) this.say(r.winnerPlayer, s.tranque, true);
          const won = r.winnerPlayer !== null && (this.ruleta ? r.winnerPlayer === ME : r.winnerTeam === teamOf(ME));
          if (won) {
            platform.unlockAchievement(ACHIEVEMENTS.firstHand);
            if (r.capicu) platform.unlockAchievement(ACHIEVEMENTS.capicu);
            if (r.reason === 'tranque') platform.unlockAchievement(ACHIEVEMENTS.tranque);
          }
          if (!this.ruleta) fanfare(won);
          this.resultHoldUntil = Date.now() + 1400;
          this.later(1450, () => { this.animateOverlay = true; this.render(); });
          break;
        }
        case 'pull':
          spin();
          void this.scene.roulette(e.seat, e.fired, () => bang()).then(() => {
            if (!e.fired) dryClick();
            if (e.fired && e.seat === ME) {
              this.animateOverlay = true;
              fanfare(false);
              this.render();
            }
          });
          break;
        case 'matchEnded': {
          const m = v?.match;
          if (!m) break;
          const won = m.rules.mode === 'ruleta' ? m.winnerPlayer === ME : m.winnerTeam === teamOf(ME);
          if (won) {
            platform.unlockAchievement(ACHIEVEMENTS.firstMatch);
            if (m.pollona) platform.unlockAchievement(ACHIEVEMENTS.pollona);
            if (this.settings.difficulty === 'hard' && this.session?.kind === 'local') platform.unlockAchievement(ACHIEVEMENTS.hardWin);
          }
          if (m.rules.mode === 'ruleta') fanfare(won);
          this.animateOverlay = true;
          break;
        }
      }
    }
    if (v?.status?.kind === 'opens' && v.match.hand.placements.length === 0 && !this.bubbles[v.status.seat]) {
      this.say(v.status.seat, `${this.nameOf(v.status.seat)} ${s.opens}`);
    }
    if (v) this.countMatch(v);
    this.render();
  }

  /** Add the match to your points once it's over for you: it ended, or the revolver took you out. */
  private countMatch(v: View): void {
    const m = v.match;
    const over = v.phase.name === 'matchOver' || (m.rules.mode === 'ruleta' && !m.alive[ME]);
    if (!over || !this.profile || this.reportedMatch === this.matchId) return;
    this.reportedMatch = this.matchId;
    void reportResult({ matchId: this.matchId, ...matchPoints(m) })
      .then(() => { this.profile = savedProfile(); })
      .catch(() => { /* queued: sent next time */ });
  }

  // ---------- chat ----------

  private onChatLine(line: ChatLine): void {
    const me = this.session?.me ?? 0;
    const seat = toView(line.seat, me);
    const name = seat === ME ? t().you : line.name ? esc(line.name) : this.nameOf(seat);
    this.chatLines = [...this.chatLines, { name, text: esc(line.text), mine: seat === ME }].slice(-CHAT_LINES);
    if (this.screen === 'game') this.say(seat, esc(line.text), false, 4500);
    this.render();
  }

  private renderChat(): void {
    const open = !!this.session?.canChat && (this.screen === 'lobby' || this.screen === 'game');
    this.chatBox.hidden = !open;
    if (!open) return;
    const s = t();
    this.chatInput.placeholder = `${s.chatPlaceholder} · ${s.chatHint}`;
    this.chatLog.innerHTML = this.chatLines
      .map((l) => `<li class="${l.mine ? 'mine' : ''}"><b>${l.name}</b> ${l.text}</li>`).join('');
  }

  // ---------- profile ----------

  private openProfile(): void {
    this.screen = 'profile';
    this.profileNotice = null;
    this.leaders = null;
    this.render();
    void leaderboard().then((rows) => { this.leaders = rows; }, () => { this.leaders = 'error'; }).then(() => this.render());
    void refreshProfile().then((p) => { this.profile = p; this.render(); }).catch(() => {});
  }

  /** Run a name/code change against the server and say how it went. */
  private async profileAction(action: () => Promise<Profile>, okText: string): Promise<void> {
    const s = t();
    try {
      this.profile = await action();
      this.profileNotice = { text: okText, ok: true };
      this.ui.querySelectorAll<HTMLInputElement>('input[type=password]').forEach((el) => { el.value = ''; });
      void leaderboard().then((rows) => { this.leaders = rows; this.render(); }, () => {});
    } catch (err) {
      const reason = err instanceof ProfileFailure ? err.reason : 'offline';
      const messages: Partial<Record<string, string>> = {
        taken: s.nameTaken, invalid: s.nameInvalid, reserved: s.nameReserved, noServer: s.serverMissing,
        invalidPin: s.pinInvalid, wrongPin: s.pinWrong, unknownName: s.pinWrong, locked: s.pinLocked,
      };
      this.profileNotice = { text: messages[reason] ?? s.serverOffline, ok: false };
    }
    if (this.screen === 'profile') this.render();
  }

  private later(ms: number, fn: () => void): void {
    const gen = this.generation;
    window.setTimeout(() => { if (gen === this.generation) fn(); }, ms);
  }

  private say(seat: number, text: string, big = false, ms = 1900): void {
    const bubble = { text, big };
    this.bubbles[seat] = bubble;
    this.later(ms, () => {
      if (this.bubbles[seat] === bubble) {
        this.bubbles[seat] = null;
        this.render();
      }
    });
  }

  // ---------- input ----------

  private humanMovesFor(tile: Tile): Move[] {
    const v = this.view();
    if (!v || v.phase.name !== 'playing') return [];
    const h = v.match.hand;
    if (h.current !== ME || h.result) return [];
    return legalMoves(h).filter((m) => sameTile(m.tile, tile));
  }

  private tryTile(tile: Tile): void {
    const moves = this.humanMovesFor(tile);
    if (moves.length === 0) return;
    const h = this.view()!.match.hand;
    if (moves.length === 1) return this.play(moves[0]);
    if (h.leftEnd === h.rightEnd) {
      // Same number on both ends: grow the shorter arm so the board stays balanced.
      const lefts = h.placements.filter((p) => p.side === 'left').length;
      const rights = h.placements.filter((p) => p.side === 'right').length;
      return this.play({ tile, side: lefts < rights ? 'left' : 'right' });
    }
    this.selected = this.selected && sameTile(this.selected, tile) ? null : tile;
    this.render();
  }

  private chooseSide(side: Side): void {
    if (this.selected && this.humanMovesFor(this.selected).some((m) => m.side === side)) {
      this.play({ tile: this.selected, side });
    }
  }

  private play(move: Move): void {
    this.selected = null;
    this.session?.send({ kind: 'move', move });
  }

  private continueAfterHand(): void {
    if (this.view()?.isController) this.session?.send({ kind: 'continue' });
  }

  private onClick(e: Event): void {
    const el = (e.target as Element).closest<HTMLElement>('[data-action]');
    if (!el) return;
    const { action, value } = el.dataset;
    switch (action) {
      case 'play': this.playOffline(value as Mode); break;
      case 'continue': this.playOffline('ruleta', true); break;
      case 'options': this.screen = 'options'; this.render(); break;
      case 'howto': this.screen = 'howto'; this.render(); break;
      case 'online': this.notice = null; this.screen = 'online'; this.render(); break;
      case 'host-steam': void this.hostOnline(true); break;
      case 'host-tabs': void this.hostOnline(false); break;
      case 'invite': (this.session as HostSession | null)?.invite(); break;
      case 'lobby-mode': (this.session as HostSession).setMode(value as Mode); this.render(); break;
      case 'start': (this.session as HostSession).start(); break;
      case 'seat-swap': (this.session as HostSession).swapSeats(Number(el.dataset.a), Number(el.dataset.b)); break;
      case 'profile': this.openProfile(); break;
      case 'sign-out':
        signOut();
        this.profile = null;
        this.profileNotice = { text: t().signOutNote, ok: true };
        this.render();
        break;
      case 'menu': this.goMenu(); break;
      case 'quit': platform.quit(); break;
      case 'fullscreen': platform.toggleFullscreen(); break;
      case 'side': this.chooseSide(value as Side); break;
      case 'next-hand': this.continueAfterHand(); break;
      case 'trigger': this.session?.send({ kind: 'trigger' }); break;
      case 'watch': this.watching = true; this.render(); break;
      case 'new-match':
        this.watching = false;
        this.scene.resetMatch();
        this.session?.newMatch(this.view()?.match.rules.mode);
        break;
      case 'set': this.updateSetting(el.dataset.key as keyof Settings, value!); break;
    }
  }

  private onSubmit(e: Event): void {
    const form = e.target as HTMLFormElement;
    if (form.id === 'chat-form') {
      e.preventDefault();
      this.session?.chat(this.chatInput.value);
      this.chatInput.value = '';
      return;
    }
    const field = (id: string) => (form.querySelector(`#${id}`) as HTMLInputElement).value;
    const s = t();
    if (form.id === 'create-form') {
      e.preventDefault();
      void this.profileAction(() => createName(field('name-input'), field('pin-input')), s.nameSaved);
      return;
    }
    if (form.id === 'signin-form') {
      e.preventDefault();
      void this.profileAction(() => signIn(field('login-name'), field('login-pin')), s.welcomeBack);
      return;
    }
    if (form.id === 'name-form') {
      e.preventDefault();
      void this.profileAction(() => updateProfile({ name: field('name-input') }), s.nameSaved);
      return;
    }
    if (form.id === 'pin-form') {
      e.preventDefault();
      void this.profileAction(() => updateProfile({ pin: field('pin-new') }), s.pinSaved);
      return;
    }
    if (form.id !== 'join-form') return;
    e.preventDefault();
    const code = (form.querySelector('#join-code') as HTMLInputElement).value.trim();
    if (code.length >= 4) void this.joinByCode(code);
  }

  /** Leaving a local match keeps it saved; leaving an online table closes the connection. */
  private goMenu(): void {
    if (this.session && this.session.kind !== 'local') {
      this.leaveSession();
      return;
    }
    this.leaveSession(false);
    this.screen = 'menu';
    this.scene.setMode('menu');
    this.render();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'F11') { e.preventDefault(); platform.toggleFullscreen(); return; }
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if ((e.key === 't' || e.key === 'T' || e.key === '/') && !this.chatBox.hidden) {
      e.preventDefault();
      this.chatInput.focus();
      return;
    }
    if (this.screen !== 'game') {
      if (e.key === 'Escape' && this.screen !== 'menu') this.goMenu();
      return;
    }
    if (e.key === 'Escape') { this.goMenu(); return; }
    const v = this.view();
    if (!v) return;
    if (v.phase.name === 'roulette' && v.phase.awaitingTrigger && v.phase.shooter === ME && (e.key === 'Enter' || e.key === ' ')) {
      this.session?.send({ kind: 'trigger' });
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (v.phase.name === 'handOver') this.continueAfterHand();
      else if (v.phase.name === 'matchOver' && v.isController) this.session?.newMatch(v.match.rules.mode);
      return;
    }
    const n = Number(e.key);
    const hand = v.match.hand.hands[ME];
    if (n >= 1 && n <= hand.length) this.tryTile(hand[n - 1]);
    if (this.selected && e.key === 'ArrowLeft') this.chooseSide('left');
    if (this.selected && e.key === 'ArrowRight') this.chooseSide('right');
  }

  private updateSetting(key: keyof Settings, raw: string): void {
    const s = this.settings as unknown as Record<string, unknown>;
    const current = s[key];
    s[key] = typeof current === 'number' ? Number(raw) : typeof current === 'boolean' ? raw === 'true' : raw;
    saveSettings(this.settings);
    setLang(this.settings.lang);
    setVolume(this.settings.volume);
    if (key === 'volume') clack();
    this.render();
  }

  /** Read-only snapshot for automated tests. */
  private debugState() {
    const v = this.view();
    const h = v?.match.hand;
    const lobby = this.session?.lobby();
    return {
      screen: this.screen, session: this.session?.kind ?? null, overlay: this.overlayKind(), mode: v?.match.rules.mode,
      phase: v?.phase.name ?? null, current: h?.current, finished: !!h?.result,
      roulette: v?.phase.name === 'roulette',
      awaitingTrigger: v?.phase.name === 'roulette' && v.phase.awaitingTrigger && v.phase.shooter === ME,
      alive: v?.match.alive, isController: v?.isController ?? false,
      hand: h?.hands[ME].map((x) => x.join('-')) ?? [],
      playable: h && v?.phase.name === 'playing' && h.current === ME && !h.result
        ? legalMoves(h).map((m) => `${m.tile.join('-')}:${m.side}`) : [],
      selected: this.selected?.join('-') ?? null,
      lobby: lobby ? { code: lobby.code, me: lobby.me, seats: lobby.seats.map((s) => s.kind), names: lobby.seats.map((s) => s.name) } : null,
      notice: this.notice,
      chat: this.chatLines.map((l) => `${l.name}: ${l.text}`),
      profile: this.profile?.name ?? null,
    };
  }

  // ---------- rendering ----------

  private overlayKind(): 'hand' | 'match' | 'dead' | null {
    const v = this.view();
    if (!v) return null;
    const m = v.match;
    if (m.rules.mode === 'ruleta' && !m.alive[ME] && !this.watching && v.phase.name !== 'roulette') return 'dead';
    if (v.phase.name === 'matchOver') return m.rules.mode === 'ruleta' && !m.alive[ME] ? 'dead' : 'match';
    if (v.phase.name === 'handOver' && Date.now() >= this.resultHoldUntil) return 'hand';
    return null;
  }

  private render(): void {
    document.documentElement.lang = this.settings.lang;
    const views: Record<Screen, () => string> = {
      menu: () => this.menuView(), options: () => this.optionsView(), howto: () => this.howToView(),
      online: () => this.onlineView(), lobby: () => this.lobbyView(), game: () => this.gameView(),
      profile: () => this.profileView(),
    };
    // Redrawing replaces every element: keep what's being typed, and where.
    const typing = this.ui.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement
      ? document.activeElement : null;
    const drafts = [...this.ui.querySelectorAll<HTMLInputElement>('input[id]')].map((el) => [el.id, el.value] as const);
    this.ui.innerHTML = views[this.screen]();
    for (const [id, value] of drafts) {
      const el = this.ui.querySelector<HTMLInputElement>(`#${id}`);
      if (el) el.value = value;
    }
    if (typing) {
      const el = this.ui.querySelector<HTMLInputElement>(`#${typing.id}`);
      el?.focus();
      el?.setSelectionRange(typing.selectionStart, typing.selectionEnd);
    }
    this.ui.className = `ui ui-${this.screen}`;
    this.animateOverlay = false;
    this.renderChat();
    const v = this.view();
    if (this.screen === 'game' && v) {
      const h = v.match.hand;
      const myTurn = v.phase.name === 'playing' && h.current === ME && !h.result;
      this.scene.setCast([0, 1, 2, 3].map((p) => (p === ME ? null : SEAT_LOOKS[toEngine(p, v.me)])));
      this.scene.sync({
        hand: h,
        alive: v.match.rules.mode === 'ruleta' ? v.match.alive : [true, true, true, true],
        ruleta: v.match.rules.mode === 'ruleta',
        reveal: h.result !== null,
        playable: myTurn ? legalMoves(h).map((m) => m.tile) : [],
        selected: this.selected,
        targets: this.selected ? this.humanMovesFor(this.selected).map((m) => m.side) : [],
      });
      this.positionTags();
    }
  }

  private positionTags(): void {
    if (this.screen !== 'game') return;
    this.ui.querySelectorAll<HTMLElement>('.tag[data-seat]').forEach((el) => {
      const pos = this.scene.headScreenPos(Number(el.dataset.seat));
      if (pos) el.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%)`;
    });
  }

  private flag(): string {
    const stripes = [0, 1, 2, 3, 4].map((i) => `<rect x="0" y="${i * 12}" width="100" height="12" fill="${i % 2 ? '#fff' : 'var(--pr-red)'}"/>`).join('');
    return `<svg class="flag" viewBox="0 0 100 60" aria-hidden="true">${stripes}
      <path d="M0 0 L52 30 L0 60 Z" fill="var(--pr-blue)"/><path d="${star(17, 30, 11)}" fill="#fff"/></svg>`;
  }

  private menuView(): string {
    const s = t();
    const canContinue = this.savedMatch() !== null;
    const who = this.profile
      ? `👤 ${esc(this.profile.name)} · <b>${this.profile.points}</b> ${s.pointsLabel.toLowerCase()}`
      : `👤 ${s.chooseName}`;
    return `<main class="screen menu">
      <button class="btn small name-chip" data-action="profile">${who}</button>
      ${this.flag()}
      <h1 class="logo">${s.title}</h1>
      <p class="tagline">${s.tagline}</p>
      <nav class="menu-buttons">
        ${canContinue ? `<button class="btn" data-action="continue">${s.continue}</button>` : ''}
        <button class="btn primary mode" data-action="play" data-value="ruleta">
          <span class="mode-title">${s.ruleta}</span><span class="mode-desc">${s.ruletaDesc}</span></button>
        <button class="btn mode" data-action="play" data-value="parejas">
          <span class="mode-title">${s.parejas}</span><span class="mode-desc">${s.parejasDesc}</span></button>
        <button class="btn mode online" data-action="online">
          <span class="mode-title">${s.online}</span><span class="mode-desc">${s.onlineDesc}</span></button>
        <div class="row">
          <button class="btn small" data-action="howto">${s.howTo}</button>
          <button class="btn small" data-action="options">${s.options}</button>
          <button class="btn small" data-action="profile">🏆 ${s.leaderboard}</button>
          ${platform.isDesktop ? `<button class="btn small ghost" data-action="quit">${s.quit}</button>` : ''}
        </div>
      </nav>
    </main>`;
  }

  private onlineView(): string {
    const s = t();
    const steam = this.steam
      ? `<button class="btn primary" data-action="host-steam">${s.createTable}</button><p class="note">${s.steamJoinHint}</p>`
      : platform.isDesktop ? `<p class="note">${s.steamMissing}</p>` : '';
    // Tab-to-tab tables need no Steam: handy for trying online play on one computer.
    const tabs = this.steam ? '' : `<section class="online-box">
        <h3>${s.tabsTitle}</h3><p class="note">${s.tabsDesc}</p>
        <button class="btn" data-action="host-tabs">${s.createTable}</button>
        <form id="join-form" class="join-row">
          <label for="join-code">${s.codeLabel}</label>
          <input id="join-code" maxlength="6" autocomplete="off" spellcheck="false" placeholder="ABCD">
          <button class="btn small" type="submit">${s.join}</button>
        </form>
      </section>`;
    return `<main class="screen panel">
      <h2>${s.online}</h2>
      <p class="note playing-as">${s.playingAs} <b>${esc(this.myNameForDisplay())}</b>
        <button class="btn small ghost" data-action="profile">${this.profile ? s.change : s.chooseName}</button></p>
      ${this.notice ? `<p class="notice">${this.notice}</p>` : ''}
      ${steam}${tabs}
      <button class="btn ghost" data-action="menu">${s.back}</button>
    </main>`;
  }

  private lobbyView(): string {
    const s = t();
    const lobby = this.session?.lobby();
    if (!lobby) {
      return `<main class="screen panel"><h2>${s.lobbyTitle}</h2><p class="notice">${this.notice ?? s.connecting}</p>
        <button class="btn ghost" data-action="menu">${s.leaveTable}</button></main>`;
    }
    const { hostSeat } = lobby;
    const seats = lobby.seats.map((seat, p) => {
      const look = s.lookNames[SEAT_LOOKS[p]];
      const who = seat.kind === 'human' ? esc(seat.name ?? s.guest) : `${look} · ${s.seatAi}`;
      const tags = [p === lobby.me ? s.seatYou : '', p === hostSeat ? s.seatHost : ''].filter(Boolean).join(', ');
      const team = lobby.mode === 'parejas' ? `team-${teamOf(p)}` : '';
      const move = lobby.isHost
        ? `<span class="seat-move"><button class="seg-btn" data-action="seat-swap" data-a="${p}" data-b="${(p + 3) % 4}" title="${s.moveUp}" aria-label="${s.moveUp}">▲</button>
           <button class="seg-btn" data-action="seat-swap" data-a="${p}" data-b="${(p + 1) % 4}" title="${s.moveDown}" aria-label="${s.moveDown}">▼</button></span>`
        : '';
      return `<li class="seat-row ${seat.kind} ${team}"><span class="seat-num">${s.seatN} ${p + 1}</span><span class="seat-name">${who}</span>${tags ? `<span class="seat-tag">${tags}</span>` : ''}${move}</li>`;
    }).join('');
    const modes = lobby.isHost
      ? `<div class="option-row"><span class="option-label">${s.mode}</span><div class="seg">${(['ruleta', 'parejas'] as Mode[])
        .map((m) => `<button class="seg-btn ${m === lobby.mode ? 'on' : ''}" data-action="lobby-mode" data-value="${m}">${m === 'ruleta' ? s.ruleta : s.parejas}</button>`).join('')}</div></div>`
      : `<p class="note">${s.mode}: ${lobby.mode === 'ruleta' ? s.ruleta : s.parejas}</p>`;
    return `<main class="screen panel lobby">
      <h2>${s.lobbyTitle}</h2>
      ${lobby.code ? `<p class="code">${s.codeLabel}: <b>${lobby.code}</b></p>` : ''}
      ${lobby.code && lobby.isHost ? `<p class="note">${s.keepOpen}</p>` : ''}
      <ul class="seats">${seats}</ul>
      ${lobby.isHost ? `<p class="note">${s.seatHelp}</p>` : ''}
      ${modes}
      <div class="row">
        ${lobby.canInvite ? `<button class="btn" data-action="invite">${s.inviteFriends}</button>` : ''}
        ${lobby.isHost ? `<button class="btn primary" data-action="start">${s.start}</button>` : `<p class="note">${s.waitingStart}</p>`}
      </div>
      <button class="btn ghost" data-action="menu">${s.leaveTable}</button>
    </main>`;
  }

  private myNameForDisplay(): string {
    return this.profile?.name ?? this.steamName ?? t().guest;
  }

  private profileView(): string {
    const s = t();
    const p = this.profile;
    const notice = this.profileNotice
      ? `<p class="notice ${this.profileNotice.ok ? 'ok' : ''}">${this.profileNotice.text}</p>` : '';
    const stats = p
      ? `<ul class="stats"><li><b>${p.points}</b>${s.pointsLabel}</li><li><b>${p.wins}</b>${s.winsLabel}</li>
          <li><b>${p.played}</b>${s.playedLabel}</li><li><b>#${p.rank}</b>${s.rankLabel}</li></ul>` : '';
    const rows = this.leaders === null ? `<p class="note">${s.loading}</p>`
      : this.leaders === 'error' ? `<p class="note">${s.serverOffline}</p>`
      : this.leaders.length === 0 ? `<p class="note">${s.noLeaders}</p>`
      : `<ol class="leaders">${this.leaders.map((r) => `<li class="${p && r.name === p.name ? 'me' : ''}">
          <span class="leader-name">${esc(r.name)}</span><span><b>${r.points}</b> ${s.pointsLabel.toLowerCase()}</span>
          <span class="leader-wins">${r.wins}/${r.played}</span></li>`).join('')}</ol>`;
    const pinField = (id: string, label: string, complete: string) =>
      `<input id="${id}" type="password" minlength="4" maxlength="32" autocomplete="${complete}" placeholder="${label}">`;
    const account = p
      ? `<h2>${s.yourName}</h2>
        <form id="name-form" class="join-row">
          <input id="name-input" maxlength="16" autocomplete="username" spellcheck="false" value="${esc(p.name)}">
          <button class="btn small" type="submit">${s.save}</button>
        </form>
        ${notice}${stats}
        ${p.hasPin ? '' : `<p class="notice">${s.pinMissing}</p>`}
        <form id="pin-form" class="join-row">
          ${pinField('pin-new', s.newPin, 'new-password')}
          <button class="btn small" type="submit">${p.hasPin ? s.changePin : s.setPin}</button>
          <button class="btn small ghost" type="button" data-action="sign-out">${s.signOut}</button>
        </form>`
      : `<h2>${s.chooseName}</h2>
        <form id="create-form" class="join-row">
          <input id="name-input" maxlength="16" autocomplete="username" spellcheck="false" value="${esc(this.steamName ?? '')}" placeholder="${s.yourName}">
          ${pinField('pin-input', s.pinLabel, 'new-password')}
          <button class="btn small primary" type="submit">${s.createName}</button>
        </form>
        <p class="note">${s.nameHint} ${s.pinHint}</p>
        ${notice}
        <h3>${s.haveName}</h3>
        <form id="signin-form" class="join-row">
          <input id="login-name" maxlength="16" autocomplete="username" spellcheck="false" placeholder="${s.yourName}">
          ${pinField('login-pin', s.pinLabel, 'current-password')}
          <button class="btn small" type="submit">${s.signIn}</button>
        </form>`;
    return `<main class="screen panel profile">
      ${account}
      <h3>🏆 ${s.leaderboard}</h3>
      ${rows}
      <p class="note">${s.pointsNote}</p>
      <button class="btn" data-action="menu">${s.back}</button>
    </main>`;
  }

  private optionRow(label: string, key: keyof Settings, options: [string, string][]): string {
    const value = String(this.settings[key]);
    return `<div class="option-row"><span class="option-label">${label}</span><div class="seg">${options
      .map(([v, l]) => `<button class="seg-btn ${v === value ? 'on' : ''}" data-action="set" data-key="${key}" data-value="${v}">${l}</button>`)
      .join('')}</div></div>`;
  }

  private optionsView(): string {
    const s = t();
    const yesNo: [string, string][] = [['true', s.on], ['false', s.off]];
    return `<main class="screen panel">
      <h2>${s.options}</h2>
      ${this.optionRow(s.language, 'lang', [['es', 'Español'], ['en', 'English']])}
      ${this.optionRow(s.difficulty, 'difficulty', [['easy', s.easy], ['normal', s.normal], ['hard', s.hard]])}
      ${this.optionRow(s.target, 'targetScore', [['200', '200'], ['300', '300'], ['500', '500']])}
      ${this.optionRow(s.capicuBonus, 'capicuBonus', yesNo)}
      ${this.optionRow(s.countAll, 'countAllHands', yesNo)}
      ${this.optionRow(s.speed, 'speed', [['slow', s.slow], ['normal', s.normal], ['fast', s.fast]])}
      ${this.optionRow(s.sound, 'volume', [['0', s.off], ['0.4', '◐'], ['0.7', '●']])}
      <div class="option-row"><span class="option-label">${s.fullscreen}</span><div class="seg"><button class="seg-btn" data-action="fullscreen">F11</button></div></div>
      <button class="btn" data-action="menu">${s.back}</button>
    </main>`;
  }

  private howToView(): string {
    const s = t();
    return `<main class="screen panel">
      <h2>${s.howTo}</h2>
      <ol class="rules">${s.rulesText.map((r) => `<li>${r}</li>`).join('')}</ol>
      <p class="rules"><b>${s.ruleta}:</b> ${s.ruletaDesc} (${CHAMBERS} ${s.chambers.toLowerCase()}, 1 🔫)</p>
      <p class="note">1–7 · ← → · Enter · Esc · F11</p>
      <button class="btn" data-action="menu">${s.back}</button>
    </main>`;
  }

  private chambers(p: number): string {
    const r = this.view()!.match.revolvers[p];
    const dots = Array.from({ length: CHAMBERS }, (_, i) => `<i class="${i < r.pulls ? 'used' : ''}"></i>`).join('');
    return `<span class="chambers" title="${t().chambers}">${dots}</span>`;
  }

  private statusText(v: View): string | null {
    const s = t();
    const st = v.status;
    if (!st || st.kind === 'opens') return null;
    if (st.kind === 'mustShoot') return st.seat === ME ? s.youMustShoot : `${s.mustShoot} ${this.nameOf(st.seat)}`;
    return `${this.nameOf(st.seat)}: ${st.kind === 'out' ? s.isOut : s.emptyChamber}`;
  }

  private gameView(): string {
    const v = this.view();
    const s = t();
    if (!v) return `<main class="screen panel"><p class="notice">${s.connecting}</p></main>`;
    const m = v.match;
    const h = m.hand;
    const ruleta = m.rules.mode === 'ruleta';
    const reveal = h.result !== null;
    const tags = [1, 2, 3].map((p) => {
      const out = ruleta && !m.alive[p];
      const active = !h.result && h.current === p && !out && v.phase.name === 'playing';
      const bubble = this.bubbles[p];
      const human = v.seats[p].kind === 'human';
      return `<div class="tag ${active ? 'active' : ''} ${out ? 'out' : ''} ${ruleta ? 'solo' : `team-${teamOf(p)}`} ${human ? 'human' : ''}" data-seat="${p}">
        ${bubble ? `<div class="bubble ${bubble.big ? 'big' : ''}">${bubble.text}</div>` : ''}
        <div class="nameplate"><span class="name">${out ? '✝ ' : ''}${this.nameOf(p)}</span>
          ${active ? '<span class="dots"><i></i><i></i><i></i></span>' : ''}
          ${reveal && !out ? `<span class="count">${handPips(h.hands[p])}</span>` : ''}
          ${ruleta && !out ? this.chambers(p) : ''}</div>
      </div>`;
    }).join('');

    const myTurn = v.phase.name === 'playing' && h.current === ME && !h.result;
    const myBubble = this.bubbles[ME];
    const score = ruleta
      ? `<div class="score"><span class="vs">${s.ruleta} · ${s.hand} ${m.handNumber}</span></div>`
      : `<div class="score"><span class="team team-0">${s.us} <b>${m.scores[0]}</b></span>
          <span class="vs">${s.hand} ${m.handNumber} · ${s.to} ${m.rules.targetScore}</span>
          <span class="team team-1">${s.them} <b>${m.scores[1]}</b></span></div>`;
    const sideButtons = this.selected
      ? `<div class="sides"><span>${s.chooseSide}</span>${this.humanMovesFor(this.selected).map((mv) =>
        `<button class="btn small" data-action="side" data-value="${mv.side}">${mv.side === 'left' ? '◀ ' + s.leftEnd : s.rightEnd + ' ▶'}</button>`).join('')}</div>`
      : '';
    const gun = m.revolvers[ME];
    const trigger = v.phase.name === 'roulette' && v.phase.awaitingTrigger && v.phase.shooter === ME
      ? `<div class="trigger-panel"><p class="odds">${s.odds}: <b>1 / ${CHAMBERS - gun.pulls}</b> (${Math.round(fireChance(gun) * 100)}%)</p>
         <button class="btn primary trigger" data-action="trigger">${s.pullTrigger}</button></div>`
      : '';
    const status = this.statusText(v);
    return `<main class="screen game">
      <header class="hud">
        <button class="btn small ghost" data-action="menu">☰ ${s.menu}</button>
        ${score}
        <div class="flag-mini">${this.flag()}</div>
      </header>
      ${tags}
      <footer class="me ${myTurn ? 'active' : ''}">
        ${myBubble ? `<div class="bubble ${myBubble.big ? 'big' : ''}">${myBubble.text}</div>` : ''}
        ${myTurn && !this.selected ? `<p class="hint">${s.clickTiles}</p>` : ''}
        ${this.watching && ruleta && !m.alive[ME] ? `<p class="hint">${s.youAreOut}</p>` : ''}
        ${sideButtons}
        <div class="nameplate"><span class="name">${s.you}</span>
          ${myTurn ? `<span class="your-turn">${s.yourTurn}</span>` : ''}
          ${reveal ? `<span class="count">${handPips(h.hands[ME])}</span>` : ''}
          ${ruleta && m.alive[ME] ? this.chambers(ME) : ''}</div>
      </footer>
      ${status ? `<div class="status">${status}</div>` : ''}
      ${trigger}
      ${this.overlayView(v)}
    </main>`;
  }

  private overlayView(v: View): string {
    const kind = this.overlayKind();
    if (!kind) return '';
    const m = v.match;
    const s = t();
    const ruleta = m.rules.mode === 'ruleta';
    const enter = this.animateOverlay ? 'enter' : '';
    const waiting = `<p class="note">${s.waitingHost}</p>`;
    const newMatch = v.isController ? `<button class="btn primary" data-action="new-match">${s.newMatch}</button>` : '';
    if (kind === 'dead') {
      const goesOn = v.phase.name !== 'matchOver';
      return `<div class="overlay dead ${enter}"><div class="card lose">
        <h2 class="you-died">${s.youDied}</h2>
        <div class="row">${goesOn ? `<button class="btn primary" data-action="watch">${s.watch}</button>` : newMatch || waiting}
        <button class="btn" data-action="menu">${s.menu}</button></div></div></div>`;
    }
    if (kind === 'match') {
      const won = ruleta ? m.winnerPlayer === ME : m.winnerTeam === teamOf(ME);
      const headline = ruleta ? (won ? s.youWinRuleta : `${this.nameOf(m.winnerPlayer!)} ${s.winsRuleta}`) : won ? s.weWin : s.theyWin;
      return `<div class="overlay ${enter}"><div class="card ${won ? 'win' : 'lose'}">
        ${this.flag()}
        <h2>${headline}</h2>
        ${!ruleta && m.pollona ? `<p class="pollona">${s.pollona}</p>` : ''}
        ${ruleta ? `<p>${s.lastStanding}</p>` : `<p class="final"><span class="team-0">${s.us} ${m.scores[0]}</span> — <span class="team-1">${s.them} ${m.scores[1]}</span></p>`}
        <div class="row">${newMatch || waiting}
        <button class="btn" data-action="menu">${s.menu}</button></div></div></div>`;
    }
    const r = m.history[m.history.length - 1];
    if (!r) return '';
    const headline = r.reason === 'domino' ? (r.capicu ? s.capicu : s.domino) : s.tranque;
    const who = r.winnerPlayer === null ? s.tiedTranque : `${this.nameOf(r.winnerPlayer)} ${s.wonHand}`;
    const shooters = m.pendingShooters;
    const humanWon = ruleta ? r.winnerPlayer === ME : r.winnerTeam === teamOf(ME);
    const counts = r.pipCounts.map((c, p) => (m.hand.seated[p]
      ? `<li class="${ruleta ? (shooters.includes(p) ? 'shooter' : '') : `team-${teamOf(p)}`}">${this.nameOf(p)}<b>${c}</b></li>` : '')).join('');
    const next = v.isController
      ? `<button class="btn primary" data-action="next-hand">${ruleta && shooters.length ? s.continueBtn : s.nextHand}</button>`
      : waiting;
    return `<div class="overlay ${enter}"><div class="card ${humanWon ? 'win' : r.winnerPlayer === null ? '' : 'lose'}">
      <h2>${headline}</h2><p>${who}</p>
      ${!ruleta && r.winnerTeam !== null ? `<p class="points team-${r.winnerTeam}">+${r.points} ${s.points}</p>` : ''}
      <h3>${s.pipsLeft}</h3><ul class="counts">${counts}</ul>
      ${ruleta
        ? `<p class="must-shoot">${shooters.length ? `${s.mustShoot} <b>${shooters.map((p) => this.nameOf(p)).join(', ')}</b>` : s.nobodyShoots}</p>`
        : `<p class="final"><span class="team-0">${s.us} ${m.scores[0]}</span> — <span class="team-1">${s.them} ${m.scores[1]}</span></p>`}
      ${next}</div></div>`;
  }
}
