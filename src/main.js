// Entry point.
import './fonts.css';
import './styles.css';
import { start, openModal, appContext, setProgressHook } from './ui/app.js';
import { bindMenu } from './ui/menu.js';
import { initInstall, registerSW } from './pwa/pwa.js';
import { initAccount } from './ui/account.js';
import { maybeRemindBackup } from './ui/backup-reminder.js';
import { CONFIG } from './sync/config.js';
import { lsGet } from './ui/util.js';

start().then(function () {
  // Cloud accounts and sync (stage 4). Without VITE_SUPABASE_* the app stays fully local.
  var ctx = appContext();
  var account = initAccount(ctx);
  setProgressHook(account.onProgress);
  // Backup reminder (every 14 days) when the library lives only in this browser.
  setTimeout(function () {
    maybeRemindBackup({ books: ctx.S.books, cloud: CONFIG.enabled && !!lsGet('st.cloud', false), makeBackup: ctx.exportBackup });
  }, 3000);
});
bindMenu();
initInstall(openModal);
// The service worker exists only in the production build (dist/sw.js).
if (import.meta.env.PROD) registerSW('./sw.js');
