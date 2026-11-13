// Facade with the same shape as the prototype's window.ChessCore.
import { START, makeRoot, addChild, tryMove, mainLine, removeNode, promoteNode, toMovetext } from './tree.js';
import { cleanText, tokenize, normMove, parseBook, parseMovetext } from '../pgn/parse.js';

export const Core = {
    START: START, makeRoot: makeRoot, addChild: addChild, tryMove: tryMove, mainLine: mainLine,
    removeNode: removeNode, cleanText: cleanText, promoteNode: promoteNode, toMovetext: toMovetext,
    tokenize: tokenize, normMove: normMove, parseBook: parseBook, parseMovetext: parseMovetext
  };
export default Core;
