(function(global) {
  'use strict';

  const APP_NAME = 'athro';
  const LEGACY_APP_NAMES = new Set(['siarad']);
  const BACKUP_VERSION = '1';
  const MAX_IMPORT_BYTES = 1024 * 1024;
  const LAST_EXPORT_KEY = 'fc_backup_last_export_at';
  const LAST_IMPORT_KEY = 'fc_backup_last_import_at';

  const EXACT_KEYS = new Set([
    'tm_attempts_v1',
    'tm_day_count',
    'tm_last_increment',
    'tm_session',
    'fc_active_deck',
    'fc_card_view_mode',
    'fc_examples_en',
    'graceMode',
    'siarad:worklist:v1'
  ]);

  const PREFIXES = [
    'progress_',
    'np_daily_'
  ];

  function byteLength(text) {
    const value = String(text || '');
    if (global.TextEncoder) return new global.TextEncoder().encode(value).length;
    return value.length;
  }

  function isSupportedKey(key) {
    return EXACT_KEYS.has(key) || PREFIXES.some(prefix => key.startsWith(prefix));
  }

  function getStorageKeys(storage) {
    const keys = [];
    if (!storage) return keys;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key) keys.push(key);
    }
    return keys;
  }

  function collectItems(storage = global.localStorage) {
    const items = {};
    getStorageKeys(storage)
      .filter(isSupportedKey)
      .sort()
      .forEach(key => {
        const value = storage.getItem(key);
        if (typeof value === 'string') items[key] = value;
      });
    return items;
  }

  function getLocalISODate(now = new Date()) {
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function createBackup(options = {}) {
    const storage = options.storage || global.localStorage;
    const now = options.now || new Date();
    const sourceUrl = options.sourceUrl ||
      (global.location && global.location.href ? global.location.href : '');
    return {
      app: APP_NAME,
      version: BACKUP_VERSION,
      exportedAt: now.toISOString(),
      sourceUrl,
      items: collectItems(storage)
    };
  }

  function backupFilename(now = new Date()) {
    return `athro-progress-${getLocalISODate(now)}.json`;
  }

  function isAcceptedAppName(appName) {
    return appName === APP_NAME || LEGACY_APP_NAMES.has(appName);
  }

  function validateBackupObject(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Backup must be a JSON object.');
    }
    if (!isAcceptedAppName(data.app)) {
      throw new Error('This is not an Athro progress backup.');
    }
    if (data.version !== BACKUP_VERSION) {
      throw new Error('This backup version is not supported.');
    }
    if (!data.items || typeof data.items !== 'object' || Array.isArray(data.items)) {
      throw new Error('Backup is missing progress items.');
    }
    Object.entries(data.items).forEach(([key, value]) => {
      if (!isSupportedKey(key)) {
        throw new Error(`Backup contains an unsupported key: ${key}`);
      }
      if (typeof value !== 'string') {
        throw new Error(`Backup value must be text for key: ${key}`);
      }
    });
    return data;
  }

  function parseBackupText(text) {
    if (byteLength(text) > MAX_IMPORT_BYTES) {
      throw new Error('Backup file is too large.');
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Backup file is not valid JSON.');
    }
    return validateBackupObject(parsed);
  }

  function clearSupportedItems(storage = global.localStorage) {
    getStorageKeys(storage).forEach(key => {
      if (isSupportedKey(key)) storage.removeItem(key);
    });
  }

  function restoreItems(items, storage = global.localStorage) {
    validateBackupObject({
      app: APP_NAME,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      sourceUrl: '',
      items
    });
    clearSupportedItems(storage);
    Object.entries(items).forEach(([key, value]) => {
      storage.setItem(key, value);
    });
    return Object.keys(items).length;
  }

  function restoreBackup(backup, options = {}) {
    const storage = options.storage || global.localStorage;
    const valid = validateBackupObject(backup);
    const count = restoreItems(valid.items, storage);
    storage.setItem(LAST_IMPORT_KEY, new Date().toISOString());
    return { count };
  }

  function downloadBackup(backup, filename = backupFilename()) {
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function formatTime(iso) {
    if (!iso) return 'never';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    try {
      return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return date.toLocaleString();
    }
  }

  function getActiveCounts(decks = [], loadProgress) {
    if (!Array.isArray(decks) || typeof loadProgress !== 'function') return [];
    return decks.map(deck => {
      const progress = loadProgress(deck.id) || {};
      const count = Object.keys(progress.seen || {}).length;
      return `${deck.name}: ${count}`;
    });
  }

  function getBackupStatus(options = {}) {
    const storage = options.storage || global.localStorage;
    return {
      mode: 'Local progress only',
      activeCounts: getActiveCounts(options.decks, options.loadProgress),
      lastExport: storage ? storage.getItem(LAST_EXPORT_KEY) : '',
      lastImport: storage ? storage.getItem(LAST_IMPORT_KEY) : '',
      itemCount: Object.keys(collectItems(storage)).length
    };
  }

  function renderStatus(statusEl, options = {}) {
    const status = getBackupStatus(options);
    const counts = status.activeCounts.length ? status.activeCounts.join(' | ') : 'No active cards yet';
    statusEl.textContent = [
      status.mode,
      counts,
      `saved items: ${status.itemCount}`,
      `last export: ${formatTime(status.lastExport)}`,
      `last import: ${formatTime(status.lastImport)}`
    ].join(' | ');
  }

  function buildSettingsPanel(options = {}) {
    const panel = document.createElement('div');
    panel.className = 'progress-backup-panel';
    panel.innerHTML = `
      <div class="progress-backup-actions">
        <button class="btn" type="button" data-backup-export>Export Progress</button>
        <button class="btn" type="button" data-backup-import>Import Progress</button>
        <input type="file" accept=".json,application/json" data-backup-file hidden>
      </div>
      <div class="backup-status muted" aria-live="polite"></div>
    `;

    const storage = options.storage || global.localStorage;
    const statusEl = panel.querySelector('.backup-status');
    const exportBtn = panel.querySelector('[data-backup-export]');
    const importBtn = panel.querySelector('[data-backup-import]');
    const fileInput = panel.querySelector('[data-backup-file]');
    const statusOptions = { ...options, storage };

    renderStatus(statusEl, statusOptions);

    exportBtn.addEventListener('click', () => {
      try {
        const now = new Date();
        const backup = createBackup({ storage, now });
        downloadBackup(backup, backupFilename(now));
        storage.setItem(LAST_EXPORT_KEY, now.toISOString());
        renderStatus(statusEl, statusOptions);
      } catch (error) {
        statusEl.textContent = error.message || 'Export failed.';
      }
    });

    importBtn.addEventListener('click', () => {
      fileInput.value = '';
      fileInput.click();
    });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        if (file.size > MAX_IMPORT_BYTES) {
          throw new Error('Backup file is too large.');
        }
        const backup = parseBackupText(await file.text());
        const count = Object.keys(backup.items).length;
        const ok = !global.confirm ||
          global.confirm(`Import ${count} saved progress items and replace current app progress?`);
        if (!ok) {
          statusEl.textContent = 'Import cancelled.';
          return;
        }
        restoreBackup(backup, { storage });
        statusEl.textContent = `Imported ${count} items. Reloading...`;
        setTimeout(() => {
          if (global.location && typeof global.location.reload === 'function') {
            global.location.reload();
          }
        }, 250);
      } catch (error) {
        statusEl.textContent = error.message || 'Import failed.';
      }
    });

    return panel;
  }

  global.FC_PROGRESS_BACKUP = {
    APP_NAME,
    BACKUP_VERSION,
    MAX_IMPORT_BYTES,
    backupFilename,
    isSupportedKey,
    collectItems,
    createBackup,
    parseBackupText,
    restoreItems,
    restoreBackup,
    getBackupStatus,
    buildSettingsPanel
  };
})(typeof window !== 'undefined' ? window : globalThis);
