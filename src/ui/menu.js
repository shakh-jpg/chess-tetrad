// Phone header: the action buttons are folded into a "Меню" dropdown (CSS shows it only below 900px).
export function bindMenu(doc) {
  doc = doc || document;
  var top = doc.querySelector('.top'), btn = doc.getElementById('btn-menu'), actions = doc.getElementById('top-actions');
  if (!top || !btn || !actions) return;
  function set(open) { top.classList.toggle('menu-open', open); btn.setAttribute('aria-expanded', String(open)); }
  btn.addEventListener('click', function (e) { e.stopPropagation(); set(!top.classList.contains('menu-open')); });
  actions.addEventListener('click', function (e) { if (e.target.closest('button, label')) set(false); });
  doc.addEventListener('click', function (e) { if (!top.contains(e.target)) set(false); });
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') set(false); });
}
