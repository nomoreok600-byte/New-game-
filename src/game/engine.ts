// Nova Pop — core puzzle engine.
// 8x8 board. Drag one of 3 pieces, merge same-color neighbors, clear full lines.

export const BOARD_SIZE = 8;

export type Cell = 0 | 1 | 2 | 3; // 0 empty, 1..3 colors
export type Board = Cell[]; // flat array, row-major, length 64
export type Block = { id: number; color: Exclude<Cell, 0>; cells: [number, number][] };
export type Piece = { shape: [number, number][]; color: Exclude<Cell, 0> };
export type MoveResult = {
  board: Board;
  blocks: Block[];
  cleared: number; // cells removed by line clears
  lines: number; // number of full lines cleared
  merges: number; // number of neighbor blocks merged
  gained: number; // points earned from this move
};

export const idx = (r: number, c: number): number => r * BOARD_SIZE + c;

const randInt = (n: number): number => Math.floor(Math.random() * n);

export const randomColor = (): Exclude<Cell, 0> => (1 + randInt(3)) as Exclude<Cell, 0>;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const MINI: [number, number][][] = [
  [[0, 0]],
  [[0, 0], [0, 1]],
  [[0, 0], [1, 0]],
  [[0, 0], [0, 1], [0, 2]],
  [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [0, 1], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [1, 1], [1, 2]],
  [[0, 1], [1, 0], [1, 1], [1, 2]],
];

const BIG: [number, number][][] = [
  [[0, 0], [0, 1], [0, 2]],
  [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [0, 1], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]],
  [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]],
  [[0, 0], [1, 0], [1, 1], [2, 1]],
];

const WEIGHTS: number[] = [3, 3, 3, 2.4, 2.4, 2, 1.6, 1.6, 1.1, 0.9, 0.9, 0.7, 0.5, 0.5];

export function randomPiece(): Piece {
  const pool: [number, number][][] = [];
  MINI.forEach((s, i) => {
    for (let k = 0; k < Math.round(WEIGHTS[i]); k++) pool.push(s);
  });
  BIG.forEach((s, i) => {
    for (let k = 0; k < Math.round(WEIGHTS[MINI.length + i]); k++) pool.push(s);
  });
  const shape = pool[randInt(pool.length)];
  return { shape, color: randomColor() };
}

export function newHand(): Piece[] {
  return [randomPiece(), randomPiece(), randomPiece()];
}

export function newBoard(): Board {
  return new Array(BOARD_SIZE * BOARD_SIZE).fill(0) as Board;
}

export function newGame(): { board: Board; blocks: Block[]; hand: Piece[]; nextId: number } {
  return { board: newBoard(), blocks: [], hand: newHand(), nextId: 1 };
}

function maxOffset(shape: [number, number][], axis: 0 | 1): number {
  let m = 0;
  for (const [dr, dc] of shape) m = Math.max(m, axis === 0 ? dr : dc);
  return m;
}

export function canPlace(board: Board, shape: [number, number][], r: number, c: number): boolean {
  const mr = maxOffset(shape, 0);
  const mc = maxOffset(shape, 1);
  if (r < 0 || c < 0 || r + mr >= BOARD_SIZE || c + mc >= BOARD_SIZE) return false;
  return shape.every(([dr, dc]) => board[idx(r + dr, c + dc)] === 0);
}

function neighbors4(r: number, c: number): [number, number][] {
  return [
    [r - 1, c],
    [r + 1, c],
    [r, c - 1],
    [r, c + 1],
  ];
}

function floodCollect(
  board: Board,
  blocks: Block[],
  start: [number, number]
): { cells: [number, number][]; color: number; blockIds: number[] } {
  const color = board[idx(start[0], start[1])];
  const seen = new Set<number>([idx(start[0], start[1])]);
  const stack: [number, number][] = [start];
  const cells: [number, number][] = [];
  const blockIds = new Set<number>();
  while (stack.length) {
    const [r, c] = stack.pop()!;
    cells.push([r, c]);
    const b = blocks.find((bl) => bl.cells.some(([br, bc]) => br === r && bc === c));
    if (b) blockIds.add(b.id);
    for (const [nr, nc] of neighbors4(r, c)) {
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
      const ni = idx(nr, nc);
      if (!seen.has(ni) && board[ni] === color) {
        seen.add(ni);
        stack.push([nr, nc]);
      }
    }
  }
  return { cells, color, blockIds: [...blockIds] };
}

export function placePiece(
  board: Board,
  blocks: Block[],
  piece: Piece,
  r: number,
  c: number,
  nextId: number
): MoveResult {
  const b = [...board] as Board;
  const bs = blocks.map((x) => ({ ...x, cells: x.cells.map((cl) => [...cl] as [number, number]) }));
  let id = nextId;
  const newBlock: Block = { id: id++, color: piece.color, cells: piece.shape.map(([dr, dc]) => [r + dr, c + dc]) };
  bs.push(newBlock);
  for (const [dr, dc] of piece.shape) b[idx(r + dr, c + dc)] = piece.color;

  // Merge phase: same-color groups touching the new piece combine into one block.
  const touched = new Set<number>();
  for (const [dr, dc] of piece.shape) {
    for (const [nr, nc] of neighbors4(r + dr, c + dc)) {
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
      if (b[idx(nr, nc)] === piece.color) touched.add(idx(nr, nc));
    }
  }
  const groups = new Map<string, { cells: [number, number][]; blockIds: number[] }>();
  for (const ci of touched) {
    const r0 = Math.floor(ci / BOARD_SIZE);
    const c0 = ci % BOARD_SIZE;
    const g = floodCollect(b, bs, [r0, c0]);
    const key = g.blockIds.length ? `b${g.blockIds.slice().sort((x, y) => x - y).join(",")}` : `c${g.cells.length}`;
    const prev = groups.get(key);
    if (prev) {
      const has = new Set(prev.cells.map(([a, o]) => `${a},${o}`));
      for (const cl of g.cells) if (!has.has(`${cl[0]},${cl[1]}`)) prev.cells.push(cl);
      for (const bid of g.blockIds) if (!prev.blockIds.includes(bid)) prev.blockIds.push(bid);
    } else {
      groups.set(key, { cells: g.cells, blockIds: g.blockIds });
    }
  }

  let merges = 0;
  for (const g of groups.values()) {
    if (g.cells.length < 2) continue;
    merges++;
    for (const bid of g.blockIds) {
      const bi = bs.findIndex((x) => x.id === bid);
      if (bi >= 0) bs.splice(bi, 1);
    }
    bs.push({ id: id++, color: piece.color, cells: g.cells });
  }

  // Line-clear phase.
  const fullRows: number[] = [];
  const fullCols: number[] = [];
  for (let rr = 0; rr < BOARD_SIZE; rr++) {
    if (b.slice(rr * BOARD_SIZE, rr * BOARD_SIZE + BOARD_SIZE).every((v) => v !== 0)) fullRows.push(rr);
  }
  for (let cc = 0; cc < BOARD_SIZE; cc++) {
    let ok = true;
    for (let rr = 0; rr < BOARD_SIZE; rr++) if (b[idx(rr, cc)] === 0) { ok = false; break; }
    if (ok) fullCols.push(cc);
  }
  const clearSet = new Set<number>();
  for (const rr of fullRows) for (let cc = 0; cc < BOARD_SIZE; cc++) clearSet.add(idx(rr, cc));
  for (const cc of fullCols) for (let rr = 0; rr < BOARD_SIZE; rr++) clearSet.add(idx(rr, cc));
  for (const ci of clearSet) b[ci] = 0;
  if (clearSet.size) {
    for (const bl of bs) bl.cells = bl.cells.filter(([br, bc]) => !clearSet.has(idx(br, bc)));
  }
  const kept = bs.filter((bl) => bl.cells.length > 0);

  const lines = fullRows.length + fullCols.length;
  const cleared = clearSet.size;
  const gained = cleared * 10 + merges * 25;
  return { board: b, blocks: kept, cleared, lines, merges, gained };
}

export function hasAnyMove(board: Board, hand: Piece[]): boolean {
  for (const p of hand) {
    const mr = maxOffset(p.shape, 0);
    const mc = maxOffset(p.shape, 1);
    for (let r = 0; r + mr < BOARD_SIZE; r++) {
      for (let c = 0; c + mc < BOARD_SIZE; c++) {
        if (canPlace(board, p.shape, r, c)) return true;
      }
    }
  }
  return false;
}

export function emptyCount(board: Board): number {
  return board.reduce<number>((n, v) => n + (v === 0 ? 1 : 0), 0);
}

// Heuristic 0..100 "board health" — how much breathing room the player has.
export function boardHealth(board: Board, hand: Piece[]): number {
  const empt = emptyCount(board) / (BOARD_SIZE * BOARD_SIZE);
  let moves = 0;
  for (const p of hand) {
    const mr = maxOffset(p.shape, 0);
    const mc = maxOffset(p.shape, 1);
    for (let r = 0; r + mr < BOARD_SIZE; r++) {
      for (let c = 0; c + mc < BOARD_SIZE; c++) {
        if (canPlace(board, p.shape, r, c)) moves++;
      }
    }
  }
  return Math.min(100, Math.round(empt * 55 + Math.min(moves, 30) * 1.5));
}

// Shuffle the hand into a guaranteed-playable set when the player earns a rescue.
export function rescueHand(board: Board): Piece[] {
  for (let attempt = 0; attempt < 40; attempt++) {
    const hand = newHand();
    if (hasAnyMove(board, hand)) return hand;
  }
  return [randomPiece(), randomPiece(), randomPiece()];
}

export const START_LIVES = 3;
export const MAX_LIVES = 5;
export const RESCUE_SCORE_STEP = 750;

export const PUZZLE_TIME_SECONDS = 120;

export type DailySeed = { y: number; m: number; d: number };

export function todaySeed(now = new Date()): DailySeed {
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

export function dailyKey(seed: DailySeed | Date): string {
  const s = seed instanceof Date ? todaySeed(seed) : seed;
  return `${s.y}-${String(s.m).padStart(2, "0")}-${String(s.d).padStart(2, "0")}`;
}

// Deterministic PRNG so Puzzle Time is the same board flow for everyone each day.
export function mulberry32(seedNum: number): () => number {
  let a = seedNum >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromKey(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function shuffleWith<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const DAILY_CHALLENGES: string[] = [
  "Clear 3 lines in one run",
  "Score 1,500 points",
  "Perform 8 merges",
  "Reach a combo of 4",
  "Clear 10 lines in total",
  "Score 3,000 points",
  "Perform 15 merges",
];

export function dailyChallengeFor(key: string): string {
  const rng = mulberry32(seedFromKey("challenge-" + key));
  return DAILY_CHALLENGES[Math.floor(rng() * DAILY_CHALLENGES.length) % DAILY_CHALLENGES.length];
}

export function shuffled<T>(arr: T[]): T[] {
  return shuffle(arr);
}
