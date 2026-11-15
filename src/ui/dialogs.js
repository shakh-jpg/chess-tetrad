// Toast notifications, modal dialogs, clipboard.
// Moved from ui/app.js (review fixes); the code inside is unchanged, app functions come through ctx.
import { $, $$ } from './util.js';

  // ================= уведомления и окна =================
  var toastT;
export function toast(msg, kind) {
    var el = $('#toast'); el.textContent = msg; el.className = 'toast show ' + (kind || '');
    clearTimeout(toastT); toastT = setTimeout(function () { el.className = 'toast'; }, 4200);
  }
export function openModal(html, cls) {
    var back = document.createElement('div'); back.className = 'modal-back';
    back.innerHTML = '<div class="modal ' + (cls || '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    $('#modal-root').appendChild(back);
    var api = {
      el: back.firstChild, back: back,
      close: function () { if (back.parentNode) back.parentNode.removeChild(back); document.removeEventListener('keydown', onKey); if (api.onclose) api.onclose(); }
    };
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); api.close(); } }
    document.addEventListener('keydown', onKey);
    back.addEventListener('mousedown', function (e) { if (e.target === back && !cls) api.close(); });
    $$('[data-close]', back).forEach(function (b) { b.addEventListener('click', api.close); });
    return api;
  }

export function copyText(t, okMsg) {
    var done = function () { toast(okMsg || 'Скопировано'); };
    try { navigator.clipboard.writeText(t).then(done, function () { toast(t); }); } catch (e) { toast(t); }
  }
