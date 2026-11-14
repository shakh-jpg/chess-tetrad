// Lazily creates the Supabase client (the library is loaded only when the cloud is configured and used).
import { CONFIG } from './config.js';

var clientP = null;
export function loadClient() {
  if (!CONFIG.enabled) return Promise.resolve(null);
  if (!clientP) {
    clientP = import('@supabase/supabase-js').then(function (m) {
      return m.createClient(CONFIG.url, CONFIG.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'tetrad-auth' }
      });
    }).catch(function (e) { clientP = null; throw e; });
  }
  return clientP;
}
