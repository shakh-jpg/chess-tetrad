// App state (single object) and SAN formatting for the chosen notation.
// Moved from ui/app.js (review fixes); the code inside is unchanged, app functions come through ctx.
import { lsGet } from './util.js';

  // ================= состояние =================
export var S = {
    books: [], book: null, item: null, root: null, cur: null, flipped: false,
    notation: lsGet('st.notation', 'fig'), mode: 'analyse', solve: null,
    sel: null, dots: [], drag: null, engineOn: false, engineLines: {}, engineKind: null,
    filter: 'all', q: '', pane: 'board', hint: null, delArm: null, msg: null, nodes: {}
  };

  // ================= вспомогательное: позиции =================
  var FIGS = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
  var RUS = { K: 'Кр', Q: 'Ф', R: 'Л', B: 'С', N: 'К' };
export function fmt(san) {
    if (!san || S.notation === 'en') return san || '';
    var M = S.notation === 'fig' ? FIGS : RUS;
    return san.replace(/^[KQRBN]/, function (c) { return M[c]; }).replace(/=([QRBN])/, function (_, c) { return '=' + M[c]; });
  }

