/** Deterministic gettext catalogs. English msgids are the en_US fallback. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parse } from '@babel/parser';
import gettext from 'gettext-parser';

const domain = 'wp-asciiplayer';
const version = JSON.parse(fs.readFileSync('package.json')).version;
const entries = new Map();
function add(msgid, context, file, line) {
  assert.equal(typeof msgid, 'string', `Static gettext string required: ${file}:${line}`);
  const key = `${context || ''}\u0004${msgid}`;
  if (!entries.has(key)) entries.set(key, { msgid, msgctxt: context || undefined, msgstr: [''], comments: { reference: '' } });
  const entry = entries.get(key);
  entry.comments.reference += `${entry.comments.reference ? '\n' : ''}${file}:${line}`;
}
function walk(node, file) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'CallExpression' && ['__', '_x', '_n', '_nx'].includes(node.callee?.name)) {
    const name = node.callee.name;
    assert.ok(['__', '_x'].includes(name), `Add plural extraction before using ${name}: ${file}`);
    const args = node.arguments;
    assert.equal(args[name === '__' ? 1 : 2]?.value, domain, `Explicit textdomain required: ${file}`);
    assert.equal(args[0]?.type, 'StringLiteral', `Literal gettext message required: ${file}`);
    if (name === '_x') assert.equal(args[1]?.type, 'StringLiteral');
    add(args[0].value, name === '_x' ? args[1].value : '', file, node.loc.start.line);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child, file);
    else if (value && typeof value === 'object') walk(value, file);
  }
}
for (const file of fs.readdirSync('src').filter((name) => name.endsWith('.js')).map((name) => `src/${name}`)) {
  walk(parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] }), file);
}
for (const file of ['asciicast-player.php', ...fs.readdirSync('includes').filter((name) => name.endsWith('.php')).map((name) => `includes/${name}`)]) {
  const source = fs.readFileSync(file, 'utf8');
  const calls = [...source.matchAll(/\b__\s*\(/g)];
  const matches = [...source.matchAll(/\b__\(\s*'((?:\\.|[^'\\])*)'\s*,\s*'wp-asciiplayer'\s*\)/g)];
  assert.equal(matches.length, calls.length, `Unsupported PHP gettext syntax in ${file}; extend extractor first.`);
  assert.ok(!/\b(?:_x|_n|_nx|_e|esc_html__|esc_attr__)\s*\(/.test(source), `Extend PHP extractor for new gettext functions: ${file}`);
  for (const match of matches) add(match[1].replace(/\\(['\\])/g, '$1'), '', file, source.slice(0, match.index).split('\n').length);
}
const pluginHeader = fs.readFileSync('asciicast-player.php', 'utf8');
for (const label of ['Plugin Name', 'Description']) {
  const value = pluginHeader.match(new RegExp(` \* ${label}: (.+)`))?.[1];
  if (value) add(value, '', 'asciicast-player.php', 1);
}
const metadata = JSON.parse(fs.readFileSync('block.json'));
for (const [field, context] of [['title', 'block title'], ['description', 'block description'], ['keywords', 'block keyword']]) {
  for (const value of [].concat(metadata[field])) add(value, context, 'block.json', 1);
}
const headers = { 'project-id-version': `${domain} ${version}`, 'mime-version': '1.0', 'content-type': 'text/plain; charset=UTF-8', 'content-transfer-encoding': '8bit', 'x-domain': domain };
const pot = { charset: 'utf-8', headers, translations: { '': {} } };
for (const entry of [...entries.values()].sort((a, b) => `${a.msgctxt || ''}\u0004${a.msgid}`.localeCompare(`${b.msgctxt || ''}\u0004${b.msgid}`, 'en'))) {
  const context = entry.msgctxt || '';
  (pot.translations[context] ||= {})[entry.msgid] = entry;
}
fs.mkdirSync('languages', { recursive: true });
const output = new Map([['languages/wp-asciiplayer.pot', gettext.po.compile(pot)]]);
if (!process.argv.includes('--pot-only')) {
  const po = gettext.po.parse(fs.readFileSync('languages/wp-asciiplayer-zh_CN.po'));
  assert.equal(po.headers.language, 'zh_CN');
  assert.match(po.headers['plural-forms'], /^nplurals=1;\s*plural=0;$/);
  const messages = { '': { domain, lang: 'zh_CN', 'plural-forms': 'nplurals=1; plural=0;' } };
  for (const entry of entries.values()) {
    const translation = po.translations[entry.msgctxt || '']?.[entry.msgid];
    assert.ok(translation?.msgstr?.[0], `Missing zh_CN translation: ${entry.msgid}`);
    assert.ok(!translation.comments?.flag?.includes('fuzzy'), `Fuzzy translation: ${entry.msgid}`);
    assert.ok(!translation.msgid_plural && translation.msgstr.length === 1, `Unexpected plural: ${entry.msgid}`);
    const placeholders = (text) => [...text.matchAll(/%(?:\d+\$)?[sdif]/g)].map((match) => match[0]).sort();
    assert.deepEqual(placeholders(translation.msgstr[0]), placeholders(entry.msgid), `Placeholder mismatch: ${entry.msgid}`);
    messages[entry.msgctxt ? `${entry.msgctxt}\u0004${entry.msgid}` : entry.msgid] = translation.msgstr;
  }
  output.set('languages/wp-asciiplayer-zh_CN.mo', gettext.mo.compile(po));
  const json = `${JSON.stringify({ domain, locale_data: { messages } }, null, 2)}\n`;
  for (const handle of ['lamgc-asciiplayer-editor', 'lamgc-asciiplayer-view']) output.set(`languages/wp-asciiplayer-zh_CN-${handle}.json`, json);
}
for (const [file, content] of output) {
  if (process.argv.includes('--check')) assert.deepEqual(fs.readFileSync(file), Buffer.from(content), `Stale catalog: ${file}; run npm run i18n.`);
  else fs.writeFileSync(file, content);
}
console.log(`Verified ${entries.size} gettext entries; ${output.size} reproducible artifacts${process.argv.includes('--check') ? ' checked' : ' written'}.`);
