import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translations, tools } from '../src/i18n.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');

test('all referenced UI nodes have unique DOM IDs',()=>{
  const ids=[...html.matchAll(/\\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  for(const m of app.matchAll(/\\$\\('([^']+)'\\)/g))
    assert.ok(ids.includes(m[1]),'Missing DOM node '+m[1]);
});
test('all HTML translation keys exist in TR and EN',()=>{
  assert.deepEqual(Object.keys(translations.tr).sort(),Object.keys(translations.en).sort());
  for(const match of html.matchAll(/data-t(?:-aria)?="([^"]+)"/g)){
    assert.ok(match[1] in translations.tr,match[1]);
  }
  assert.equal(tools.length,6);
});
test('PDFForge does not upload the documents or add telemetry',()=>{
  assert.doesNotMatch(app,/fetch\\s*\\(|XMLHttpRequest|sendBeacon|WebSocket/);
  assert.match(html,/form-action 'none'/);
  assert.match(css,/@media\\(max-width:540px\\)/);
});
