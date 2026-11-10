// Ask Muse for build ideas. Usage:
//   npm run ideas -- "the challenge prompt they reveal in the room"
// Reads OPENROUTER_API_KEY from your shell or .env.local. Prints to the terminal.
import { readFileSync, existsSync } from 'node:fs';
import { chatJson, hasKey, loadPrompt, models } from '../server/openrouter.mjs';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
if (!hasKey()) {
  console.error('Set OPENROUTER_API_KEY first (see RUN-SHEET.md).');
  process.exit(1);
}
const challenge = process.argv.slice(2).join(' ') || '(not revealed yet: give ideas that fit a creative, open-ended prompt)';
const prompt = (await loadPrompt(process.cwd(), 'ideas.md')).replace('{{CHALLENGE}}', challenge);
const { json, model, ms } = await chatJson({
  model: process.env.IDEAS_MODEL || models().designer,
  system:
    'Return ONE JSON object: {"ideas": [{"name": string, "experience": string, "change": string, "demo": string}], "pick": string, "why": string}',
  user: prompt,
});
console.log(`\n${model} (${(ms / 1000).toFixed(1)}s)\n`);
for (const [i, idea] of (json.ideas ?? []).entries()) {
  console.log(`${i + 1}. ${idea.name}\n   ${idea.experience}\n   change: ${idea.change}\n   demo:   ${idea.demo}\n`);
}
if (json.pick) console.log(`Muse's pick: ${json.pick}. ${json.why ?? ''}\n`);
