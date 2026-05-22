import path from 'node:path';
import { pathToFileURL } from 'node:url';

function makeStorage(initial = {}) {
  const store = { ...initial };
  return {
    store,
    get length() {
      return Object.keys(store).length;
    },
    key(index) {
      return Object.keys(store)[index] || null;
    },
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    }
  };
}

function assert(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (err) {
    console.error('FAIL', name, err.message);
    process.exitCode = 1;
  }
}

function assertThrows(name, fn, text) {
  assert(name, () => {
    try {
      fn();
    } catch (err) {
      if (!String(err.message).includes(text)) {
        throw new Error(`expected "${text}", got "${err.message}"`);
      }
      return;
    }
    throw new Error('expected an error');
  });
}

globalThis.window = globalThis;
globalThis.localStorage = makeStorage();

const backupPath = pathToFileURL(path.resolve('js/progressBackup.js')).href;
await import(`${backupPath}?progress-backup-test=${Date.now()}`);

const backup = globalThis.FC_PROGRESS_BACKUP;

assert('collectItems includes supported keys and excludes unrelated keys', () => {
  const storage = makeStorage({
    progress_welsh_homework: '{"seen":{"A1-1-901":{}}}',
    progress_welsh_phrases_A1: '{"seen":{}}',
    tm_attempts_v1: '{"A1-1-901":[{"pass":true}]}',
    tm_day_count: '3',
    tm_last_increment: '2026-05-22',
    tm_session: '{"done":[]}',
    fc_active_deck: 'welsh_homework',
    fc_card_view_mode: 'flash',
    fc_examples_en: 'true',
    graceMode: 'true',
    'siarad:worklist:v1': '{}',
    np_daily_welsh_homework: '{"remaining":2}',
    gh_token: 'secret',
    random_setting: 'keep out'
  });
  const items = backup.collectItems(storage);
  if (!items.progress_welsh_homework) throw new Error('missing progress');
  if (!items.tm_attempts_v1) throw new Error('missing attempts');
  if (!items.np_daily_welsh_homework) throw new Error('missing daily allowance');
  if (items.gh_token) throw new Error('included gh_token');
  if (items.random_setting) throw new Error('included unrelated key');
});

assert('createBackup wraps collected progress with schema fields', () => {
  const storage = makeStorage({ progress_welsh_homework: '{"seen":{}}' });
  const data = backup.createBackup({
    storage,
    now: new Date('2026-05-22T10:00:00Z'),
    sourceUrl: 'https://example.test/app'
  });
  if (data.app !== 'siarad') throw new Error('wrong app');
  if (data.version !== '1') throw new Error('wrong version');
  if (data.exportedAt !== '2026-05-22T10:00:00.000Z') throw new Error('wrong exportedAt');
  if (data.sourceUrl !== 'https://example.test/app') throw new Error('wrong sourceUrl');
  if (!data.items.progress_welsh_homework) throw new Error('missing item');
});

assertThrows('parseBackupText rejects invalid JSON', () => {
  backup.parseBackupText('{');
}, 'valid JSON');

assertThrows('parseBackupText rejects wrong app name', () => {
  backup.parseBackupText(JSON.stringify({ app: 'other', version: '1', items: {} }));
}, 'not a Siarad');

assertThrows('parseBackupText rejects unsupported version', () => {
  backup.parseBackupText(JSON.stringify({ app: 'siarad', version: '2', items: {} }));
}, 'version');

assertThrows('parseBackupText rejects missing items', () => {
  backup.parseBackupText(JSON.stringify({ app: 'siarad', version: '1' }));
}, 'missing progress items');

assertThrows('parseBackupText rejects oversized files', () => {
  backup.parseBackupText('x'.repeat(backup.MAX_IMPORT_BYTES + 1));
}, 'too large');

assertThrows('parseBackupText rejects unsupported keys', () => {
  backup.parseBackupText(JSON.stringify({
    app: 'siarad',
    version: '1',
    items: { random_setting: 'bad' }
  }));
}, 'unsupported key');

assert('restoreBackup replaces supported keys and preserves unrelated storage', () => {
  const storage = makeStorage({
    progress_old: '{"seen":{"old":{}}}',
    tm_attempts_v1: '{"old":[]}',
    unrelated: 'keep'
  });
  const data = backup.parseBackupText(JSON.stringify({
    app: 'siarad',
    version: '1',
    exportedAt: '2026-05-22T10:00:00.000Z',
    sourceUrl: 'https://example.test/app',
    items: {
      progress_welsh_homework: '{"seen":{"A1-1-901":{"seenCount":1}}}',
      tm_attempts_v1: '{"A1-1-901":[{"pass":true,"score":true}]}'
    }
  }));
  const result = backup.restoreBackup(data, { storage });
  if (result.count !== 2) throw new Error('wrong restore count');
  if (storage.getItem('progress_old') !== null) throw new Error('old supported key remained');
  if (!storage.getItem('progress_welsh_homework').includes('A1-1-901')) throw new Error('progress not restored');
  if (!storage.getItem('tm_attempts_v1').includes('pass')) throw new Error('attempts not restored');
  if (storage.getItem('unrelated') !== 'keep') throw new Error('unrelated key changed');
});
