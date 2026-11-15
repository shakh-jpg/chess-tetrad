// Minimal type description of the vendored chess.js 0.10.x (src/core/chess.js), used only by
// `tsc --noEmit` for files marked `// @ts-check`. Methods the app uses are typed; the rest is open.
export interface ChessMove {
  color: 'w' | 'b';
  from: string;
  to: string;
  flags: string;
  piece: string;
  san: string;
  captured?: string;
  promotion?: string;
}
export declare class Chess {
  constructor(fen?: string);
  load(fen: string): boolean;
  fen(): string;
  turn(): 'w' | 'b';
  move(move: string | { from: string; to: string; promotion?: string }, options?: { sloppy?: boolean }): ChessMove | null;
  moves(options?: { verbose?: boolean; square?: string }): any[];
  undo(): ChessMove | null;
  in_check(): boolean;
  in_checkmate(): boolean;
  in_stalemate(): boolean;
  in_draw(): boolean;
  game_over(): boolean;
  [key: string]: any;
}
export default Chess;
