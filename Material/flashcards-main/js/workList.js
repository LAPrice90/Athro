(function(){
  const STORE_KEY = 'siarad:worklist:v1';

  function localDate(){
    return FC_UTILS.getLocalISODate ? FC_UTILS.getLocalISODate() : todayKey();
  }

  function readState(){
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
    catch { return {}; }
  }

  function writeState(state){
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    window.fcSaveCloud && window.fcSaveCloud();
  }

  let plannerCache = null;

  async function loadPlannerPlan(){
    if(plannerCache !== null) return plannerCache;
    try {
      const res = await fetch('data/daily_plan.json', { cache: 'no-cache' });
      if(!res.ok) {
        plannerCache = false;
        return null;
      }
      const plan = await res.json();
      plannerCache = plan && plan.date === localDate() ? plan : false;
      return plannerCache || null;
    } catch {
      plannerCache = false;
      return null;
    }
  }

  function isDoneToday(state, taskId, date){
    return !!(state[taskId] && state[taskId].doneDate === date);
  }

  function setDone(taskId, done){
    const state = readState();
    if(done){
      state[taskId] = {
        doneDate: localDate(),
        doneAt: new Date().toISOString()
      };
    }else{
      delete state[taskId];
    }
    writeState(state);
  }

  async function getTodayWorkItems(){
    const plannerPlan = await loadPlannerPlan();
    if(plannerPlan && Array.isArray(plannerPlan.tasks)){
      const liveDueCount = await fcGetTestQueueCount();
      return plannerPlan.tasks.map(task => {
        const isReview = task.id === 'review';
        return {
          id: task.id,
          type: task.type || 'Task',
          title: task.title || task.id,
          detail: isReview && liveDueCount > 0
            ? `${liveDueCount} due card${liveDueCount === 1 ? '' : 's'} in the app. ${task.detail || ''}`.trim()
            : task.detail || '',
          route: task.route || '#/worklist',
          deck: task.deck || '',
          count: task.count || 1,
          canAutoPass: isReview && liveDueCount === 0,
          required: task.required !== false,
          status: task.status || 'planned'
        };
      });
    }

    const activeDeck = deckKeyFromState();
    const dueCount = await fcGetTestQueueCount();
    const rows = await loadDeckRows(activeDeck);
    const prog = loadProgress(activeDeck);
    const attempts = loadAttemptsMap();
    const seen = prog.seen || {};
    const activeCount = rows.filter(r => seen[r.id] || (attempts[r.id] && attempts[r.id].length)).length;
    const unseenCount = rows.length - activeCount;
    const homeworkDeck = DECKS.find(d => d.id === 'welsh_homework');

    return [
      {
        id: 'review',
        type: 'Review',
        title: 'Warm-up review',
        detail: dueCount > 0 ? `${dueCount} due card${dueCount === 1 ? '' : 's'}` : 'No due cards yet',
        route: '#/test',
        count: dueCount,
        canAutoPass: dueCount === 0
      },
      {
        id: 'new-pattern',
        type: 'Pattern',
        title: 'One Unit 1 pattern',
        detail: unseenCount > 0 ? 'Learn one small phrase family' : 'All cards in this deck are active',
        route: '#/newPhrase',
        count: Math.min(unseenCount, 1)
      },
      {
        id: 'homework-cards',
        type: 'Cards',
        title: 'Homework cards',
        detail: homeworkDeck ? 'Pass 5 cards from Welsh Homework' : 'Welsh Homework deck missing',
        route: '#/newPhrase',
        deck: 'welsh_homework',
        count: 5
      },
      {
        id: 'listening-unit-1',
        type: 'Listening',
        title: 'Unit 1 audio',
        detail: 'Listen once before or after the lesson',
        route: '#/worklist',
        count: 1
      },
      {
        id: 'log',
        type: 'Log',
        title: 'Progress note',
        detail: 'Record pass, partial pass, or repeat',
        route: '#/worklist',
        count: 1
      }
    ];
  }

  async function renderWorkList(){
    const date = localDate();
    const state = readState();
    const plannerPlan = await loadPlannerPlan();
    const tasks = await getTodayWorkItems();
    const doneCount = tasks.filter(t => isDoneToday(state, t.id, date) || t.canAutoPass).length;
    const scenario = plannerPlan ? (plannerPlan.scenario || 'planned') : 'live';
    const unit = plannerPlan ? plannerPlan.current_unit : 1;
    const wrap = document.createElement('div');
    wrap.className = 'worklist-page';
    wrap.innerHTML = `
      <div class="page-header worklist-header">
        <div class="ph-main">
          <div class="ph-left">
            <img src="media/icons/flag.png" alt="" class="ph-icon">
            <h1 class="ph-title">Today</h1>
          </div>
          <span class="worklist-score">${doneCount}/${tasks.length}</span>
        </div>
        <div class="ph-chips">
          <span class="ph-chip">Entry</span>
          <span class="ph-chip">South Wales</span>
          <span class="ph-chip">Unit ${escapeHTML(unit)}</span>
          <span class="ph-chip">${escapeHTML(scenario)}</span>
        </div>
      </div>
      <section class="worklist-grid"></section>
    `;

    const grid = wrap.querySelector('.worklist-grid');
    tasks.forEach(task => {
      const done = isDoneToday(state, task.id, date) || task.canAutoPass;
      const item = document.createElement('article');
      item.className = `work-item${done ? ' is-done' : ''}`;
      item.innerHTML = `
        <div class="work-item-main">
          <div class="work-type">${escapeHTML(task.type)}</div>
          <h2>${escapeHTML(task.title)}</h2>
          <p>${escapeHTML(task.detail)}</p>
        </div>
        <div class="work-item-actions">
          ${task.route === '#/worklist' ? '' : `<a class="btn work-open" href="${task.route}">Open</a>`}
          <button class="btn work-done" data-task="${escapeHTML(task.id)}">${done ? 'Done' : 'Mark done'}</button>
        </div>
      `;
      const openLink = item.querySelector('.work-open');
      if(openLink && task.deck){
        openLink.addEventListener('click', event => {
          event.preventDefault();
          localStorage.setItem('fc_active_deck', task.deck);
          location.hash = task.route;
          location.reload();
        });
      }
      const button = item.querySelector('.work-done');
      button.disabled = !!task.canAutoPass;
      button.addEventListener('click', () => {
        setDone(task.id, !isDoneToday(readState(), task.id, date));
        renderWorkList().then(next => document.getElementById('view').replaceChildren(next));
      });
      grid.appendChild(item);
    });

    return wrap;
  }

  window.FC_WORKLIST = {
    getTodayWorkItems,
    readState,
    writeState,
    isDoneToday,
    setDone
  };
  window.renderWorkList = renderWorkList;
})();
