(function(global){
  const BUCKETS = {
    NEW: 'NEW',
    STRUGGLING: 'STRUGGLING',
    NEEDS_REVIEW: 'NEEDS_REVIEW',
    MASTERED: 'MASTERED'
  };

  const BUCKET_LABELS = {
    NEW: 'New',
    STRUGGLING: 'Struggling',
    NEEDS_REVIEW: 'Needs review',
    MASTERED: 'Mastered'
  };

  function getLocalISODate(){
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function getBucket(card){
    const {
      introducedAt,
      attempts = 0,
      accuracyPct = 0
    } = card || {};

    if(!introducedAt) return null;
    if(attempts === 0) return BUCKETS.NEW;
    if(accuracyPct < 50) return BUCKETS.STRUGGLING;
    if(accuracyPct < 80) return BUCKETS.NEEDS_REVIEW;
    return BUCKETS.MASTERED;
  }

  const ALLOW_PREFIX = 'siarad:newAllowance:';
  let capLogged = false;
  function readAllowance(){
    const today = getLocalISODate();
    const key = ALLOW_PREFIX + today;
    let data;
    try{ data = JSON.parse(localStorage.getItem(key) || '{}'); }catch{}
    const base = (global.SETTINGS && global.SETTINGS.newPerDay) || 5;
    if(!data || data.lastDate !== today || typeof data.remaining !== 'number'){
      data = { remaining: base, lastDate: today };
      localStorage.setItem(key, JSON.stringify(data));
    }
    if(!capLogged){
      console.info(`New cap today: ${data.remaining}/${base}`);
      capLogged = true;
    }
    data.key = key;
    return data;
  }
  function saveAllowance(data){
    localStorage.setItem(data.key, JSON.stringify({ remaining: data.remaining, lastDate: data.lastDate }));
  }

  function getDailyNewAllowance(unseenCount=0, strugglingCount=0){
    const state = readAllowance();
    const base = (global.SETTINGS && global.SETTINGS.newPerDay) || 5;
    const cap = (global.STRUGGLE_CAP || 10);
    const factor = Math.max(0, Math.min(1, (cap - strugglingCount) / cap));
    const baseAllowed = Math.floor(base * factor);
    const allowed = Math.min(state.remaining, baseAllowed, unseenCount, base);
    return { allowed, remaining: state.remaining, baseAllowed };
  }

  function consumeNewAllowance(){
    const state = readAllowance();
    if(state.remaining > 0){
      state.remaining -= 1;
      saveAllowance(state);
      console.info(`New item introduced; remaining now ${state.remaining}`);
    }
  }

  function peekAllowance(){
    const state = readAllowance();
    return { remaining: state.remaining };
  }

  function clampInterval(n){
    n = typeof n === 'number' ? Math.round(n) : 1;
    if(n < 1) n = 1;
    if(n > 365) n = 365;
    return n;
  }

  function calcDueDate(intervalDays){
    if(global.FC_SRS && global.FC_SRS.calcDueDateFromInterval){
      return FC_SRS.calcDueDateFromInterval(new Date(), intervalDays);
    }
    const d = new Date();
    d.setUTCHours(0,0,0,0);
    d.setUTCDate(d.getUTCDate() + (typeof intervalDays === 'number' ? intervalDays : 1));
    return d.toISOString();
  }

  function normalizeAnswerText(value){
    if(!value) return '';
    return String(value)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u2019\u2018]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2026/g, '...')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compactAnswerText(value){
    return normalizeAnswerText(value).replace(/\s+/g, '');
  }

  function levenshteinDistance(a, b){
    const m = a.length;
    const n = b.length;
    if(!m) return n;
    if(!n) return m;
    const prev = new Array(n + 1);
    const cur = new Array(n + 1);
    for(let j = 0; j <= n; j++) prev[j] = j;
    for(let i = 1; i <= m; i++){
      cur[0] = i;
      const ai = a.charCodeAt(i - 1);
      for(let j = 1; j <= n; j++){
        const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      for(let j = 0; j <= n; j++) prev[j] = cur[j];
    }
    return prev[n];
  }

  function answerTypoTolerance(length){
    if(length < 6) return 0;
    if(length < 10) return 1;
    if(length < 18) return 2;
    return Math.min(3, Math.floor(length / 8));
  }

  function compareAnswers(userAnswer, expectedAnswer){
    const userSpaced = normalizeAnswerText(userAnswer);
    const expectedSpaced = normalizeAnswerText(expectedAnswer);
    const userCompact = userSpaced.replace(/\s+/g, '');
    const expectedCompact = expectedSpaced.replace(/\s+/g, '');

    if(!userCompact || !expectedCompact){
      return {
        ok: false,
        kind: 'empty',
        distance: null,
        tolerance: 0,
        normalizedUser: userSpaced,
        normalizedExpected: expectedSpaced
      };
    }

    if(userSpaced === expectedSpaced){
      return {
        ok: true,
        kind: 'exact_or_accent',
        distance: 0,
        tolerance: 0,
        normalizedUser: userSpaced,
        normalizedExpected: expectedSpaced
      };
    }

    if(userCompact === expectedCompact){
      return {
        ok: true,
        kind: 'spacing_or_punctuation',
        distance: 0,
        tolerance: 0,
        normalizedUser: userSpaced,
        normalizedExpected: expectedSpaced
      };
    }

    const length = Math.max(userCompact.length, expectedCompact.length);
    const tolerance = answerTypoTolerance(length);
    const distance = levenshteinDistance(userCompact, expectedCompact);
    return {
      ok: tolerance > 0 && distance <= tolerance,
      kind: tolerance > 0 && distance <= tolerance ? 'minor_typo' : 'miss',
      distance,
      tolerance,
      normalizedUser: userSpaced,
      normalizedExpected: expectedSpaced
    };
  }

  function equalsAnswerLoose(userAnswer, expectedAnswer){
    return compareAnswers(userAnswer, expectedAnswer).ok;
  }

  function deckKeyFromState(){
    const map = {
      'Welsh – A1 Phrases': 'welsh_phrases_A1',
      'Welsh - A1 Phrases': 'welsh_phrases_A1',
      'welsh_a1': 'welsh_phrases_A1'
    };
    const saved = global.localStorage ? global.localStorage.getItem('fc_active_deck') || '' : '';
    const id = (global.STATE && global.STATE.activeDeckId) || saved || '';
    return map[id] || id || 'welsh_phrases_A1';
  }

  function logReview(phrase, result){
    const id = typeof phrase === 'string' ? phrase : phrase && phrase.id;
    if(!id) return;
    const progressKey = 'progress_' + deckKeyFromState();
    let prog;
    try{ prog = JSON.parse(localStorage.getItem(progressKey) || '{"seen":{}}'); }
    catch{ prog = { seen:{} }; }
    const seen = prog.seen || {};
    const entry = seen[id] || {};
    const reviews = entry.reviews || [];
    reviews.push({ date: new Date().toISOString(), result });
    entry.reviews = reviews;
    const n = typeof entry.interval === 'number' ? entry.interval : 1;
    entry.interval = clampInterval(n);
    entry.dueDate = calcDueDate(entry.interval);
    seen[id] = entry;
    prog.seen = seen;
    localStorage.setItem(progressKey, JSON.stringify(prog));
  }

  global.FC_UTILS = {
    BUCKETS,
    BUCKET_LABELS,
    getBucket,
    getLocalISODate,
    getDailyNewAllowance,
    consumeNewAllowance,
    peekAllowance,
    clampInterval,
    calcDueDate,
    normalizeAnswerText,
    compactAnswerText,
    levenshteinDistance,
    answerTypoTolerance,
    compareAnswers,
    equalsAnswerLoose
  };

  global.logReview = logReview;
})(window);
