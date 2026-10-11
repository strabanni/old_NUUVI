import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const dbPath = process.env.DATABASE_PATH || 'data/nuuvi.db';
const secureCookies = process.env.NODE_ENV === 'production';

createApp({ dbPath, secureCookies }).listen(port, () => {
  console.log(`NUUVI is running at http://localhost:${port}`);
});
