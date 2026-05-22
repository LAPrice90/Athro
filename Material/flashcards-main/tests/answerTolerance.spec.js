import path from 'node:path';
import { pathToFileURL } from 'node:url';

globalThis.window = globalThis;
globalThis.localStorage = {
  store: {},
  getItem(key) { return this.store[key] || null; },
  setItem(key, val) { this.store[key] = String(val); },
  removeItem(key) { delete this.store[key]; }
};

const utilsPath = pathToFileURL(path.resolve('js/utils.js')).href;
await import(`${utilsPath}?answer-tolerance-test=${Date.now()}`);

const { compareAnswers, equalsAnswerLoose } = globalThis.FC_UTILS;

function assert(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (err) {
    console.error('FAIL', name, err.message);
    process.exitCode = 1;
  }
}

assert('missing Welsh accent is accepted', () => {
  const result = compareAnswers('helo', 'Helô');
  if (!result.ok) throw new Error(JSON.stringify(result));
});

assert('apostrophes and spaces are flexible', () => {
  const result = compareAnswers('dwin hoffi coffi', "Dw i'n hoffi coffi");
  if (!result.ok) throw new Error(JSON.stringify(result));
});

assert('minor typo in a phrase is accepted', () => {
  const result = compareAnswers("Dw i'n hoffi cofi", "Dw i'n hoffi coffi");
  if (!result.ok || result.kind !== 'minor_typo') throw new Error(JSON.stringify(result));
});

assert('short words are not fuzzy matched', () => {
  const result = compareAnswers('ydy', 'ydw');
  if (result.ok) throw new Error(JSON.stringify(result));
});

assert('short accents are still accepted', () => {
  if (!equalsAnswerLoose('te', 'tê')) throw new Error('expected accent-insensitive pass');
});

assert('different Welsh phrase is rejected', () => {
  const result = compareAnswers("Dw i'n licio coffi", "Dw i'n hoffi coffi");
  if (result.ok) throw new Error(JSON.stringify(result));
});
