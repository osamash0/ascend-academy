/* Ensures every UI translation namespace has the same EN and DE key tree. */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'src', 'i18n', 'locales');

function keys(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

const enDir = path.join(root, 'en');
const deDir = path.join(root, 'de');
const files = new Set([...fs.readdirSync(enDir), ...fs.readdirSync(deDir)]);
const errors = [];
for (const file of files) {
  if (!file.endsWith('.json')) continue;
  const enPath = path.join(enDir, file);
  const dePath = path.join(deDir, file);
  if (!fs.existsSync(enPath) || !fs.existsSync(dePath)) {
    errors.push(`${file}: missing ${fs.existsSync(enPath) ? 'de' : 'en'} translation file`);
    continue;
  }
  const enKeys = new Set(keys(JSON.parse(fs.readFileSync(enPath, 'utf8'))));
  const deKeys = new Set(keys(JSON.parse(fs.readFileSync(dePath, 'utf8'))));
  for (const key of enKeys) if (!deKeys.has(key)) errors.push(`${file}: missing de key ${key}`);
  for (const key of deKeys) if (!enKeys.has(key)) errors.push(`${file}: missing en key ${key}`);
}
if (errors.length) {
  console.error('i18n parity check failed:\n' + errors.map((entry) => `- ${entry}`).join('\n'));
  process.exit(1);
}
console.log('i18n parity check passed');
