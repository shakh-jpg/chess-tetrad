// Russian plural forms: plural(1, 'полуход', 'полухода', 'полуходов') -> 'полуход'.
// one: 1, 21, 31…; few: 2–4, 22–24…; many: 0, 5–20, 25–30…, 11–14.
export function plural(n, one, few, many) {
  var a = Math.abs(n) % 100, b = a % 10;
  if (a >= 11 && a <= 14) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

// "45 полуходов", "1 полуход", "3 полухода"
export function countLabel(n, one, few, many) {
  return n + ' ' + plural(n, one, few, many);
}

export function pliesLabel(n) { return countLabel(n, 'полуход', 'полухода', 'полуходов'); }
