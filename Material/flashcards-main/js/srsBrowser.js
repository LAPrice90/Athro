(function(global){
  function startOfTodayISO(now){
    const d = new Date(now || new Date());
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  function addDaysISO(iso, days){
    const d = new Date(iso);
    d.setDate(d.getDate() + (days || 0));
    return d.toISOString();
  }

  function clampInterval(days){
    const n = Math.round(Number.isFinite(days) ? days : 1);
    return Math.max(1, Math.min(365, n || 1));
  }

  function clampEase(ease){
    const n = Number.isFinite(ease) ? ease : 2.5;
    return Math.max(1.3, Math.min(3.0, n));
  }

  function ensureInterval(card){
    if(!card) return card;
    card.interval = clampInterval(card.interval);
    return card;
  }

  function calcDueDateFromInterval(now, intervalDays){
    return addDaysISO(startOfTodayISO(now || new Date()), clampInterval(intervalDays));
  }

  function nextIntervalsForNew(){
    return [0, 1, 3, 7, 14, 30];
  }

  function applyIntroPath(card, stepIndex, opts){
    if(!card) throw new Error('Card required');
    const now = opts && opts.now ? opts.now : new Date();
    const steps = nextIntervalsForNew();
    const stepDays = steps[stepIndex] == null ? 0 : steps[stepIndex];
    card.interval = clampInterval(stepDays);
    card.dueDate = addDaysISO(startOfTodayISO(now), card.interval);
    card.ease = clampEase(card.ease);
    return card;
  }

  function scheduleNextReview(card, result, opts){
    if(!card) throw new Error('Card required');
    const now = opts && opts.now ? opts.now : new Date();
    const grace = !!(opts && opts.grace);
    ensureInterval(card);
    card.ease = clampEase(card.ease);

    let intervalDays = card.interval;
    if(result === 'fail'){
      intervalDays = Math.max(1, Math.round(intervalDays / 2));
      card.ease -= 0.20;
    }else if(result === 'hard'){
      card.ease -= 0.05;
    }else if(result === 'pass'){
      intervalDays = Math.round(intervalDays * card.ease);
      card.ease += 0.05;
    }else if(result === 'easy'){
      intervalDays = Math.round(intervalDays * card.ease * 1.5);
      card.ease += 0.10;
    }else{
      throw new Error('Invalid result');
    }

    card.ease = clampEase(card.ease);
    card.interval = clampInterval(intervalDays);
    const base = grace && card.dueDate ? new Date(card.dueDate) : new Date(now);
    card.dueDate = addDaysISO(startOfTodayISO(base), card.interval);
    card.reviews = Array.isArray(card.reviews) ? card.reviews : [];
    card.reviews.push({ date: new Date(now).toISOString(), result });
    return card;
  }

  function isDue(phrase, now){
    return !!(phrase && phrase.dueDate && new Date(phrase.dueDate) <= new Date(now || new Date()));
  }

  function getDuePhrases(all, now){
    return (all || [])
      .filter(item => isDue(item, now || new Date()))
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  }

  global.FC_SRS = {
    startOfTodayISO,
    addDaysISO,
    clampInterval,
    clampEase,
    ensureInterval,
    calcDueDateFromInterval,
    nextIntervalsForNew,
    applyIntroPath,
    scheduleNextReview,
    isDue,
    getDuePhrases,
    persistCard(){ /* Browser state is stored in progress_<deckId>, not fc:deck. */ }
  };
})(window);
