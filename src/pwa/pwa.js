// PWA glue: service worker registration and update prompt, "Установить" button,
// iOS hint ("Поделиться → На экран «Домой»"). No data leaves the device.

export function isStandalone(win) {
  win = win || window;
  return !!((win.matchMedia && win.matchMedia('(display-mode: standalone)').matches) || win.navigator.standalone);
}

// iPhone/iPad Safari has no install prompt: the user adds the app from the Share menu.
export function isIOS(nav) {
  nav = nav || navigator;
  var ua = nav.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

function bar(text, actionLabel, onAction) {
  var el = document.createElement('div');
  el.className = 'pwa-bar'; el.setAttribute('role', 'status');
  el.innerHTML = '<span></span><button class="btn primary"></button><button class="btn" aria-label="Закрыть">×</button>';
  el.querySelector('span').textContent = text;
  el.querySelector('.primary').textContent = actionLabel;
  el.querySelector('.primary').addEventListener('click', function () { onAction(); el.remove(); });
  el.lastChild.addEventListener('click', function () { el.remove(); });
  document.body.appendChild(el);
  return el;
}

function iosHint(openModal) {
  openModal('<h3>Установить на iPhone или iPad</h3>' +
    '<ol class="ios-steps"><li>Откройте эту страницу в <b>Safari</b>.</li>' +
    '<li>Нажмите кнопку <b>«Поделиться»</b> (квадрат со стрелкой вверх).</li>' +
    '<li>Выберите <b>«На экран „Домой“»</b> и нажмите <b>«Добавить»</b>.</li></ol>' +
    '<p class="hint-note">Значок «Тетрадь» появится на экране. Приложение будет работать и без интернета.</p>' +
    '<div class="modal-act"><button class="btn primary" data-close>Понятно</button></div>');
}

export function initInstall(openModal) {
  var btn = document.getElementById('btn-install');
  if (!btn) return;
  var deferred = null;
  function refresh() { btn.hidden = isStandalone() || !(deferred || isIOS()); }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; refresh(); });
  window.addEventListener('appinstalled', function () { deferred = null; refresh(); });
  btn.addEventListener('click', function () {
    if (deferred) { var d = deferred; deferred = null; d.prompt(); d.userChoice.then(refresh, refresh); }
    else if (isIOS()) iosHint(openModal);
  });
  refresh();
}

export function registerSW(swUrl) {
  if (!('serviceWorker' in navigator)) return;
  var reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (reloading) return; reloading = true; window.location.reload();
  });
  navigator.serviceWorker.register(swUrl).then(function (reg) {
    function offer(w) {
      bar('Загружена новая версия приложения.', 'Обновить', function () { w.postMessage('skipWaiting'); });
    }
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', function () {
      var w = reg.installing; if (!w) return;
      w.addEventListener('statechange', function () {
        // Only an update (there is already a controller); the very first install needs no prompt.
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
  }).catch(function () { /* no offline mode, the app still works online */ });
}
