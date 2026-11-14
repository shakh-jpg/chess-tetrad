// Entry point.
import './fonts.css';
import './styles.css';
import { start, openModal, appContext, setProgressHook } from './ui/app.js';
import { bindMenu } from './ui/menu.js';
import { initInstall, registerSW } from './pwa/pwa.js';
import { initAccount } from './ui/account.js';

start().then(function () {
  // Cloud accounts and sync (stage 4). Without VITE_SUPABASE_* the app stays fully local.
  var account = initAccount(appContext());
  setProgressHook(account.onProgress);
});
bindMenu();
initInstall(openModal);
// The service worker exists only in the production build (dist/sw.js).
if (import.meta.env.PROD) registerSW('./sw.js');
