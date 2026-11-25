/**
 * Creates a CRM Admin (username + password). Run it once for the first Admin, again for more.
 *
 *   npm run bootstrap                     asks for username, name and password (local database)
 *   npm run bootstrap -- --live           the live database
 *   npm run bootstrap -- --live --username yaksh --name "Yaksh" --password "..."
 *
 * Leave the password empty to get a generated one, printed once.
 */
import crypto from 'crypto';
import readline from 'readline/promises';
import mongoose from 'mongoose';
import { USERNAME_RE } from '../models/accountFields';
import { passwordProblem } from '../services/passwords';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}

/** Typed characters are not shown. Falls back to a normal prompt when input is not a terminal. */
function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return ask(question);
  return new Promise((resolve) => {
    process.stdout.write(question);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let value = '';
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n' || c === '\u0004') {
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData);
          process.stdout.write('\n'); resolve(value); return;
        }
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') { if (value) { value = value.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        value += c; process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  if (process.argv.includes('--live')) process.env.MODE = 'live';
  // loaded after MODE is set: env.ts picks LOCAL_ or LIVE_ values when it is first imported
  const { env } = await import('../config/env');
  const { default: User } = await import('../models/User');
  const { credentialConflict } = await import('../services/accounts');

  console.log(`Create a CRM Admin (${env.mode} database)`);
  const username = (arg('username') || await ask('Username: ')).toLowerCase();
  if (!USERNAME_RE.test(username)) throw new Error('Username must be 3 to 32 characters: letters, numbers, dot, underscore or hyphen, starting with a letter or number.');
  const name = arg('name') || await ask('Full name: ') || username;
  const email = (arg('email') || '').toLowerCase() || undefined;

  let password = arg('password');
  let generated = false;
  if (!password) {
    password = await askHidden('Password (min 12, a letter and a number; empty = generate): ');
    if (password) {
      if ((await askHidden('Type it again: ')) !== password) throw new Error('The two passwords do not match.');
    } else {
      password = crypto.randomBytes(9).toString('base64url') + 'A1';
      generated = true;
    }
  }
  const problem = passwordProblem(password, 'staff', [username, name, email]);
  if (problem) throw new Error(problem);

  await mongoose.connect(env.mongoUri);
  console.log(`Connected (database: ${mongoose.connection.db?.databaseName})`);
  const conflict = await credentialConflict({ username, email });
  if (conflict) throw new Error(conflict);

  await User.create({ name, username, email, password, role: 'admin', emailVerifiedAt: email ? new Date() : undefined });
  console.log(`Created CRM Admin "${username}". Sign in on the CRM with this username.`);
  if (generated) console.log(`Password (shown once, change it after signing in): ${password}`);
}

main()
  .catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
