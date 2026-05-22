(function(){
function deckKeyFromState() {
  const map = {
    'Welsh – A1 Phrases': 'welsh_phrases_A1',
    'Welsh - A1 Phrases': 'welsh_phrases_A1',
    'welsh_a1': 'welsh_phrases_A1'
  };
  const saved = localStorage.getItem('fc_active_deck') || '';
  const id = (window.STATE && window.STATE.activeDeckId) || saved || '';
  return map[id] || id || 'welsh_phrases_A1';
}

const dk          = deckKeyFromState();
const progressKey = 'progress_' + dk;          // read/write here
const attemptsKey = 'tm_attempts_v1';          // global attempts bucket (unchanged)

(function migrateProgressIfNeeded(){
  const legacy = 'progress_' + ((window.STATE && STATE.activeDeckId) || '');
  if (legacy !== progressKey) {
    const legacyVal = localStorage.getItem(legacy);
    if (legacyVal && !localStorage.getItem(progressKey)) {
      localStorage.setItem(progressKey, legacyVal);
    }
  }
})();

async function loadDeckSorted(deckId){
  return await loadDeckRows(deckId || dk);
}

function loadProgressSeen(){
  try {
    const obj = JSON.parse(localStorage.getItem(progressKey) || '{"seen":{}}');
    const seen = obj.seen || {};
    let changed = false;
    Object.values(seen).forEach(entry => {
      const before = entry.interval;
      if (window.FC_SRS && FC_SRS.ensureInterval) {
        FC_SRS.ensureInterval(entry);
      }
      if (entry.interval !== before) changed = true;
    });
    if (changed) {
      localStorage.setItem(progressKey, JSON.stringify({ ...obj, seen }));
    }
    return seen;
  }
  catch { return {}; }
}

function loadAttempts(){
  try { return JSON.parse(localStorage.getItem(attemptsKey) || '{}'); }
  catch { return {}; }
}

function isActiveCard(id, seen, attempts){
  return !!(seen[id] || (attempts[id] && attempts[id].length));
}

const SCORE_COOLDOWN_MS = 60 * 60 * 1000; // 60 minutes
const SCORE_WINDOW = 10;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function lastNAccuracy(cardId, n = SCORE_WINDOW, map = loadAttempts()){
  const raw = map[cardId] || [];
  const scored = raw.filter(a => a.score !== false);
  const arr = scored.slice(-n);
  if (!arr.length) return 0;
  const p = arr.filter(a => a.pass).length;
  return Math.round((p / arr.length) * 100);
}

function logAttempt(cardId, pass){
  const obj = loadAttempts();
  const arr = obj[cardId] || [];
  const now = Date.now();
  let score = true;
  if (pass) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const a = arr[i];
      if (a.pass && a.score !== false) {
        if (now - a.ts < SCORE_COOLDOWN_MS) score = false;
        break;
      }
    }
  }
  arr.push({ ts: now, pass: !!pass, score });
  obj[cardId] = arr;
  localStorage.setItem(attemptsKey, JSON.stringify(obj));
}

async function renderReview(query) {
  // We keep 'mode' param but always start with Welsh front in flashcards
  const deckId = query.get('deck') && DECKS.some(d => d.id === query.get('deck'))
    ? query.get('deck') : STATE.activeDeckId;
  if (deckId !== STATE.activeDeckId) {
    setActiveDeck(deckId);
    const switching = document.createElement('div');
    switching.className = 'muted';
    switching.textContent = 'Switching deck...';
    return switching;
  }

  const dk = deckKeyFromState();
  const activeDeck = DECKS.find(d => d.id === dk);
  const deck = await loadDeckSorted(dk);
  const seen = loadProgressSeen();
  const attempts = loadAttempts();
  let cards = deck.filter(c => isActiveCard(c.id, seen, attempts));
  cards.forEach(c => { c.conf = lastNAccuracy(c.id, SCORE_WINDOW, attempts); });
  const groups = {};
  cards.forEach(c => (groups[c.conf] = groups[c.conf] || []).push(c));
  const confKeys = Object.keys(groups).map(Number).sort((a,b) => a - b);
  cards = confKeys.flatMap(conf => shuffle(groups[conf]));
  console.log('[active-count]', deckKeyFromState(), cards.length);
  console.log('[progress-key-used]', progressKey);
  recordEvent && recordEvent('session_started', { countDue: cards.length, countServed: cards.length });

  if (!cards.length) {
    const err = document.createElement('div');
    err.innerHTML = `<section class="learn-card is-flashcards"><div class="learn-card-header"><div class="lc-left"><img src="media/icons/Flashcards.png" alt="" class="lc-icon"><h2 class="lc-title">Flashcards</h2></div></div><div class="learn-card-content card--center">No introduced cards. Use New Phrases first.</div></section>`;
    return err;
  }

  // UI state
  let idx = 0;
  const startId = query.get('card');
  if (startId) {
    const i = cards.findIndex(c => c.id === startId);
    if (i >= 0) idx = i;
  }
  let showBack = false;   // front(Welsh) → back(English) in flash mode
  let isExpanded = false; // details panel state
  let isAnimating = false; // slide debounce

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <section class="learn-card is-flashcards">
      <div class="learn-card-header">
        <div class="lc-left"><img src="media/icons/Flashcards.png" alt="" class="lc-icon"><h2 class="lc-title">Flashcards</h2></div>
        <div class="lc-right"><button class="fc-expand-btn" id="detailToggle" aria-expanded="false" aria-controls="fcDetails" aria-label="Show details">+</button></div>
      </div>
      <div class="learn-card-content card--center">
        <div class="flashcard" id="flashcard">
        <div class="fc-stage fc-edge-hint" id="fcStage">

        <div class="fc-phrase">
          <div class="term" id="fcTerm" title="Tap to flip"></div>
        </div>

        <div class="fc-details" id="fcDetails" hidden tabindex="-1">
          <div class="phonetic" id="fcPhon"></div>
          <div class="translation" id="fcTrans"></div>
          <div class="breakdown" id="fcBreak"></div>
          <div class="usage" id="fcUsage"></div>
          <div class="example" id="fcExample"></div>
          <div class="patterns" id="fcPatterns"></div>
        </div>
        </div>

        <div class="flashcard-actions">
          <button class="btn nav-btn" id="prevBtn">Previous</button>
          <button class="btn nav-btn" id="nextBtn">Next</button>
          <a class="btn end-btn" href="#/phrases">End Session</a>
        </div>

        <div class="flashcard-progress muted" id="fcProg" aria-live="polite"></div>
        </div>
      </div>
    </section>
  `;

  const root       = wrap.querySelector('#flashcard');
  const stageEl    = wrap.querySelector('#fcStage');
  const termEl     = wrap.querySelector('#fcTerm');
  const phonEl     = wrap.querySelector('#fcPhon');
  const transEl    = wrap.querySelector('#fcTrans');
  const brkEl      = wrap.querySelector('#fcBreak');
  const useEl      = wrap.querySelector('#fcUsage');
  const exEl       = wrap.querySelector('#fcExample');
  const patEl      = wrap.querySelector('#fcPatterns');
  const detailsEl  = wrap.querySelector('#fcDetails');
  const expandBtn  = wrap.querySelector('#detailToggle');
  const prevBtn    = wrap.querySelector('#prevBtn');
  const nextBtn    = wrap.querySelector('#nextBtn');
  const progEl     = wrap.querySelector('#fcProg');

  // expand/collapse details
  const expanded = {};
  function applyExpand(expand, animate){
    expandBtn.textContent = expand ? '−' : '+';
    expandBtn.setAttribute('aria-label', expand ? 'Hide details' : 'Show details');
    expandBtn.setAttribute('aria-expanded', expand);
    isExpanded = expand;
    if (expand) {
      detailsEl.hidden = false;
      if (animate) {
        requestAnimationFrame(() => {
          detailsEl.style.maxHeight = '800px';
          detailsEl.style.opacity = '1';
        });
      } else {
        detailsEl.style.maxHeight = '800px';
        detailsEl.style.opacity = '1';
      }
    } else {
      if (animate) {
        detailsEl.style.maxHeight = '0';
        detailsEl.style.opacity = '0';
        detailsEl.addEventListener('transitionend', () => { detailsEl.hidden = true; }, { once: true });
      } else {
        detailsEl.style.maxHeight = '0';
        detailsEl.style.opacity = '0';
        detailsEl.hidden = true;
      }
    }
  }
  expandBtn.addEventListener('click', () => {
    const c = cards[idx];
    const now = !expanded[c.id];
    expanded[c.id] = now;
    applyExpand(now, true);
    if (now) detailsEl.focus();
  });

  // parsing helpers
  const parsePairs = s => (s ? s.split(',').map(x => x.trim()).filter(Boolean) : []);
  const parsePatterns = s => {
    if (!s) return [];
    // support '|', '/', or ',' as separators
    const sep = s.includes('|') ? '|' : (s.includes('/') ? '/' : ',');
    return s.split(sep).map(x => x.trim()).filter(Boolean);
  };


  // render card
  function renderCard() {
    const c = cards[idx];
    const expand = !!expanded[c.id];

    // phrase
    termEl.textContent = showBack ? c.back : c.front;

    // details
    phonEl.textContent = c.phonetic || '';
    transEl.textContent = c.back || '';

    // breakdown
    brkEl.innerHTML = '';
    if (c.word_breakdown) {
      const list = document.createElement('div');
      list.className = 'breakdown-list';
      parsePairs(c.word_breakdown).forEach(pair => {
        const chip = document.createElement('div');
        chip.className = 'chip';
        chip.textContent = pair;
        list.appendChild(chip);
      });
      brkEl.appendChild(list);
    }

    // usage
    useEl.textContent = c.usage_note || '';

    // example
    exEl.innerHTML = c.example ? `<div class="ex-welsh">${c.example}</div>` : '';

    // patterns — tap anywhere in the area to toggle English
    patEl.innerHTML = '';
    if (c.pattern_examples) {
      const normalize = s => (s || '').toLowerCase().trim();

      // Use your existing parsePatterns so separators stay consistent (/, or ,)
      const welshArr = parsePatterns(c.pattern_examples);
      const enArr    = parsePatterns(c.pattern_examples_en || '');

      // Pair up W/EN and exclude the current phrase
      const pairs = welshArr
        .map((w, i) => ({ w, e: enArr[i] || '' }))
        .filter(p =>
          normalize(p.w) !== normalize(c.front) &&
          normalize(p.w) !== normalize(c.back)
        );

      if (pairs.length) {
        // Header hint
        const hdr = document.createElement('div');
        hdr.className = 'muted';
        hdr.style.textAlign = 'center';
        hdr.style.fontSize = '12px';
        hdr.style.userSelect = 'none';
        hdr.textContent = STATE.showExamplesEN
          ? 'Related phrases (tap to hide English)'
          : 'Related phrases (tap to show English)';
        patEl.appendChild(hdr);

        // List
        const ul = document.createElement('ul');
        ul.className = 'patterns-list';
        ul.style.cursor = 'pointer';
        pairs.forEach(p => {
          const li = document.createElement('li');
          li.textContent =
            (STATE.showExamplesEN && p.e) ? `${p.w} — ${p.e}` : p.w;
          ul.appendChild(li);
        });
        patEl.appendChild(ul);

        // Tap anywhere in header or list to toggle EN
        const toggleEN = () => {
          setExamplesEN(!STATE.showExamplesEN); // persist + update state
          renderCard();                         // re-render this card
        };
        hdr.addEventListener('click', toggleEN);
        ul.addEventListener('click', toggleEN);
      }
    }

    // progress
    progEl.textContent = `Card ${idx + 1} of ${cards.length}`;

    // click-to-flip behaviour
    termEl.style.cursor = 'pointer';

    applyExpand(expand, false);
  }

  function navigate(dir, fromSwipe){
    if (isAnimating && !fromSwipe) return;
    isAnimating = true;

    const update = () => {
      idx = (idx + (dir === 1 ? 1 : -1) + cards.length) % cards.length;
      showBack = false;
      renderCard();
      stageEl.style.transition = 'none';
      stageEl.style.transform = `translateX(${dir === 1 ? 100 : -100}%)`;
      requestAnimationFrame(() => {
        stageEl.style.transition = 'transform 200ms ease-out, opacity 200ms ease-out';
        stageEl.style.transform = 'translateX(0)';
        stageEl.style.opacity = '1';
        stageEl.addEventListener('transitionend', () => {
          stageEl.style.transition = '';
          isAnimating = false;
        }, { once: true });
      });
    };

    if (fromSwipe) {
      update();
    } else {
      stageEl.classList.remove('swiping');
      stageEl.style.transition = 'transform 200ms ease-out, opacity 200ms ease-out';
      stageEl.style.transform = `translateX(${dir === 1 ? -100 : 100}%)`;
      stageEl.style.opacity = '0.9';
      stageEl.addEventListener('transitionend', update, { once: true });
    }
  }

  const goNext = () => navigate(1);
  const goPrev = () => navigate(-1);

  // initial render
  renderCard();

  // interactions
  termEl.addEventListener('click', () => {
    showBack = !showBack;
    renderCard();
  });
  nextBtn.addEventListener('click', goNext);
  prevBtn.addEventListener('click', goPrev);

  // swipe navigation
  let startX = 0, startY = 0, startT = 0, swiping = false;
  function onPointerDown(e){
    if (isAnimating || isExpanded) return;
    if (e.pointerType === 'mouse') return;
    if (e.target.closest('#detailToggle')) return;
    startX = e.clientX; startY = e.clientY; startT = Date.now(); swiping = false;
    stageEl.addEventListener('pointermove', onPointerMove, { passive: true });
    stageEl.addEventListener('pointerup', onPointerUp);
    stageEl.addEventListener('pointercancel', onPointerCancel);
  }
  function onPointerMove(e){
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!swiping){
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10){
        swiping = true;
        stageEl.classList.add('swiping');
        stageEl.removeEventListener('pointermove', onPointerMove);
        stageEl.addEventListener('pointermove', onPointerMove, { passive: false });
      } else { return; }
    }
    e.preventDefault();
    requestAnimationFrame(() => {
      const t = dx * 0.35;
      const dist = Math.abs(dx);
      const opacity = Math.max(0.9, 1 - dist / 1000);
      const scale = dist > 80 ? 0.995 : 1;
      stageEl.style.transform = `translateX(${t}px) scale(${scale})`;
      stageEl.style.opacity = String(opacity);
    });
  }
  function resetStage(){
    stageEl.classList.remove('swiping');
    stageEl.style.transition = 'transform 160ms ease, opacity 160ms ease';
    stageEl.style.transform = 'translateX(0)';
    stageEl.style.opacity = '1';
    stageEl.addEventListener('transitionend', () => { stageEl.style.transition = ''; }, { once: true });
  }
  function onPointerUp(e){
    stageEl.removeEventListener('pointermove', onPointerMove);
    stageEl.removeEventListener('pointerup', onPointerUp);
    stageEl.removeEventListener('pointercancel', onPointerCancel);
    if (!swiping){ return; }
    const dx = e.clientX - startX;
    const elapsed = Date.now() - startT;
    const absDx = Math.abs(dx);
    const success = absDx > 60 || (absDx > 30 && elapsed < 220);
    if (!success){ resetStage(); return; }
    isAnimating = true;
    const dir = dx < 0 ? 1 : -1;
    stageEl.classList.remove('swiping');
    stageEl.style.transition = 'transform 200ms ease-out, opacity 200ms ease-out';
    stageEl.style.transform = `translateX(${dir === 1 ? -100 : 100}%)`;
    stageEl.style.opacity = '0.9';
    stageEl.addEventListener('transitionend', () => navigate(dir, true), { once: true });
  }
  function onPointerCancel(){
    stageEl.removeEventListener('pointermove', onPointerMove);
    stageEl.removeEventListener('pointerup', onPointerUp);
    stageEl.removeEventListener('pointercancel', onPointerCancel);
    resetStage();
  }
  stageEl.addEventListener('pointerdown', onPointerDown);

  // keyboard (desktop convenience)
  window.onkeydown = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); goNext(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
    if (e.key?.toLowerCase() === 'f') { e.preventDefault(); termEl.click(); }
  };

  return wrap;
}
window.renderReview = renderReview;

/* Run All hook: fire completion when "End Session" is clicked in Review */
window.addEventListener('click', (e) => {
  const btn = e.target.closest('.end-btn, [data-action="end"], button, a');
  if (!btn) return;

  const label = (btn.getAttribute('aria-label') || btn.textContent || '')
    .trim().toLowerCase();

  const isEnd =
    btn.classList.contains('end-btn') ||
    btn.matches('[data-action="end"]') ||
    label === 'end session';

  if (!isEnd) return;

  // Tell the runner that Review finished
  window.dispatchEvent(
    new CustomEvent('fc:module-complete', { detail: { module: 'review' } })
  );
});


})();
