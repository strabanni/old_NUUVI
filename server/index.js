import { createApp } from './app.js';

const env = process.env;
const port = Number(env.PORT) || 3000;
const dbPath = env.DATABASE_PATH || 'data/nuuvi.db';
const flag = (v) => v === '1' || v === 'true';

createApp({
  dbPath,
  uploadDir: env.UPLOAD_DIR,
  secureCookies: env.NODE_ENV === 'production',
  openRegistration: flag(env.OPEN_REGISTRATION),
  trustProxy: flag(env.TRUST_PROXY),
  // Push services (notably Apple's) want a real contact URL or mailto: here.
  vapidSubject: env.VAPID_SUBJECT || env.PUBLIC_URL || 'mailto:admin@example.com',
  // With an Anthropic API key, fan comments are written by Claude looking at the pictures.
  ai: { apiKey: env.ANTHROPIC_API_KEY || null },
}).listen(port, () => {
  console.log(`NUUVI is running at http://localhost:${port}`);
});
