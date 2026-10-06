import { chooseMove } from '../engine/ai';
import {
  CHAMBERS, HandResult, MatchState, Mode, Move, Rules, Side, applyMove, fireChance, isMatchOver, legalMoves,
  newMatch, pass, pullTrigger, scoreFinishedHand, startNextHand, teamOf,
} from '../engine/game';
import { Tile, handPips, sameTile } from '../engine/tiles';
import { ACHIEVEMENTS, platform } from '../platform';
import { TableScene } from '../three/scene';
import { bang, clack, coqui, dryClick, fanfare, setVolume, spin } from './audio';
import { setLang, t } from './i18n';
import { Settings, loadSavedMatch, loadSettings, saveMatch, saveSettings } from './settings';
import { star } from './tileSvg';

type Screen = 'menu' | 'options' | 'howto' | 'game';
type Overlay = 'hand' | 'match' | 'dead' | null;
const HUMAN = 0;
const DELAYS = { slow: 1300, normal: 800, fast: 350 };

interface Bubble { text: string; big?: boolean }

export class App {
  private settings: Settings = loadSettings();
  private screen: Screen = 'menu';
  private match: MatchState | null = null;
  private selected: Tile | null = null;
  private bubbles: (Bubble | null)[] = [null, null, null, null];
  private overlay: Overlay = null;
  private animateOverlay = false;
  /** Set while the revolver sequence runs; `waitHuman` resolves when the human pulls the trigger. */
  private roulette: { shooter: number; waitHuman: (() => void) | null } | null = null;
  private status: string | null = null;
  /** Bumped whenever play is abandoned so stale timers do nothing. */
  private generation = 0;
  private readonly scene: TableScene;
  private readonly ui: HTMLElement;

  constructor(root: HTMLElement, private readonly rng: () => number = Math.random) {
    setLang(this.settings.lang);
    setVolume(this.settings.volume);
    root.innerHTML = '<canvas class="gl"></canvas><div class="ui"></div>';
    this.ui = root.querySelector('.ui')!;
    this.scene = new TableScene(root.querySelector('canvas')!);
    this.scene.onPick = (p) => (p.kind === 'tile' ? this.tryTile(p.tile) : this.chooseSide(p.side));
    this.scene.onFrame = () => this.positionTags();
    const saved = loadSavedMatch<MatchState>();
    if (saved && saved.hand?.seated && saved.pendingShooters && !this.isOver(saved)) this.match = saved;
    root.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
    (window as unknown as { __domino: unknown }).__domino = { state: () => this.debugState() };
    this.render();
  }

  // ---------- flow ----------

  private rules(mode: Mode): Rules {
    const s = this.settings;
    return { mode, targetScore: s.targetScore, capicuBonus: s.capicuBonus ? 100 : 0, countAllHands: s.countAllHands };
  }

  private get ruleta(): boolean {
    return this.match?.rules.mode === 'ruleta';
  }

  /** Over for the human: someone won, or the human is dead. */
  private isOver(m: MatchState): boolean {
    return isMatchOver(m) || (m.rules.mode === 'ruleta' && !m.alive[HUMAN]);
  }

  private startMatch(mode: Mode): void {
    this.match = newMatch(this.rng, this.rules(mode));
    this.scene.resetMatch();
    saveMatch(this.match);
    this.enterGame();
    const opener = this.match.hand.current;
    this.say(opener, `${t().names[opener]} ${t().opens}`);
  }

  private enterGame(): void {
    this.generation++;
    this.screen = 'game';
    this.roulette = null;
    this.status = null;
    const m = this.match!;
    this.overlay = m.hand.result ? (this.isOver(m) ? (m.alive[HUMAN] ? 'match' : 'dead') : 'hand') : null;
    this.selected = null;
    this.bubbles = [null, null, null, null];
    this.scene.setMode('game');
    coqui();
    this.render();
    this.schedule(this.delay() * 1.5);
  }

  private toMenu(): void {
    this.generation++;
    this.roulette = null;
    this.screen = 'menu';
    this.scene.setMode('menu');
    this.render();
  }

  private delay(): number {
    return DELAYS[this.settings.speed];
  }

  private schedule(ms: number, fn: () => void = () => this.step()): void {
    const gen = this.generation;
    window.setTimeout(() => { if (gen === this.generation) fn(); }, ms);
  }

  private setHand(next: MatchState['hand']): void {
    this.match = { ...this.match!, hand: next };
    if (next.result) this.finishHand(next.result);
    saveMatch(this.match);
  }

  /** Advance whoever's turn it is. */
  private step(): void {
    const m = this.match;
    if (!m || this.screen !== 'game' || m.hand.result || this.overlay || this.roulette) return;
    const h = m.hand;
    if (h.current === HUMAN && legalMoves(h).length > 0) {
      this.render();
      return;
    }
    const move = h.current === HUMAN ? null : chooseMove(h, m.rules, this.settings.difficulty, this.rng);
    if (move) this.play(move);
    else {
      this.say(h.current, t().pass);
      this.setHand(pass(h));
      this.render();
      this.schedule(this.delay());
    }
  }

  private play(move: Move): void {
    const h = this.match!.hand;
    this.selected = null;
    this.setHand(applyMove(h, move, this.match!.rules));
    clack(this.match!.hand.result !== null);
    this.render();
    if (!this.match!.hand.result) this.schedule(this.delay());
  }

  private finishHand(result: HandResult): void {
    const s = t();
    this.bubbles = [null, null, null, null];
    if (result.reason === 'domino') this.say(result.winnerPlayer!, result.capicu ? s.capicu : s.domino, true);
    else if (result.winnerPlayer !== null) this.say(result.winnerPlayer, s.tranque, true);
    this.match = scoreFinishedHand(this.match!);
    const m = this.match;
    const humanWonHand = result.winnerPlayer !== null
      && (this.ruleta ? result.winnerPlayer === HUMAN : result.winnerTeam === teamOf(HUMAN));
    if (humanWonHand) {
      platform.unlockAchievement(ACHIEVEMENTS.firstHand);
      if (result.capicu) platform.unlockAchievement(ACHIEVEMENTS.capicu);
      if (result.reason === 'tranque') platform.unlockAchievement(ACHIEVEMENTS.tranque);
    }
    if (!this.ruleta && m.winnerTeam !== null) {
      const won = m.winnerTeam === teamOf(HUMAN);
      if (won) {
        platform.unlockAchievement(ACHIEVEMENTS.firstMatch);
        if (m.pollona) platform.unlockAchievement(ACHIEVEMENTS.pollona);
        if (this.settings.difficulty === 'hard') platform.unlockAchievement(ACHIEVEMENTS.hardWin);
      }
      fanfare(won);
    } else if (!this.ruleta) {
      fanfare(humanWonHand);
    }
    this.schedule(1400, () => {
      this.overlay = !this.ruleta && m.winnerTeam !== null ? 'match' : 'hand';
      this.animateOverlay = true;
      this.render();
    });
  }

  /** "Next" on the hand result card: in ruleta, the losers face the revolver first. */
  private continueAfterHand(): void {
    this.overlay = null;
    if (this.ruleta && this.match!.pendingShooters.length > 0) {
      void this.runRoulette();
      return;
    }
    this.nextHand();
  }

  private async runRoulette(): Promise<void> {
    const gen = this.generation;
    const s = t();
    const pause = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
    while (this.match && this.match.pendingShooters.length > 0) {
      const shooter = this.match.pendingShooters[0];
      this.roulette = { shooter, waitHuman: null };
      this.status = shooter === HUMAN ? s.youMustShoot : `${s.mustShoot} ${s.names[shooter]}`;
      this.bubbles = [null, null, null, null];
      if (shooter === HUMAN) {
        await new Promise<void>((resolve) => { this.roulette!.waitHuman = resolve; this.render(); });
      } else {
        this.render();
        await pause(1100);
      }
      if (gen !== this.generation) return;
      this.roulette.waitHuman = null;
      this.status = null;
      const { match, fired } = pullTrigger(this.match, shooter);
      this.render();
      spin();
      await this.scene.roulette(shooter, fired, () => bang());
      if (gen !== this.generation) return;
      this.match = match;
      saveMatch(match);
      if (fired && shooter === HUMAN) {
        this.roulette = null;
        this.overlay = 'dead';
        this.animateOverlay = true;
        fanfare(false);
        this.render();
        return;
      }
      if (!fired) dryClick();
      this.status = `${s.names[shooter]}: ${fired ? s.isOut : s.emptyChamber}`;
      this.render();
      await pause(1500);
      if (gen !== this.generation) return;
    }
    if (!this.match) return;
    this.roulette = null;
    this.status = null;
    if (this.match.winnerPlayer !== null) {
      const won = this.match.winnerPlayer === HUMAN;
      if (won) {
        platform.unlockAchievement(ACHIEVEMENTS.firstMatch);
        if (this.settings.difficulty === 'hard') platform.unlockAchievement(ACHIEVEMENTS.hardWin);
      }
      fanfare(won);
      this.overlay = 'match';
      this.animateOverlay = true;
      this.render();
      return;
    }
    this.nextHand();
  }

  private nextHand(): void {
    this.match = startNextHand(this.match!, this.rng);
    saveMatch(this.match);
    this.overlay = null;
    this.bubbles = [null, null, null, null];
    this.render();
    this.schedule(this.delay());
  }

  private say(seat: number, text: string, big = false): void {
    const bubble = { text, big };
    this.bubbles[seat] = bubble;
    this.schedule(1900, () => {
      if (this.bubbles[seat] === bubble) {
        this.bubbles[seat] = null;
        this.render();
      }
    });
  }

  // ---------- input ----------

  private humanMovesFor(tile: Tile): Move[] {
    const h = this.match?.hand;
    if (!h || h.current !== HUMAN || h.result || this.overlay || this.roulette) return [];
    return legalMoves(h).filter((m) => sameTile(m.tile, tile));
  }

  private tryTile(tile: Tile): void {
    const moves = this.humanMovesFor(tile);
    if (moves.length === 0) return;
    const h = this.match!.hand;
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

  private onClick(e: Event): void {
    const el = (e.target as Element).closest<HTMLElement>('[data-action]');
    if (!el) return;
    const { action, value } = el.dataset;
    switch (action) {
      case 'play': this.startMatch(value as Mode); break;
      case 'continue': this.enterGame(); break;
      case 'options': this.screen = 'options'; this.render(); break;
      case 'howto': this.screen = 'howto'; this.render(); break;
      case 'menu': this.toMenu(); break;
      case 'quit': platform.quit(); break;
      case 'fullscreen': platform.toggleFullscreen(); break;
      case 'side': this.chooseSide(value as Side); break;
      case 'next-hand': this.continueAfterHand(); break;
      case 'trigger': this.roulette?.waitHuman?.(); break;
      case 'new-match': this.startMatch(this.match?.rules.mode ?? 'ruleta'); break;
      case 'set': this.updateSetting(el.dataset.key as keyof Settings, value!); break;
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'F11') { e.preventDefault(); platform.toggleFullscreen(); return; }
    if (this.screen !== 'game') {
      if (e.key === 'Escape' && this.screen !== 'menu') { this.screen = 'menu'; this.render(); }
      return;
    }
    if (e.key === 'Escape') { this.toMenu(); return; }
    if (this.roulette?.waitHuman && (e.key === 'Enter' || e.key === ' ')) { this.roulette.waitHuman(); return; }
    if (this.overlay && (e.key === 'Enter' || e.key === ' ')) {
      if (this.overlay === 'hand') this.continueAfterHand(); else this.startMatch(this.match!.rules.mode);
      return;
    }
    const n = Number(e.key);
    const hand = this.match?.hand.hands[HUMAN];
    if (hand && n >= 1 && n <= hand.length) this.tryTile(hand[n - 1]);
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
    const h = this.match?.hand;
    return {
      screen: this.screen, overlay: this.overlay, mode: this.match?.rules.mode,
      current: h?.current, finished: !!h?.result, roulette: !!this.roulette,
      awaitingTrigger: !!this.roulette?.waitHuman, alive: this.match?.alive,
      hand: h?.hands[HUMAN].map((x) => x.join('-')) ?? [],
      playable: h && h.current === HUMAN && !h.result && !this.overlay && !this.roulette
        ? legalMoves(h).map((m) => `${m.tile.join('-')}:${m.side}`) : [],
      selected: this.selected?.join('-') ?? null,
    };
  }

  // ---------- rendering ----------

  private render(): void {
    document.documentElement.lang = this.settings.lang;
    const view = { menu: () => this.menuView(), options: () => this.optionsView(), howto: () => this.howToView(), game: () => this.gameView() };
    this.ui.innerHTML = view[this.screen]();
    this.ui.className = `ui ui-${this.screen}`;
    this.animateOverlay = false;
    if (this.screen === 'game' && this.match) {
      const h = this.match.hand;
      const myTurn = h.current === HUMAN && !h.result && !this.overlay && !this.roulette;
      this.scene.sync({
        hand: h,
        alive: this.ruleta ? this.match.alive : [true, true, true, true],
        ruleta: this.ruleta,
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
    const canContinue = this.match && !this.isOver(this.match);
    return `<main class="screen menu">
      ${this.flag()}
      <h1 class="logo">${s.title}</h1>
      <p class="tagline">${s.tagline}</p>
      <nav class="menu-buttons">
        ${canContinue ? `<button class="btn" data-action="continue">${s.continue}</button>` : ''}
        <button class="btn primary mode" data-action="play" data-value="ruleta">
          <span class="mode-title">${s.ruleta}</span><span class="mode-desc">${s.ruletaDesc}</span></button>
        <button class="btn mode" data-action="play" data-value="parejas">
          <span class="mode-title">${s.parejas}</span><span class="mode-desc">${s.parejasDesc}</span></button>
        <div class="row">
          <button class="btn small" data-action="howto">${s.howTo}</button>
          <button class="btn small" data-action="options">${s.options}</button>
          ${platform.isDesktop ? `<button class="btn small ghost" data-action="quit">${s.quit}</button>` : ''}
        </div>
      </nav>
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
    const r = this.match!.revolvers[p];
    const dots = Array.from({ length: CHAMBERS }, (_, i) => `<i class="${i < r.pulls ? 'used' : ''}"></i>`).join('');
    return `<span class="chambers" title="${t().chambers}">${dots}</span>`;
  }

  private gameView(): string {
    const m = this.match!;
    const s = t();
    const h = m.hand;
    const reveal = h.result !== null;
    const tags = [1, 2, 3].map((p) => {
      const out = this.ruleta && !m.alive[p];
      const active = !h.result && h.current === p && !out;
      const bubble = this.bubbles[p];
      return `<div class="tag ${active ? 'active' : ''} ${out ? 'out' : ''} ${this.ruleta ? 'solo' : `team-${teamOf(p)}`}" data-seat="${p}">
        ${bubble ? `<div class="bubble ${bubble.big ? 'big' : ''}">${bubble.text}</div>` : ''}
        <div class="nameplate"><span class="name">${out ? '✝ ' : ''}${s.names[p]}</span>
          ${active ? '<span class="dots"><i></i><i></i><i></i></span>' : ''}
          ${reveal && !out ? `<span class="count">${handPips(h.hands[p])}</span>` : ''}
          ${this.ruleta && !out ? this.chambers(p) : ''}</div>
      </div>`;
    }).join('');

    const myTurn = h.current === HUMAN && !h.result && !this.overlay && !this.roulette;
    const myBubble = this.bubbles[HUMAN];
    const score = this.ruleta
      ? `<div class="score"><span class="vs">${s.ruleta} · ${s.hand} ${m.handNumber}</span></div>`
      : `<div class="score"><span class="team team-0">${s.us} <b>${m.scores[0]}</b></span>
          <span class="vs">${s.hand} ${m.handNumber} · ${s.to} ${m.rules.targetScore}</span>
          <span class="team team-1">${s.them} <b>${m.scores[1]}</b></span></div>`;
    const sideButtons = this.selected
      ? `<div class="sides"><span>${s.chooseSide}</span>${this.humanMovesFor(this.selected).map((mv) =>
        `<button class="btn small" data-action="side" data-value="${mv.side}">${mv.side === 'left' ? '◀ ' + s.leftEnd : s.rightEnd + ' ▶'}</button>`).join('')}</div>`
      : '';
    const gun = m.revolvers[HUMAN];
    const trigger = this.roulette?.waitHuman
      ? `<div class="trigger-panel"><p class="odds">${s.odds}: <b>1 / ${CHAMBERS - gun.pulls}</b> (${Math.round(fireChance(gun) * 100)}%)</p>
         <button class="btn primary trigger" data-action="trigger">${s.pullTrigger}</button></div>`
      : '';
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
        ${sideButtons}
        <div class="nameplate"><span class="name">${s.names[HUMAN]}</span>
          ${myTurn ? `<span class="your-turn">${s.yourTurn}</span>` : ''}
          ${reveal ? `<span class="count">${handPips(h.hands[HUMAN])}</span>` : ''}
          ${this.ruleta ? this.chambers(HUMAN) : ''}</div>
      </footer>
      ${this.status ? `<div class="status">${this.status}</div>` : ''}
      ${trigger}
      ${this.overlayView()}
    </main>`;
  }

  private overlayView(): string {
    if (!this.overlay) return '';
    const m = this.match!;
    const s = t();
    const enter = this.animateOverlay ? 'enter' : '';
    if (this.overlay === 'dead') {
      return `<div class="overlay dead ${enter}"><div class="card lose">
        <h2 class="you-died">${s.youDied}</h2>
        <div class="row"><button class="btn primary" data-action="new-match">${s.newMatch}</button>
        <button class="btn" data-action="menu">${s.menu}</button></div></div></div>`;
    }
    if (this.overlay === 'match') {
      const won = this.ruleta ? m.winnerPlayer === HUMAN : m.winnerTeam === teamOf(HUMAN);
      const headline = this.ruleta ? (won ? s.youWinRuleta : `${s.names[m.winnerPlayer!]} ${s.winsRuleta}`) : won ? s.weWin : s.theyWin;
      return `<div class="overlay ${enter}"><div class="card ${won ? 'win' : 'lose'}">
        ${this.flag()}
        <h2>${headline}</h2>
        ${!this.ruleta && m.pollona ? `<p class="pollona">${s.pollona}</p>` : ''}
        ${this.ruleta ? `<p>${s.lastStanding}</p>` : `<p class="final"><span class="team-0">${s.us} ${m.scores[0]}</span> — <span class="team-1">${s.them} ${m.scores[1]}</span></p>`}
        <div class="row"><button class="btn primary" data-action="new-match">${s.newMatch}</button>
        <button class="btn" data-action="menu">${s.menu}</button></div></div></div>`;
    }
    const r = m.history[m.history.length - 1];
    const headline = r.reason === 'domino' ? (r.capicu ? s.capicu : s.domino) : s.tranque;
    const who = r.winnerPlayer === null ? s.tiedTranque : `${s.names[r.winnerPlayer]} ${s.wonHand}`;
    const shooters = m.pendingShooters;
    const humanWon = this.ruleta ? r.winnerPlayer === HUMAN : r.winnerTeam === teamOf(HUMAN);
    const counts = r.pipCounts.map((c, p) => (m.hand.seated[p]
      ? `<li class="${this.ruleta ? (shooters.includes(p) ? 'shooter' : '') : `team-${teamOf(p)}`}">${s.names[p]}<b>${c}</b></li>` : '')).join('');
    return `<div class="overlay ${enter}"><div class="card ${humanWon ? 'win' : r.winnerPlayer === null ? '' : 'lose'}">
      <h2>${headline}</h2><p>${who}</p>
      ${!this.ruleta && r.winnerTeam !== null ? `<p class="points team-${r.winnerTeam}">+${r.points} ${s.points}</p>` : ''}
      <h3>${s.pipsLeft}</h3><ul class="counts">${counts}</ul>
      ${this.ruleta
        ? `<p class="must-shoot">${shooters.length ? `${s.mustShoot} <b>${shooters.map((p) => s.names[p]).join(', ')}</b>` : s.nobodyShoots}</p>`
        : `<p class="final"><span class="team-0">${s.us} ${m.scores[0]}</span> — <span class="team-1">${s.them} ${m.scores[1]}</span></p>`}
      <button class="btn primary" data-action="next-hand">${this.ruleta && shooters.length ? s.continueBtn : s.nextHand}</button></div></div>`;
  }
}
