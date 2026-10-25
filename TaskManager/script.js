
  const STORAGE_KEY = 'eisenhower-matrix-tasks';
  const SETTINGS_KEY = 'eisenhower-matrix-settings';
  const ZONES = ['inbox', 'do', 'schedule', 'delegate', 'delete'];
  const zoneNames = { inbox: 'Inbox', do: 'Do', schedule: 'Schedule', delegate: 'Delegate', delete: 'Delete' };
  let deletedIds = new Set();
  let deletedAt = new Map();
  let tasks = loadTasks();
  let settings = loadSettings();
  let undoAction = null;
  let reviewIndex = 0;
  let pendingStorageSync = false;
  const selectedTaskIds = new Set();
  const activeTimers = new Map();

  function newId() {
    return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
  function loadTasks() {
    try {
      const stored = readStore();
      const cutoff = Date.now() - 30 * 86400000;
      deletedAt = new Map();
      (Array.isArray(stored?.deletedIds) ? stored.deletedIds : []).forEach(entry => {
        const id = typeof entry === 'string' ? entry : entry?.id;
        const at = typeof entry === 'string' ? 0 : entry?.at;
        if (typeof id === 'string' && (!at || at >= cutoff)) deletedAt.set(id, Number.isFinite(at) ? at : Date.now());
      });
      deletedIds = new Set(deletedAt.keys());
      const rawTasks = unwrapTasks(stored) || [];
      const usedIds = new Set();
      return rawTasks.map(task => {
        const normalized = normalizeTask(task);
        if (usedIds.has(normalized.id)) normalized.id = newId();
        usedIds.add(normalized.id);
        return normalized;
      }).filter(task => task.text && !deletedIds.has(task.id));
    } catch (error) { console.error('Could not read saved tasks:', error); return []; }
  }
  function readStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      console.error('Could not read task storage:', error);
      return [];
    }
  }
  function unwrapTasks(raw) {
    try {
      const saved = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
      return Array.isArray(saved) ? saved : (saved && Array.isArray(saved.tasks) ? saved.tasks : null);
    } catch (error) {
      console.error('Could not parse saved tasks:', error);
      return null;
    }
  }
  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    }
    catch (error) { console.error('Could not read settings:', error); return {}; }
  }
  function save() {
    try {
      const stored = readStore();
      const storedTasks = unwrapTasks(stored) || [];
      const cutoff = Date.now() - 30 * 86400000;
      const storedDeleted = Array.isArray(stored?.deletedIds) ? stored.deletedIds : [];
      storedDeleted.forEach(entry => {
        const id = typeof entry === 'string' ? entry : entry?.id;
        const at = typeof entry === 'string' ? 0 : entry?.at;
        if (typeof id === 'string' && (!at || at >= cutoff)) {
          deletedIds.add(id);
          if (!deletedAt.has(id)) deletedAt.set(id, Number.isFinite(at) ? at : Date.now());
        }
      });
      deletedIds.forEach(id => { if (!deletedAt.has(id)) deletedAt.set(id, Date.now()); });
      [...deletedAt.keys()].forEach(id => { if (!deletedIds.has(id) || deletedAt.get(id) < cutoff) deletedAt.delete(id); });
      const localById = new Map(tasks.map(task => [task.id, task]));
      const remoteById = new Map(storedTasks.map(normalizeTask).map(task => [task.id, task]));
      remoteById.forEach((remote, id) => {
        const local = localById.get(id);
        if (!local || (remote.updatedAt || 0) > (local.updatedAt || 0)) localById.set(id, remote);
      });
      const mergedTasks = [...localById.values()].filter(task => !deletedIds.has(task.id));
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1, tasks: mergedTasks,
        deletedIds: [...deletedAt].map(([id, at]) => ({ id, at }))
      }));
      tasks = mergedTasks;
    }
    catch (error) { console.error('Could not save tasks:', error); showToast('Could not save changes in this browser.'); }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
    catch (error) { console.error('Could not save settings:', error); showToast('Could not save settings in this browser.'); }
  }
  function today() {
    const date = new Date();
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function touchTask(task) {
    task.updatedAt = Date.now();
  }
  function dateKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function formatDueDate(value) {
    if (!value) return '';
    const difference = Math.round((new Date(value + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000);
    if (difference === 0) return 'Today';
    if (difference === 1) return 'Tomorrow';
    if (difference > 1 && difference < 7) return 'in ' + difference + ' days';
    return value;
  }
  function normalizeTask(task) {
    const source = task && typeof task === 'object' ? task : {};
    const id = typeof source.id === 'string' && source.id ? source.id : newId();
    const dueDate = typeof source.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.dueDate) ? source.dueDate : '';
    const tags = Array.isArray(source.tags) ? source.tags.map(tag => String(tag).replace(/^#+/, '').trim().toLowerCase()).filter(Boolean) : [];
    return {
      id, text: String(source.text || ''), quadrant: ZONES.includes(source.quadrant) ? source.quadrant : 'inbox',
      priority: ['low', 'medium', 'high'].includes(source.priority) ? source.priority : 'medium',
      dueDate, completed: Boolean(source.completed), tags,
      recurring: ['daily', 'weekly', 'monthly'].includes(source.recurring) ? source.recurring : '',
      completedAt: typeof source.completedAt === 'string' ? source.completedAt : '',
      notes: typeof source.notes === 'string' ? source.notes : '',
      subtasks: Array.isArray(source.subtasks) ? source.subtasks.map(item => ({ text: String(item?.text || ''), completed: Boolean(item?.completed) })).filter(item => item.text) : [],
      elapsedSeconds: Number.isFinite(source.elapsedSeconds) ? source.elapsedSeconds : 0,
      timerStartedAt: Number.isFinite(source.timerStartedAt) ? source.timerStartedAt : 0,
      archived: Boolean(source.archived),
      promotedAt: typeof source.promotedAt === 'string' ? source.promotedAt : '',
      spawned: Boolean(source.spawned),
      recurringParentId: typeof source.recurringParentId === 'string' ? source.recurringParentId : '',
      spawnedCopyId: typeof source.spawnedCopyId === 'string' ? source.spawnedCopyId : '',
      recurringDay: Number.isInteger(source.recurringDay) ? source.recurringDay : 0,
      updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : 0
    };
  }
  function visibleTasks() {
    const query = document.getElementById('search').value.trim().toLowerCase();
    const tag = document.getElementById('filter-tag').value;
    return tasks.filter(task => !task.archived && (!query || task.text.toLowerCase().includes(query) || task.notes.toLowerCase().includes(query) || task.tags.some(t => String(t).toLowerCase().includes(query))) && (!tag || task.tags.includes(tag)));
  }
  function showToast(message, action) {
    undoAction = action;
    document.getElementById('toast-message').textContent = message;
    document.getElementById('toast-undo').hidden = typeof action !== 'function';
    document.getElementById('toast').classList.add('visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { document.getElementById('toast').classList.remove('visible'); undoAction = null; }, 5000);
  }
  function updateBulkControls() {
    const active = selectedTaskIds.size > 0;
    document.getElementById('bulk-move').hidden = !active;
    document.getElementById('bulk-delete').hidden = !active;
  }
  function toggleTimer(id) {
    const task = tasks.find(item => item.id === id);
    if (!task) return;
    if (task.timerStartedAt) {
      task.elapsedSeconds += Math.max(0, Math.floor((Date.now() - task.timerStartedAt) / 1000));
      task.timerStartedAt = 0;
      activeTimers.delete(id);
    } else {
      task.timerStartedAt = Date.now();
      activeTimers.set(id, true);
    }
    touchTask(task); save(); render(id);
  }
  function notifyDueTasks() {
    const due = tasks.filter(task => !task.completed && !task.archived && task.dueDate && task.dueDate <= today());
    if (!due.length || !('Notification' in window)) return;
    if (Notification.permission === 'granted') new Notification('Eisenhower Matrix', { body: due.length + ' task' + (due.length === 1 ? '' : 's') + ' due today or overdue.' });
  }
  function addTask(text, dueDate, tags) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const task = { id: newId(), text: trimmed, quadrant: 'inbox', priority: document.getElementById('task-priority').value, dueDate, completed: false, completedAt: '', notes: document.getElementById('new-task-notes').value.trim(), subtasks: [], elapsedSeconds: 0, timerStartedAt: 0, archived: false, tags: tags.map(tag => tag.replace(/^#+/, '')), recurring: '', promotedAt: '', spawned: false, recurringParentId: '', recurringDay: dueDate ? Number(dueDate.slice(-2)) : 0, updatedAt: Date.now() };
    tasks.push(task);
    save(); render();
    return task;
  }
  function setCompleted(task, completed, restoreReviewFocus = false) {
    task = tasks.find(item => item.id === task.id);
    if (!task) return;
    const wasCompleted = task.completed;
    touchTask(task);
    let removedSpawn = null;
    task.completed = completed;
    task.completedAt = completed ? today() : '';
    if (!completed && wasCompleted && task.spawned) {
      const spawnedCopy = tasks.find(item => item.id === task.spawnedCopyId);
      let retainedSpawn = false;
      if (spawnedCopy && !spawnedCopy.completed && !spawnedCopy.spawned &&
          spawnedCopy.text === task.text && spawnedCopy.priority === task.priority &&
          spawnedCopy.dueDate !== '' && spawnedCopy.quadrant === task.quadrant &&
          spawnedCopy.recurring === task.recurring && JSON.stringify(spawnedCopy.tags) === JSON.stringify(task.tags)) {
        removedSpawn = spawnedCopy;
        deletedIds.add(spawnedCopy.id);
        deletedAt.set(spawnedCopy.id, Date.now());
        tasks = tasks.filter(item => item.id !== spawnedCopy.id);
      } else if (spawnedCopy) {
        retainedSpawn = true;
      }
      task.spawned = retainedSpawn;
      if (!retainedSpawn) task.spawnedCopyId = '';
      if (retainedSpawn) showToast('The recurring copy was kept because it was edited.');
    }
    if (completed && !wasCompleted && task.recurring && !task.spawned) {
      task.spawned = true;
      if (!task.recurringDay && task.dueDate) task.recurringDay = Number(task.dueDate.slice(-2));
      const next = new Date((task.dueDate || today()) + 'T00:00:00');
      const advance = () => {
        if (task.recurring === 'daily') next.setDate(next.getDate() + 1);
        if (task.recurring === 'weekly') next.setDate(next.getDate() + 7);
        if (task.recurring === 'monthly') {
          const day = task.recurringDay || next.getDate();
          next.setDate(1);
          next.setMonth(next.getMonth() + 1);
          next.setDate(Math.min(day, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
        }
      };
      while (dateKey(next) <= today()) advance();
      const spawnedCopy = {
        ...task, id: newId(), completed: false, completedAt: '', spawned: false,
        spawnedCopyId: '', recurringParentId: task.id, recurring: task.recurring, promotedAt: '', tags: [...task.tags],
        recurringDay: task.recurringDay || next.getDate(),
        updatedAt: Date.now(),
        quadrant: task.quadrant === 'inbox' ? 'inbox' : task.quadrant,
        dueDate: next.getFullYear() + '-' + String(next.getMonth() + 1).padStart(2, '0') + '-' + String(next.getDate()).padStart(2, '0')
      };
      task.spawnedCopyId = spawnedCopy.id;
      tasks.push(spawnedCopy);
    }
    touchTask(task);
    save();
    render(null, null, restoreReviewFocus);
    if (removedSpawn) {
      showToast('Removed the untouched recurring copy.', () => {
        if (!tasks.some(item => item.id === removedSpawn.id)) {
          tasks.push(removedSpawn);
          deletedIds.delete(removedSpawn.id);
          deletedAt.delete(removedSpawn.id);
          task.spawned = true;
          task.spawnedCopyId = removedSpawn.id;
          save();
          render(null, null, restoreReviewFocus);
        }
      });
    }
  }
  function moveTask(id, quadrant, restoreReviewFocus = false) {
    const task = tasks.find(item => item.id === id);
    if (!task || !ZONES.includes(quadrant)) return;
    const previous = task.quadrant; task.quadrant = quadrant; touchTask(task);
    save(); render(null, null, restoreReviewFocus);
    if (previous !== quadrant) showToast('Moved to ' + zoneNames[quadrant] + '.', () => {
      const current = tasks.find(item => item.id === id);
      if (current) { current.quadrant = previous; touchTask(current); save(); render(); }
    });
  }
  function removeTask(id, restoreReviewFocus = false) {
    const index = tasks.findIndex(item => item.id === id);
    if (index < 0) return;
    const card = document.querySelector('.task[data-id="' + CSS.escape(id) + '"]');
    const nextId = card?.nextElementSibling?.dataset.id || card?.previousElementSibling?.dataset.id;
    const removed = tasks.splice(index, 1)[0]; deletedIds.add(removed.id); deletedAt.set(removed.id, Date.now()); save(); render(null, null, restoreReviewFocus);
    const nextCard = nextId && document.querySelector('.task[data-id="' + CSS.escape(nextId) + '"]');
    if (nextCard && !restoreReviewFocus) nextCard.focus();
    showToast('Task deleted.', () => {
      if (!tasks.some(item => item.id === removed.id)) {
        tasks.splice(Math.min(index, tasks.length), 0, removed);
        deletedIds.delete(removed.id);
        deletedAt.delete(removed.id);
        save(); render();
      }
    });
  }
  function updateTask(task, key, value, focusSelector, event) {
    task = tasks.find(item => item.id === task.id);
    if (!task) return;
    if (JSON.stringify(task[key]) === JSON.stringify(value)) return;
    task[key] = value;
    if (key === 'dueDate' || key === 'recurring') task.recurringDay = 0;
    touchTask(task);
    event?.currentTarget.closest('.task')?.setAttribute('data-dirty', 'true');
    save();
    if (focusSelector) render(task.id, focusSelector);
    else if (!event || !event.relatedTarget || !event.currentTarget.closest('.task').contains(event.relatedTarget)) {
      setTimeout(() => render(), 50);
    }
  }
  function makeSelect(className, value, options, label) {
    const select = document.createElement('select'); select.className = className; select.title = label; select.setAttribute('aria-label', label);
    options.forEach(([optionValue, text]) => { const option = new Option(text, optionValue); option.selected = optionValue === value; select.add(option); });
    return select;
  }
  function render(focusId, focusSelector, restoreReviewFocus = false) {
    const activeId = focusId || document.activeElement.closest?.('.task')?.dataset.id;
    const visible = visibleTasks();
    ZONES.forEach(zone => {
      const list = document.getElementById('list-' + zone); list.innerHTML = '';
      const items = visible.filter(task => task.quadrant === zone);
      const count = document.querySelector('#q-' + zone + ' .quadrant-count');
      if (count) {
        count.textContent = items.filter(task => !task.completed).length + ' / ' + items.length;
        count.title = count.textContent + ' shown; open / total';
      }
      if (zone === 'do') document.querySelector('#q-do .overload-warning').classList.toggle('visible', tasks.filter(t => t.quadrant === 'do' && !t.completed).length > 5);
      if (!items.length) { const hint = document.createElement('div'); hint.className = 'empty-hint'; hint.textContent = zone === 'inbox' ? 'No tasks yet. Add one below.' : 'Move a task here to sort it.'; list.appendChild(hint); return; }
      items.sort((a, b) => Number(a.completed) - Number(b.completed) || ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority] || (a.dueDate || '9999').localeCompare(b.dueDate || '9999')));
      items.forEach(task => {
        const card = document.createElement('div'); card.className = 'task' + (task.completed ? ' completed' : '') + ' priority-' + task.priority; card.draggable = true; card.tabIndex = 0; card.dataset.id = task.id;
        const main = document.createElement('div'); main.className = 'task-main';
        card.setAttribute('role', 'group');
        card.setAttribute('aria-label', 'Task: ' + task.text);
        const check = document.createElement('input'); check.type = 'checkbox'; check.checked = task.completed; check.title = 'Mark complete'; check.setAttribute('aria-label', 'Mark complete: ' + task.text); check.addEventListener('change', () => {
          const current = tasks.find(item => item.id === task.id);
          if (current) setCompleted(current, check.checked);
        });
        const selectTask = document.createElement('input'); selectTask.type = 'checkbox'; selectTask.className = 'task-select'; selectTask.checked = selectedTaskIds.has(task.id); selectTask.setAttribute('aria-label', 'Select task: ' + task.text); selectTask.addEventListener('change', () => {
          if (selectTask.checked) selectedTaskIds.add(task.id); else selectedTaskIds.delete(task.id);
          updateBulkControls();
        });
        const text = document.createElement('span'); text.className = 'task-text'; text.textContent = task.text;
        const beginEdit = () => {
          const current = tasks.find(item => item.id === task.id);
          if (!current) return;
          card.draggable = false;
          try { text.contentEditable = 'plaintext-only'; } catch { text.contentEditable = 'true'; }
          text.dataset.original = current.text;
          text.focus();
        };
        const finishEdit = () => {
          const current = tasks.find(item => item.id === task.id);
          if (!current) return;
          text.contentEditable = 'false'; card.draggable = true;
          if (text.textContent.trim() && text.textContent.trim() !== current.text) {
            current.text = text.textContent.trim();
            card.setAttribute('aria-label', 'Task: ' + current.text);
            check.setAttribute('aria-label', 'Mark complete: ' + current.text);
            priority.setAttribute('aria-label', 'Sort priority for: ' + current.text);
            move.setAttribute('aria-label', 'Move to: ' + current.text);
            tagsInput.setAttribute('aria-label', 'Tags for: ' + current.text);
            due.setAttribute('aria-label', 'Due date for: ' + current.text);
            recurring.setAttribute('aria-label', 'Recurring for: ' + current.text);
            edit.setAttribute('aria-label', 'Edit task: ' + current.text);
            touchTask(current);
            save();
          } else if (!text.textContent.trim()) text.textContent = current.text;
        };
        text.addEventListener('dblclick', beginEdit);
        text.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); text.blur(); } if (e.key === 'Escape') { text.textContent = text.dataset.original || task.text; text.blur(); } });
        text.addEventListener('blur', finishEdit);
        main.append(selectTask, check, text);
        const actions = document.createElement('div'); actions.className = 'task-actions';
        const priority = makeSelect('task-priority', task.priority, [['low','Low'],['medium','Medium'],['high','High']], 'Sort priority for: ' + task.text); priority.addEventListener('change', () => updateTask(task, 'priority', priority.value, '.task-priority'));
        const move = makeSelect('task-move', task.quadrant, ZONES.map(zoneName => [zoneName, zoneNames[zoneName]]), 'Move to: ' + task.text); move.addEventListener('change', () => moveTask(task.id, move.value));
        const remove = document.createElement('button'); remove.className = 'task-remove'; remove.textContent = '\u00D7'; remove.title = 'Delete task'; remove.setAttribute('aria-label', 'Delete task'); remove.addEventListener('click', () => removeTask(task.id));
        const edit = document.createElement('button'); edit.className = 'task-edit'; edit.textContent = 'Edit'; edit.title = 'Edit task'; edit.setAttribute('aria-label', 'Edit task: ' + task.text); edit.addEventListener('click', beginEdit);
        const timer = document.createElement('button'); timer.className = 'task-edit timer-button'; timer.type = 'button'; timer.textContent = task.timerStartedAt ? 'Stop' : 'Timer'; timer.title = 'Track time'; timer.addEventListener('click', () => toggleTimer(task.id));
        actions.append(priority, move, timer, edit, remove);
        const meta = document.createElement('div'); meta.className = 'task-meta' + (task.dueDate && task.dueDate < today() && !task.completed ? ' overdue' : '');
        if (task.dueDate) {
          const daysOverdue = Math.round((new Date(today() + 'T00:00:00') - new Date(task.dueDate + 'T00:00:00')) / 86400000);
          meta.append(document.createTextNode(daysOverdue > 0 && !task.completed ? daysOverdue + ' day' + (daysOverdue === 1 ? '' : 's') + ' overdue' : 'Due: ' + formatDueDate(task.dueDate)));
        }
        task.tags.forEach(tag => { const tagEl = document.createElement('span'); tagEl.className = 'task-tag'; tagEl.textContent = '#' + tag; meta.append(tagEl); });
        const tagsInput = document.createElement('input'); tagsInput.className = 'task-tags-input'; tagsInput.value = task.tags.join(', '); tagsInput.title = 'Tags'; tagsInput.setAttribute('aria-label', 'Tags for: ' + task.text); tagsInput.addEventListener('focusout', event => updateTask(task, 'tags', tagsInput.value.split(',').map(tag => tag.replace(/^#+/, '').trim().toLowerCase()).filter(Boolean), null, event)); meta.append(tagsInput);
        const due = document.createElement('input'); due.type = 'date'; due.className = 'task-date'; due.value = task.dueDate; due.title = 'Due date'; due.setAttribute('aria-label', 'Due date for: ' + task.text); due.addEventListener('focusout', event => updateTask(task, 'dueDate', due.value, null, event)); meta.append(due);
        const recurring = makeSelect('task-recurring', task.recurring, [['','Once'],['daily','Daily'],['weekly','Weekly'],['monthly','Monthly']], 'Recurring for: ' + task.text); recurring.addEventListener('change', () => updateTask(task, 'recurring', recurring.value, '.task-recurring')); meta.append(recurring);
        const notes = document.createElement('textarea'); notes.className = 'task-notes'; notes.value = task.notes; notes.placeholder = 'Notes'; notes.setAttribute('aria-label', 'Notes for: ' + task.text); notes.addEventListener('focusout', event => updateTask(task, 'notes', notes.value.trim(), null, event));
        const subtasks = document.createElement('div'); subtasks.className = 'task-subtasks';
        task.subtasks.forEach((subtask, index) => {
          const row = document.createElement('label'); row.className = 'subtask-row';
          const subcheck = document.createElement('input'); subcheck.type = 'checkbox'; subcheck.checked = subtask.completed; subcheck.addEventListener('change', () => { task.subtasks[index].completed = subcheck.checked; touchTask(task); save(); });
          const subtext = document.createElement('span'); subtext.textContent = subtask.text; row.append(subcheck, subtext); subtasks.append(row);
        });
        const addSubtask = document.createElement('button'); addSubtask.type = 'button'; addSubtask.className = 'task-edit'; addSubtask.textContent = '+ checklist item'; addSubtask.addEventListener('click', () => {
          const textValue = prompt('Checklist item');
          if (!textValue || !textValue.trim()) return;
          task.subtasks.push({ text: textValue.trim(), completed: false }); touchTask(task); save(); render(task.id);
        });
        subtasks.append(addSubtask);
        card.append(main, actions, meta);
        card.append(notes);
        card.append(subtasks);
        card.addEventListener('focusout', event => {
          if (!card.contains(event.relatedTarget) && card.dataset.dirty === 'true') {
            delete card.dataset.dirty;
            render();
          }
        });
        card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', task.id); card.classList.add('dragging'); });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        card.addEventListener('keydown', e => {
          if (e.target !== card) return;
          if (['1', '2', '3', '4', '5'].includes(e.key)) moveTask(task.id, ZONES[Number(e.key) - 1]);
          if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); beginEdit(); }
          if (e.key === ' ') { e.preventDefault(); check.click(); }
          if (e.key === 'Delete') removeTask(task.id);
        });
        list.appendChild(card);
      });
    });
    const completedCount = tasks.filter(task => task.completed).length;
    document.getElementById('task-count').textContent = tasks.length + (tasks.length === 1 ? ' task' : ' tasks') + ' · ' + completedCount + ' completed';
    const openCount = tasks.filter(task => !task.completed && !task.archived).length;
    const percent = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;
    document.getElementById('progress-panel').innerHTML = '<strong>' + percent + '% complete</strong> · ' + completedCount + '/' + tasks.length + ' tasks done' +
      '<div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '"><div class="progress-fill" style="width:' + percent + '%"></div></div>';
    updateBulkControls();
    updateTagFilter();
    if (activeId) {
      const activeCard = document.querySelector('.task[data-id="' + CSS.escape(activeId) + '"]');
      const focusTarget = focusSelector && activeCard ? activeCard.querySelector(focusSelector) : activeCard;
      if (focusTarget) focusTarget.focus();
    }
    if (document.getElementById('review-panel').classList.contains('visible')) renderReview(restoreReviewFocus);
  }
  function updateTagFilter() {
    const select = document.getElementById('filter-tag'); const current = select.value;
    select.innerHTML = '<option value="">All tags</option>';
    [...new Set(tasks.flatMap(task => task.tags))].sort().forEach(tag => select.add(new Option('#' + tag, tag)));
    select.value = current;
  }
  function exportTasks() {
    const blob = new Blob([JSON.stringify({ version: 1, tasks }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'eisenhower-tasks.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderReview(restoreFocus = false) {
    const panel = document.getElementById('review-panel');
    if (!panel.classList.contains('visible')) return;
    panel.replaceChildren();
    const openTasks = tasks.filter(task => !task.completed).sort((a, b) =>
      Number(b.quadrant === 'inbox') - Number(a.quadrant === 'inbox') ||
      Number(Boolean(b.dueDate && b.dueDate < today())) - Number(Boolean(a.dueDate && a.dueDate < today())) ||
      (a.dueDate || '9999').localeCompare(b.dueDate || '9999')
    );
    const overdue = openTasks.filter(task => task.dueDate && task.dueDate < today()).length;
    const completedThisWeek = tasks.filter(task => task.completedAt && (Date.now() - new Date(task.completedAt + 'T00:00:00').getTime()) < 7 * 86400000).length;
    const summary = document.createElement('strong');
    summary.setAttribute('aria-live', 'polite');
    const quadrantSummary = ZONES.slice(1).map(zone => zoneNames[zone] + ': ' + tasks.filter(item => item.quadrant === zone && !item.completed && !item.archived).length).join(' · ');
    summary.textContent = 'Weekly review: ' + completedThisWeek + ' completed this week · ' + overdue + ' overdue · ' + quadrantSummary + '. ';
    panel.append(summary);
    if (!openTasks.length) {
      panel.append(document.createTextNode('All tasks are complete.'));
      return;
    }
    const task = openTasks[reviewIndex % openTasks.length];
    panel.append(document.createTextNode('Review "' + task.text + '" '));
    const keep = document.createElement('button'); keep.type = 'button'; keep.textContent = 'Keep';
    const done = document.createElement('button'); done.type = 'button'; done.textContent = 'Done';
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete';
    const move = makeSelect('task-move', task.quadrant, ZONES.map(zone => [zone, zoneNames[zone]]), 'Move to: ' + task.text);
    keep.addEventListener('click', () => { reviewIndex++; renderReview(true); });
    done.addEventListener('click', () => { setCompleted(task, true, true); });
    remove.addEventListener('click', () => { removeTask(task.id, true); });
    move.addEventListener('change', () => { moveTask(task.id, move.value, true); });
    panel.append(keep, move, done, remove);
    if (restoreFocus) keep.focus();
  }
  function suggestQuadrant(dueDate, priority) {
    if (priority === 'high' || (dueDate && dueDate <= today())) return 'do';
    if (dueDate) return 'schedule';
    return 'inbox';
  }
  function promoteDueTasks() {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + 1);
    const limit = cutoff.getFullYear() + '-' + String(cutoff.getMonth() + 1).padStart(2, '0') + '-' + String(cutoff.getDate()).padStart(2, '0');
    let changed = false;
    let moved = 0;
    tasks.forEach(task => {     if (!task.completed && task.quadrant === 'schedule' && task.dueDate && task.dueDate <= limit && !task.promotedAt) { task.quadrant = 'do'; task.promotedAt = today(); touchTask(task); changed = true; moved++; } });
    if (changed) { save(); showToast(moved + ' task' + (moved === 1 ? '' : 's') + ' moved to Do.'); }
  }
  document.querySelectorAll('.inbox, .quadrant').forEach(zone => {
    zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); });
    zone.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes('text/plain')) return;
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('drop', e => {
      const id = e.dataTransfer.getData('text/plain');
      if (!tasks.some(task => task.id === id)) return;
      e.preventDefault();
      zone.classList.remove('drag-over');
      moveTask(id, zone.dataset.quadrant);
    });
  });
  const addForm = document.querySelector('.add-row');
  addForm.addEventListener('submit', e => {
    e.preventDefault();
    const task = addTask(
      document.getElementById('new-task-text').value,
      document.getElementById('new-task-date').value,
      document.getElementById('new-task-tags').value.split(',').map(tag => tag.replace(/^#+/, '').trim().toLowerCase()).filter(Boolean)
    );
    const suggestion = e.target.dataset.suggestion;
    if (task && suggestion && suggestion !== 'inbox') { task.quadrant = suggestion; touchTask(task); save(); render(); }
    delete e.target.dataset.suggestion;
    document.getElementById('suggest-task').textContent = 'Suggest';
    e.target.reset(); document.getElementById('new-task-text').focus();
  });
  document.getElementById('suggest-task').addEventListener('click', () => {
    addForm.dataset.suggestion = suggestQuadrant(document.getElementById('new-task-date').value, document.getElementById('task-priority').value);
    document.getElementById('suggest-task').textContent = 'Suggested: ' + zoneNames[addForm.dataset.suggestion];
  });
  addForm.querySelectorAll('input, select').forEach(input => input.addEventListener('input', () => {
    delete addForm.dataset.suggestion;
    document.getElementById('suggest-task').textContent = 'Suggest';
  }));
  document.getElementById('search').addEventListener('input', () => render());
  document.getElementById('filter-tag').addEventListener('change', () => render());
  document.getElementById('clear-completed').addEventListener('click', () => {
    const removed = tasks.filter(task => task.completed);
    if (!removed.length) return;
    const removedIds = new Set(removed.map(task => task.id));
    removedIds.forEach(id => { deletedIds.add(id); deletedAt.set(id, Date.now()); });
    tasks = tasks.filter(task => !removedIds.has(task.id)); save(); render();
    showToast('Completed tasks cleared.', () => {
      const existing = new Set(tasks.map(task => task.id));
      const restored = removed.filter(task => !existing.has(task.id));
      restored.forEach(task => { deletedIds.delete(task.id); deletedAt.delete(task.id); });
      tasks.push(...restored); save(); render();
    });
  });
  document.getElementById('export-btn').addEventListener('click', exportTasks);
  document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-input').click());
  document.getElementById('import-input').addEventListener('change', async e => {
    try {
      const imported = unwrapTasks(await e.target.files[0].text());
      if (!imported) throw new Error('JSON must contain an array or task object');
      const previous = tasks;
      const importedTasks = [];
      const usedIds = new Set();
      imported.map(normalizeTask).filter(task => task.text).forEach(task => {
        if (usedIds.has(task.id)) task.id = newId();
        usedIds.add(task.id);
        importedTasks.push(task);
      });
      const importedIds = new Set(importedTasks.map(task => task.id));
      deletedIds = new Set(previous.map(task => task.id));
      deletedAt = new Map(previous.map(task => [task.id, Date.now()]));
      importedTasks.forEach(task => { touchTask(task); deletedIds.delete(task.id); });
      tasks = importedTasks; save(); render();
      showToast('Tasks imported.', () => {
        const current = tasks.filter(task => !importedIds.has(task.id));
        const currentIds = new Set(current.map(task => task.id));
        previous.forEach(task => { deletedIds.delete(task.id); deletedAt.delete(task.id); });
        tasks = current.concat(previous.filter(task => !currentIds.has(task.id))); save(); render();
      });
    } catch (error) { console.error('Could not import tasks:', error); showToast('Import failed: choose a valid task JSON file.'); }
    e.target.value = '';
  });
  document.getElementById('bulk-toggle').addEventListener('click', e => {
    document.body.classList.toggle('bulk-mode');
    const enabled = document.body.classList.contains('bulk-mode');
    e.currentTarget.setAttribute('aria-pressed', String(enabled));
    e.currentTarget.textContent = enabled ? 'Done selecting' : 'Select';
    if (!enabled) selectedTaskIds.clear();
    updateBulkControls();
  });
  document.getElementById('bulk-move').addEventListener('click', () => {
    const destination = prompt('Move selected tasks to: inbox, do, schedule, delegate, or delete');
    if (!ZONES.includes(destination)) return;
    tasks.forEach(task => { if (selectedTaskIds.has(task.id)) { task.quadrant = destination; touchTask(task); } });
    selectedTaskIds.clear(); save(); render(); showToast('Selected tasks moved.');
  });
  document.getElementById('bulk-delete').addEventListener('click', () => {
    const selected = tasks.filter(task => selectedTaskIds.has(task.id));
    if (!selected.length) return;
    selected.forEach(task => { task.archived = true; touchTask(task); });
    selectedTaskIds.clear(); save(); render(); showToast(selected.length + ' task' + (selected.length === 1 ? '' : 's') + ' archived.');
  });
  document.getElementById('template-btn').addEventListener('click', () => {
    const text = document.getElementById('new-task-text').value.trim();
    if (!text) { showToast('Enter a task first to save a template.'); return; }
    settings.templates = Array.isArray(settings.templates) ? settings.templates : [];
    settings.templates.push({ text, priority: document.getElementById('task-priority').value, tags: document.getElementById('new-task-tags').value });
    saveSettings(); showToast('Template saved.');
  });
  document.getElementById('theme-toggle').addEventListener('click', () => { settings.light = !settings.light; document.body.classList.toggle('light', settings.light); document.getElementById('theme-toggle').textContent = settings.light ? 'Dark theme' : 'Light theme'; saveSettings(); });
  document.getElementById('review-toggle').addEventListener('click', () => {
    const panel = document.getElementById('review-panel'); panel.classList.toggle('visible'); renderReview();
  });
  document.getElementById('toast-undo').addEventListener('click', () => { if (undoAction) undoAction(); document.getElementById('toast').classList.remove('visible'); undoAction = null; });
  document.getElementById('new-task-date').addEventListener('change', () => {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(error => console.error('Could not request notification permission:', error));
  });
  document.querySelector('.add-more-toggle').addEventListener('click', e => {
    const open = document.querySelector('.add-more').classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });
  window.addEventListener('storage', e => {
    if (e.key === STORAGE_KEY) {
      const activeCard = document.activeElement.closest?.('.task');
      if (activeCard && document.activeElement.matches('input, select, textarea')) {
        pendingStorageSync = true;
      } else {
        tasks = loadTasks();
        render();
      }
    }
    if (e.key === SETTINGS_KEY) {
      settings = loadSettings();
      document.body.classList.toggle('light', Boolean(settings.light));
      document.getElementById('theme-toggle').textContent = settings.light ? 'Dark theme' : 'Light theme';
    }
  });
  document.addEventListener('focusout', event => {
    if (pendingStorageSync && event.target.closest?.('.task') && !event.relatedTarget?.closest?.('.task')) {
      pendingStorageSync = false;
      tasks = loadTasks();
      render();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      promoteDueTasks();
      notifyDueTasks();
      const activeCard = document.activeElement.closest?.('.task');
      if (!activeCard || !document.activeElement.matches('input, select, textarea')) render();
    }
  });
  document.addEventListener('keydown', e => { if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'SELECT' && !document.activeElement.isContentEditable) { e.preventDefault(); document.querySelector('.add-row input').focus(); } });
  const systemTheme = window.matchMedia('(prefers-color-scheme: light)');
  systemTheme.addEventListener?.('change', event => {
    let hasExplicitTheme = false;
    try { hasExplicitTheme = localStorage.getItem(SETTINGS_KEY) !== null; }
    catch (error) { console.error('Could not read theme preference:', error); }
    if (!hasExplicitTheme) {
      settings.light = event.matches;
      document.body.classList.toggle('light', Boolean(settings.light));
      document.getElementById('theme-toggle').textContent = settings.light ? 'Dark theme' : 'Light theme';
    }
  });
  promoteDueTasks();
  if (typeof settings.light !== 'boolean') settings.light = window.matchMedia('(prefers-color-scheme: light)').matches;
  document.body.classList.toggle('light', Boolean(settings.light));
  document.getElementById('theme-toggle').textContent = settings.light ? 'Dark theme' : 'Light theme';
  render();
