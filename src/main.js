// Entry point.
import './fonts.css';
import './styles.css';
import { start, openModal } from './ui/app.js';
import { bindMenu } from './ui/menu.js';
import { initInstall, registerSW } from './pwa/pwa.js';

start();
bindMenu();
initInstall(openModal);
// The service worker exists only in the production build (dist/sw.js).
if (import.meta.env.PROD) registerSW('./sw.js');
