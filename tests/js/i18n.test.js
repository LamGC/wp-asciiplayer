import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import gettext from 'gettext-parser';

const po = gettext.po.parse(fs.readFileSync('languages/wp-asciiplayer-zh_CN.po'));
const mo = gettext.mo.parse(fs.readFileSync('languages/wp-asciiplayer-zh_CN.mo'));
const pot = gettext.po.parse(fs.readFileSync('languages/wp-asciiplayer.pot'));
const editor = JSON.parse(fs.readFileSync('languages/wp-asciiplayer-zh_CN-lamgc-asciiplayer-editor.json')).locale_data.messages;
const view = JSON.parse(fs.readFileSync('languages/wp-asciiplayer-zh_CN-lamgc-asciiplayer-view.json')).locale_data.messages;

test('all extracted strings and gettext contexts round-trip through MO and both script catalogs', () => {
  let count = 0;
  for (const [context, entries] of Object.entries(pot.translations)) {
    for (const entry of Object.values(entries)) {
      if (!entry.msgid) continue;
      count++;
      const translated = po.translations[context][entry.msgid].msgstr;
      assert.ok(translated[0]);
      assert.deepEqual(mo.translations[context][entry.msgid].msgstr, translated);
      const key = context ? `${context}\u0004${entry.msgid}` : entry.msgid;
      assert.deepEqual(editor[key], translated);
      assert.deepEqual(view[key], translated);
    }
  }
  assert.ok(count >= 75);
});

test('catalogs use Chinese plural rules, exact locale, and standard WordPress textdomain', () => {
  assert.equal(po.headers.language, 'zh_CN');
  assert.equal(mo.headers.language, 'zh_CN');
  assert.equal(editor[''].lang, 'zh_CN');
  assert.equal(editor[''].domain, 'wp-asciiplayer');
  assert.equal(editor['']['plural-forms'], 'nplurals=1; plural=0;');
  assert.equal(editor['block title\u0004Asciicast Player'][0], 'Asciicast 播放器');
  assert.equal(editor['Recording URL'][0], '录制文件 URL');
});

test('Unicode, punctuation, percentages and literal author content are preserved', () => {
  assert.equal(editor['Add a caption…'][0], '添加说明文字…');
  assert.match(editor['Use a CSS length, such as 480px or 65%. The player stays within its available space.'][0], /480px.*65%/);
  assert.equal(editor['Author caption / 作者说明'], undefined);
  const serialized = JSON.stringify(editor);
  assert.deepEqual(JSON.parse(serialized), editor);
});
