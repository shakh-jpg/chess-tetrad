// Sample book created on first launch.
// Moved verbatim from the prototype (shakhmatnaya-tetrad_artifact_2026-11-13.html); see git history.
import { Core } from '../core/index.js';
import { uid } from './util.js';

function sampleBook() {
  var txt = [
    'Андерсен — Кизерицкий, Лондон 1851 («Бессмертная партия»)',
    '1.e4 e5 2.f4 exf4 3.Bc4 Qh4+ 4.Kf1 b5 5.Bxb5 Nf6 6.Nf3 Qh6 7.d3 Nh5 8.Nh4 Qg5 9.Nf5 c6 10.g4 Nf6 11.Rg1 cxb5 12.h4 Qg6 13.h5 Qg5 14.Qf3 Ng8 15.Bxf4 Qf6 16.Nc3 Bc5 17.Nd5 Qxb2 18.Bd6 Bxg1 19.e5 Qxa1+ 20.Ke2 Na6 21.Nxg7+ Kd8 22.Qf6+ Nxf6 23.Be7# 1-0',
    '',
    'Легаль — Сен-Бри, Париж 1750 (ловушка Легаля)',
    '1.e4 e5 2.Nf3 d6 3.Bc4 Bg4 4.Nc3 g6 {Чёрные не заметили ловушки} 5.Nxe5 Bxd1 6.Bxf7+ Ke7 7.Nd5# 1-0',
    '',
    'Задача 1. Мат в один ход (линейный мат)',
    '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
    'Решение: 1. Лd8#',
    '',
    'Задача 2. Мат в один ход (детский мат)',
    'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
    'Решение: 4. Фxf7#',
    '',
    'Задача 3. Мат конём (мат в углу)',
    '6rk/6pp/8/6N1/8/8/8/7K w - - 0 1',
    'Решение: 1. Кf7#'
    // "Задача 4. Мат в два хода" was removed (stage 3, coach's decision): its solution was not a mate.
  ].join('\n');
  var items = Core.parseBook(txt);
  return { id: uid('b'), name: 'Пример (можно удалить)', created: Date.now(), sample: true, items: items.map(function (it) { it.id = uid('i'); return it; }) };
}

export { sampleBook };
