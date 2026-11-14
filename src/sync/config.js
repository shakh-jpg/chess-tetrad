// Cloud (Supabase) configuration from build-time variables. Without them the app stays fully local.
// VITE_SUPABASE_ANON_KEY is a public key: it is safe in the client ONLY because every table has
// Row Level Security. The service_role key must never be used here.
export function readConfig(env) {
  env = env || (typeof import.meta !== 'undefined' && import.meta.env) || {};
  var url = String(env.VITE_SUPABASE_URL || '').trim();
  var key = String(env.VITE_SUPABASE_ANON_KEY || '').trim();
  var ok = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) && key.length > 20;
  return { url: url.replace(/\/$/, ''), key: key, enabled: ok };
}

export var CONFIG = readConfig();
