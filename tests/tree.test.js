import { describe, it, expect } from 'vitest';
import { Core } from '../src/core/index.js';

const { makeRoot, addChild, tryMove, mainLine, removeNode, promoteNode, toMovetext, START } = Core;

function play(root, sans) {
  let n = root;
  for (const s of sans) { const r = tryMove(n, s); if (!r) throw new Error('illegal ' + s); n = r.node; }
  return n;
}

describe('move tree', () => {
  it('builds the main line and prints movetext', () => {
    const root = makeRoot();
    play(root, ['e4', 'e5', 'Nf3']);
    expect(mainLine(root).map((n) => n.san)).toEqual(['e4', 'e5', 'Nf3']);
    expect(toMovetext(root)).toBe('1. e4 e5 2. Nf3');
    expect(root.fen).toBe(START);
  });

  it('reuses an existing child for the same move instead of duplicating it', () => {
    const root = makeRoot();
    const a = tryMove(root, 'e4').node;
    const b = tryMove(root, 'e4').node;
    expect(a).toBe(b);
    expect(root.kids.length).toBe(1);
  });

  it('adds a variation as a second child and prints it in brackets', () => {
    const root = makeRoot();
    play(root, ['e4', 'e5']);
    tryMove(root, 'd4');
    expect(root.kids.map((k) => k.san)).toEqual(['e4', 'd4']);
    expect(toMovetext(root)).toBe('1. e4 (1. d4) 1... e5');
  });

  it('"make main" (promoteNode) moves a variation to the front', () => {
    const root = makeRoot();
    play(root, ['e4', 'e5']);
    const d4 = tryMove(root, 'd4').node;
    promoteNode(d4);
    expect(root.kids[0]).toBe(d4);
    expect(toMovetext(root)).toBe('1. d4 (1. e4 e5)');
  });

  it('"delete move" (removeNode) removes the node with everything after it', () => {
    const root = makeRoot();
    const e5 = play(root, ['e4', 'e5', 'Nf3', 'Nc6']).parent.parent;
    removeNode(e5.kids[0]);
    expect(toMovetext(root)).toBe('1. e4 e5');
    removeNode(root); // root has no parent: no-op
    expect(root.kids.length).toBe(1);
  });

  it('keeps comments and NAGs in movetext', () => {
    const root = makeRoot();
    const e4 = play(root, ['e4']);
    e4.nag = '!'; e4.comment = 'best by test';
    play(e4, ['e5']);
    expect(toMovetext(root)).toBe('1. e4! {best by test} 1... e5');
  });

  it('understands book shorthand: pawn capture "ed" and loose SAN', () => {
    const root = makeRoot();
    const n = play(root, ['e4', 'd5']);
    const r = tryMove(n, 'ed');
    expect(r.node.san).toBe('exd5');
    expect(tryMove(makeRoot(), 'Ng1f3').node.san).toBe('Nf3');
  });

  it('numbers moves correctly from a FEN with black to move', () => {
    const root = makeRoot('4k3/8/8/8/8/8/4P3/4K3 b - - 0 12');
    play(root, ['Kd7', 'e4']);
    expect(toMovetext(root)).toBe('12... Kd7 13. e4');
  });

  it('addChild links parent and colour', () => {
    const root = makeRoot();
    const c = addChild(root, 'e4', 'x');
    expect(c.parent).toBe(root);
    expect(c.color).toBe('w');
    expect(c.num).toBe(1);
  });
});
