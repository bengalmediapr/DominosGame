import { chooseMove } from '../engine/ai';
import {
  HandResult, MatchState, Move, Rules, Side, applyMove, legalMoves, newMatch, pass,
  scoreFinishedHand, startNextHand, teamOf,
} from '../engine/game';
import { Tile, handPips, sameTile } from '../engine/tiles';
import { ACHIEVEMENTS, platform } from '../platform';
import { clack, coqui, fanfare, setVolume } from './audio';
import { setLang, t } from './i18n';
import { layoutBoard } from './layout';
import { Settings, loadSavedMatch, loadSettings, saveMatch, saveSettings } from './settings';
import { star, tileBackMarkup, tileMarkup } from './tileSvg';

type Screen = 'menu' | 'options' | 'howto' | 'game';
const HUMAN = 0;
const SEATS = ['bottom', 'right', 'top', 'left'] as const;
const DELAYS = { slow: 1300, normal: 800, fast: 350 };

interface Bubble { text: string; big?: boolean }

export class App {
  private settings: Settings = loadSettings();
  private screen: Screen = 'menu';
  private match: MatchState | null = null;
  private selected: Tile | null = null;
  private bubbles: (Bubble | null)[] = [null, null, null, null];
  private overlay: 'hand' | 'match' | null = null;
  private shake: Tile | null = null;
  /** Placement index to animate on the next render only (so re-renders don't replay it). */
  private freshIndex = -1;
  private animateOverlay = false;
  /** Bumped whenever play is abandoned so stale timers do nothing. */
  private generation = 0;

  constructor(private readonly root: HTMLElement, private readonly rng: () => number = Math.random) {
    setLang(this.settings.lang);
    setVolume(this.settings.volume);
    const saved = loadSavedMatch<MatchState>();
    if (saved && saved.winnerTeam === null && saved.hand?.hands?.length === 4) this.match = saved;
    root.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.render();
  }

  // ---------- flow ----------

  private rules(): Rules {
    const s = this.settings;
    return { targetScore: s.targetScore, capicuBonus: s.capicuBonus ? 100 : 0, countAllHands: s.countAllHands };
  }

  private startMatch(): void {
    this.match = newMatch(this.rng, this.rules());
    this.enterGame();
    const opener = this.match.hand.current;
    this.say(opener, `${t().names[opener]} ${t().opens}`);
  }

  private enterGame(): void {
    this.generation++;
    this.screen = 'game';
    this.overlay = this.match?.hand.result ? (this.match.winnerTeam !== null ? 'match' : 'hand') : null;
    this.selected = null;
    this.bubbles = [null, null, null, null];
    coqui();
    this.render();
    this.schedule(this.delay() * 1.5);
  }

  private delay(): number {
    return DELAYS[this.settings.speed];
  }

  private schedule(ms: number): void {
    const gen = this.generation;
    window.setTimeout(() => { if (gen === this.generation) this.step(); }, ms);
  }

  private setHand(next: MatchState['hand']): void {
    this.match = { ...this.match!, hand: next };
    if (next.result) this.finishHand(next.result);
    saveMatch(this.match);
  }

  /** Advance whoever's turn it is. */
  private step(): void {
    const m = this.match;
    if (!m || this.screen !== 'game' || m.hand.result || this.overlay) return;
    const h = m.hand;
    const moves = legalMoves(h);
    if (h.current === HUMAN) {
      if (moves.length === 0) {
        this.say(HUMAN, t().pass);
        this.setHand(pass(h));
        this.render();
        this.schedule(this.delay());
      } else {
        this.render();
      }
      return;
    }
    const move = chooseMove(h, m.rules, this.settings.difficulty, this.rng);
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
    this.freshIndex = h.placements.length;
    this.setHand(applyMove(h, move, this.match!.rules));
    clack(this.match!.hand.result !== null);
    this.render();
    if (!this.match!.hand.result) this.schedule(this.delay());
  }

  private finishHand(result: HandResult): void {
    const s = t();
    if (result.reason === 'domino') {
      this.say(result.winnerPlayer!, result.capicu ? s.capicu : s.domino, true);
    } else {
      this.bubbles = [null, null, null, null];
      if (result.winnerPlayer !== null) this.say(result.winnerPlayer, s.tranque, true);
    }
    this.match = scoreFinishedHand(this.match!);
    const weWon = result.winnerTeam === teamOf(HUMAN);
    if (weWon) {
      platform.unlockAchievement(ACHIEVEMENTS.firstHand);
      if (result.capicu) platform.unlockAchievement(ACHIEVEMENTS.capicu);
      if (result.reason === 'tranque') platform.unlockAchievement(ACHIEVEMENTS.tranque);
    }
    const m = this.match;
    if (m.winnerTeam !== null) {
      const matchWon = m.winnerTeam === teamOf(HUMAN);
      if (matchWon) {
        platform.unlockAchievement(ACHIEVEMENTS.firstMatch);
        if (m.pollona) platform.unlockAchievement(ACHIEVEMENTS.pollona);
        if (this.settings.difficulty === 'hard') platform.unlockAchievement(ACHIEVEMENTS.hardWin);
      }
      fanfare(matchWon);
    } else {
      fanfare(weWon);
    }
    const gen = this.generation;
    window.setTimeout(() => {
      if (gen !== this.generation) return;
      this.overlay = m.winnerTeam !== null ? 'match' : 'hand';
      this.animateOverlay = true;
      this.render();
    }, 1400);
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
    const gen = this.generation;
    window.setTimeout(() => {
      if (gen === this.generation && this.bubbles[seat] === bubble) {
        this.bubbles[seat] = null;
        this.render();
      }
    }, 1800);
  }

  // ---------- input ----------

  private humanMovesFor(tile: Tile): Move[] {
    const h = this.match?.hand;
    if (!h || h.current !== HUMAN || h.result || this.overlay) return [];
    return legalMoves(h).filter((m) => sameTile(m.tile, tile));
  }

  private tryTile(tile: Tile): void {
    const moves = this.humanMovesFor(tile);
    if (moves.length === 0) {
      this.shake = tile;
      this.render();
      this.shake = null;
      return;
    }
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
    if (this.selected) this.play({ tile: this.selected, side });
  }

  private onClick(e: Event): void {
    const el = (e.target as Element).closest<HTMLElement | SVGElement>('[data-action]');
    if (!el) return;
    const { action, value } = el.dataset;
    switch (action) {
      case 'play': this.startMatch(); break;
      case 'continue': this.enterGame(); break;
      case 'options': this.screen = 'options'; this.render(); break;
      case 'howto': this.screen = 'howto'; this.render(); break;
      case 'menu': this.generation++; this.screen = 'menu'; this.render(); break;
      case 'quit': platform.quit(); break;
      case 'fullscreen': platform.toggleFullscreen(); break;
      case 'tile': this.tryTile(value!.split('-').map(Number) as unknown as Tile); break;
      case 'side': this.chooseSide(value as Side); break;
      case 'next-hand': this.nextHand(); break;
      case 'new-match': this.startMatch(); break;
      case 'set': this.updateSetting(el.dataset.key as keyof Settings, value!); break;
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'F11') { e.preventDefault(); platform.toggleFullscreen(); return; }
    if (this.screen !== 'game') {
      if (e.key === 'Escape' && this.screen !== 'menu') { this.screen = 'menu'; this.render(); }
      return;
    }
    if (e.key === 'Escape') { this.generation++; this.screen = 'menu'; this.render(); return; }
    if (this.overlay && (e.key === 'Enter' || e.key === ' ')) {
      if (this.overlay === 'hand') this.nextHand(); else this.startMatch();
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

  // ---------- rendering ----------

  private render(): void {
    document.documentElement.lang = this.settings.lang;
    const view = { menu: () => this.menuView(), options: () => this.optionsView(), howto: () => this.howToView(), game: () => this.gameView() };
    this.root.innerHTML = view[this.screen]();
    this.freshIndex = -1;
    this.animateOverlay = false;
  }

  private flag(): string {
    const stripes = [0, 1, 2, 3, 4].map((i) => `<rect x="0" y="${i * 12}" width="100" height="12" fill="${i % 2 ? '#fff' : 'var(--pr-red)'}"/>`).join('');
    return `<svg class="flag" viewBox="0 0 100 60" aria-hidden="true">${stripes}
      <path d="M0 0 L52 30 L0 60 Z" fill="var(--pr-blue)"/><path d="${star(17, 30, 11)}" fill="#fff"/></svg>`;
  }

  private menuView(): string {
    const s = t();
    const canContinue = this.match && this.match.winnerTeam === null;
    return `<main class="screen menu">
      ${this.flag()}
      <h1 class="logo">${s.title}</h1>
      <p class="tagline">${s.tagline}</p>
      <nav class="menu-buttons">
        ${canContinue ? `<button class="btn primary" data-action="continue">${s.continue}</button>` : ''}
        <button class="btn ${canContinue ? '' : 'primary'}" data-action="play">${canContinue ? s.newMatch : s.play}</button>
        <button class="btn" data-action="howto">${s.howTo}</button>
        <button class="btn" data-action="options">${s.options}</button>
        ${platform.isDesktop ? `<button class="btn ghost" data-action="quit">${s.quit}</button>` : ''}
      </nav>
      <div class="menu-tiles">${[[6, 6], [3, 5], [1, 4]].map(([a, b], i) =>
        `<svg viewBox="0 0 1 2" class="deco deco-${i}">${tileMarkup(0, 0, 1, 2, a, b)}</svg>`).join('')}</div>
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
      <p class="note">1–7: ${s.play.toLowerCase()} · ← →: ${s.chooseSide.toLowerCase()} · Esc: ${s.menu.toLowerCase()} · F11: ${s.fullscreen.toLowerCase()}</p>
      <button class="btn" data-action="menu">${s.back}</button>
    </main>`;
  }

  private gameView(): string {
    const m = this.match!;
    const s = t();
    const h = m.hand;
    const reveal = h.result !== null;
    const seat = (p: number) => {
      const active = !h.result && h.current === p;
      const tiles = p === HUMAN ? this.humanHand() : this.opponentHand(p, reveal);
      const bubble = this.bubbles[p];
      return `<section class="seat seat-${SEATS[p]} ${active ? 'active' : ''} team-${teamOf(p)}">
        <div class="nameplate"><span class="avatar">${s.names[p][0]}</span><span class="name">${s.names[p]}</span>
          ${active && p !== HUMAN ? `<span class="dots"><i></i><i></i><i></i></span>` : ''}
          ${active && p === HUMAN ? `<span class="your-turn">${s.yourTurn}</span>` : ''}
          ${reveal ? `<span class="count">${handPips(h.hands[p])}</span>` : ''}</div>
        ${tiles}
        ${bubble ? `<div class="bubble ${bubble.big ? 'big' : ''}">${bubble.text}</div>` : ''}
      </section>`;
    };
    return `<main class="screen game">
      <header class="hud">
        <button class="btn small ghost" data-action="menu" aria-label="${s.menu}">☰ ${s.menu}</button>
        <div class="score"><span class="team team-0">${s.us} <b>${m.scores[0]}</b></span>
          <span class="vs">${s.hand} ${m.handNumber} · ${s.to} ${m.rules.targetScore}</span>
          <span class="team team-1">${s.them} <b>${m.scores[1]}</b></span></div>
        <div class="flag-mini">${this.flag()}</div>
      </header>
      <div class="board">${this.boardSvg()}</div>
      ${[0, 1, 2, 3].map(seat).join('')}
      ${this.overlayView()}
    </main>`;
  }

  private boardSvg(): string {
    const h = this.match!.hand;
    const layout = layoutBoard(h.placements);
    const pad = 1.2;
    const b = layout.bounds;
    const vb = `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + pad * 2} ${b.maxY - b.minY + pad * 2}`;
    const tiles = layout.tiles.map((lt) => tileMarkup(lt.x, lt.y, lt.w, lt.h, lt.first, lt.second, lt.index === this.freshIndex ? 'fresh' : '')).join('');
    let targets = '';
    if (this.selected && layout.ends) {
      const moves = this.humanMovesFor(this.selected);
      targets = moves.map((mv) => {
        const p = layout.ends![mv.side];
        return `<g class="target" data-action="side" data-value="${mv.side}"><circle cx="${p.x}" cy="${p.y}" r="0.75"/>
          <text x="${p.x}" y="${p.y + 0.22}">${mv.side === 'left' ? '◀' : '▶'}</text></g>`;
      }).join('');
    }
    return `<svg viewBox="${vb}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="board">${tiles}${targets}</svg>`;
  }

  private humanHand(): string {
    const h = this.match!.hand;
    const myTurn = h.current === HUMAN && !h.result && !this.overlay;
    const playable = myTurn ? legalMoves(h) : [];
    return `<div class="hand mine">${h.hands[HUMAN].map((tile, i) => {
      const can = playable.some((mv) => sameTile(mv.tile, tile));
      const cls = [
        'hand-tile', can ? 'playable' : myTurn ? 'dim' : '',
        this.selected && sameTile(this.selected, tile) ? 'selected' : '',
        this.shake && sameTile(this.shake, tile) ? 'shake' : '',
      ].join(' ');
      return `<button class="${cls}" data-action="tile" data-value="${tile[0]}-${tile[1]}" aria-label="${tile[0]} ${tile[1]}">
        <svg viewBox="0 0 1 2">${tileMarkup(0, 0, 1, 2, tile[0], tile[1])}</svg><kbd>${i + 1}</kbd></button>`;
    }).join('')}</div>`;
  }

  private opponentHand(p: number, reveal: boolean): string {
    const tiles = this.match!.hand.hands[p];
    const vertical = p === 1 || p === 3;
    return `<div class="hand others ${vertical ? 'vertical' : ''}">${tiles.map((tile) => {
      const [w, hgt] = vertical ? [2, 1] : [1, 2];
      const inner = reveal ? tileMarkup(0, 0, w, hgt, tile[0], tile[1]) : tileBackMarkup(0, 0, w, hgt);
      return `<svg class="mini" viewBox="0 0 ${w} ${hgt}">${inner}</svg>`;
    }).join('')}</div>`;
  }

  private overlayView(): string {
    if (!this.overlay) return '';
    const m = this.match!;
    const s = t();
    const r = m.history[m.history.length - 1];
    if (this.overlay === 'match') {
      const won = m.winnerTeam === teamOf(HUMAN);
      return `<div class="overlay ${this.animateOverlay ? 'enter' : ''}"><div class="card ${won ? 'win' : 'lose'}">
        ${this.flag()}
        <h2>${won ? s.weWin : s.theyWin}</h2>
        ${m.pollona ? `<p class="pollona">${s.pollona}</p>` : ''}
        <p class="final"><span class="team-0">${s.us} ${m.scores[0]}</span> — <span class="team-1">${s.them} ${m.scores[1]}</span></p>
        <div class="row"><button class="btn primary" data-action="new-match">${s.newMatch}</button>
        <button class="btn" data-action="menu">${s.menu}</button></div></div></div>`;
    }
    const headline = r.reason === 'domino' ? (r.capicu ? s.capicu : s.domino) : s.tranque;
    const who = r.winnerPlayer === null ? s.tiedTranque : `${s.names[r.winnerPlayer]} ${s.wonHand}`;
    return `<div class="overlay ${this.animateOverlay ? 'enter' : ''}"><div class="card ${r.winnerTeam === teamOf(HUMAN) ? 'win' : r.winnerTeam === null ? '' : 'lose'}">
      <h2>${headline}</h2><p>${who}</p>
      ${r.winnerTeam !== null ? `<p class="points team-${r.winnerTeam}">+${r.points} ${s.points}</p>` : ''}
      <h3>${s.pipsLeft}</h3><ul class="counts">${r.pipCounts.map((c, p) => `<li class="team-${teamOf(p)}">${s.names[p]}<b>${c}</b></li>`).join('')}</ul>
      <p class="final"><span class="team-0">${s.us} ${m.scores[0]}</span> — <span class="team-1">${s.them} ${m.scores[1]}</span></p>
      <button class="btn primary" data-action="next-hand">${s.nextHand}</button></div></div>`;
  }
}
