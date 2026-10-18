// Command-line admin tools, for when you're locked out of the web admin panel.
//   node server/admin-cli.js make-admin <username>
//   node server/admin-cli.js invite [note]
//   node server/admin-cli.js reset-link <username>
import { randomBytes } from 'node:crypto';
import { openDb } from './db.js';

const db = openDb(process.env.DATABASE_PATH || 'data/nuuvi.db');
const [command, arg] = process.argv.slice(2);
const user = () => db.prepare('SELECT * FROM users WHERE username = ?').get(arg ?? '') ?? exit(`No user named "${arg}"`);
function exit(message) {
  console.error(message);
  process.exit(1);
}

if (command === 'make-admin') {
  db.prepare('UPDATE users SET is_admin = 1, banned_at = NULL WHERE id = ?').run(user().id);
  console.log(`${arg} is now an admin.`);
} else if (command === 'invite') {
  const code = randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO site_invites (code, note) VALUES (?, ?)').run(code, arg ?? 'created from the command line');
  console.log(`Invite code: ${code}\nLink: <your site>/#/register/${code}`);
} else if (command === 'reset-link') {
  const token = randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    user().id,
    Date.now() + 86400000,
  );
  console.log(`Reset link (valid 24h): <your site>/#/reset/${token}`);
} else {
  exit('Usage: node server/admin-cli.js make-admin <username> | invite [note] | reset-link <username>');
}
