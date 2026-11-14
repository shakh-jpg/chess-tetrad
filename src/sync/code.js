// Student invite codes: XXXX-XXXX-XXXX from an alphabet without look-alikes (no 0 O 1 I L).
export var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Cyrillic letters that look like Latin ones (a Russian keyboard layout is common).
var CYR = { 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'У': 'Y', 'З': '3' };

// Returns { code: 'ABCD-EFGH-JKMN', valid: boolean }.
export function normalizeCode(input) {
  var s = String(input || '').toUpperCase().replace(/[АВЕКМНРСТХУЗ]/g, function (c) { return CYR[c]; });
  s = s.replace(/[^A-Z0-9]/g, '');
  var valid = s.length === 12 && s.split('').every(function (c) { return CODE_ALPHABET.indexOf(c) >= 0; });
  var code = s.length ? s.match(/.{1,4}/g).join('-') : '';
  return { code: code, valid: valid };
}

var ERRORS = {
  invalid_code: 'Код не подошёл. Проверьте его и попробуйте ещё раз.',
  code_locked: 'Код заблокирован после нескольких ошибок. Попросите у тренера новый код.',
  code_expired: 'Срок кода истёк (7 дней). Попросите у тренера новый код.',
  too_many_attempts: 'Слишком много попыток. Подождите час или попросите новый код.',
  coach_cannot_join: 'Вы вошли как тренер. Код ученика нужно вводить на устройстве ученика.',
  not_signed_in: 'Не удалось войти. Проверьте интернет и попробуйте ещё раз.',
  anon_failed: 'Не удалось подключиться к облаку. Проверьте интернет.',
  not_allowed: 'Этот адрес не разрешён для тренера. Добавьте его в список тренеров (см. инструкцию).',
  not_a_coach: 'Сначала войдите как тренер.',
  bad_nick: 'Ник должен быть от 1 до 40 символов.',
  too_many_students: 'Слишком много учеников.',
  not_found: 'Ученик не найден.'
};
export function errorText(code, fallback) {
  return ERRORS[code] || fallback || 'Ошибка: ' + (code || 'неизвестная');
}
