const CANVAS_SIZE = 50000;
const MIN_SCALE = 0.125;
const MAX_SCALE = 4;
const GRID_STEP = 10;
const STORAGE_KEY = 'subform-api-config';
const CAPTURE_STORAGE_KEY = 'subform-capture-config';
const DB_NAME = 'SubformWorkspace';
const DB_VERSION = 1;

const elements = {
  gridContainer: document.getElementById('grid-container'),
  gridCanvas: document.getElementById('grid-canvas'),
  connectionsSvg: document.getElementById('connections-svg'),
  selectionOverlay: document.getElementById('selection-overlay'),
  horizontalScrollbar: document.getElementById('horizontal-scrollbar'),
  verticalScrollbar: document.getElementById('vertical-scrollbar'),
  menuButton: document.getElementById('menu-button'),
  menuIcon: document.getElementById('icon-menu'),
  menuSave: document.getElementById('icon-enter'),
  menuContent: document.getElementById('expanded-content'),
  loadingBar: document.getElementById('loading-bar'),
  inputBase: document.getElementById('api-base-input'),
  inputKey: document.getElementById('api-key-input'),
  inputModel: document.getElementById('api-model-input'),
  inputRemember: document.getElementById('api-remember'),
  captureTrigger: document.getElementById('capture-config-trigger'),
  captureLayer: document.getElementById('capture-config-layer'),
  captureClose: document.getElementById('capture-config-close'),
  captureForm: document.getElementById('capture-config-form'),
  captureEnabled: document.getElementById('capture-enabled'),
  captureEndpoint: document.getElementById('capture-endpoint'),
  captureNotes: document.getElementById('capture-notes'),
  captureCancel: document.getElementById('capture-cancel'),
};

const generateId = (() => {
  if (typeof globalThis.crypto === 'object' && typeof globalThis.crypto.randomUUID === 'function') {
    return () => globalThis.crypto.randomUUID();
  }
  return () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
      const random = Math.random() * 16;
      const value = char === 'x' ? random : (random & 0x3) | 0x8;
      return Math.floor(value).toString(16);
    });
})();

const state = {
  scale: 1,
  translateX: 0,
  translateY: 0,
  notes: new Map(),
  connections: [],
  connectionSelection: new Set(),
  selection: new Set(),
  activeConnection: null,
  dragging: null,
  resizing: null,
  pan: { active: false, startX: 0, startY: 0 },
  zCounter: 0,
  undoStack: [],
  redoStack: [],
  db: null,
  settings: loadSettings(),
  capture: loadCaptureSettings(),
  lastPointer: { x: 0, y: 0 },
  isSpacePressed: false,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        baseUrl: '',
        apiKey: '',
        model: 'deepseek-v3-250324',
        remember: false,
      };
    }
    const parsed = JSON.parse(raw);
    return {
      baseUrl: parsed.baseUrl || '',
      apiKey: parsed.apiKey || '',
      model: parsed.model || 'deepseek-v3-250324',
      remember: Boolean(parsed.remember),
    };
  } catch (error) {
    console.warn('Failed to load API settings', error);
    return {
      baseUrl: '',
      apiKey: '',
      model: 'deepseek-v3-250324',
      remember: false,
    };
  }
}

function saveSettingsToStorage(settings) {
  if (settings.remember) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveCaptureSettings(settings) {
  localStorage.setItem(CAPTURE_STORAGE_KEY, JSON.stringify(settings));
}

function applySettingsToUI() {
  elements.inputBase.value = state.settings.baseUrl || '';
  if (state.settings.apiKey) {
    elements.inputKey.value = '•'.repeat(state.settings.apiKey.length);
    elements.inputKey.dataset.masked = 'true';
  } else {
    elements.inputKey.value = '';
    elements.inputKey.dataset.masked = 'false';
  }
  elements.inputModel.value = state.settings.model || 'deepseek-v3-250324';
  elements.inputRemember.checked = state.settings.remember;
}

function unmaskApiKeyIfNeeded() {
  if (elements.inputKey.dataset.masked === 'true') {
    elements.inputKey.value = state.settings.apiKey;
    elements.inputKey.dataset.masked = 'false';
  }
}

applySettingsToUI();

function loadCaptureSettings() {
  try {
    const raw = localStorage.getItem(CAPTURE_STORAGE_KEY);
    if (!raw) {
      return { enabled: false, endpoint: '', notes: '' };
    }
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed.enabled),
      endpoint: parsed.endpoint || '',
      notes: parsed.notes || '',
    };
  } catch (error) {
    console.warn('Failed to load capture settings', error);
    return { enabled: false, endpoint: '', notes: '' };
  }
}

function applyCaptureToUI() {
  elements.captureEnabled.checked = state.capture.enabled;
  elements.captureEndpoint.value = state.capture.endpoint;
  elements.captureNotes.value = state.capture.notes;
}

applyCaptureToUI();

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('canvas')) {
        db.createObjectStore('canvas');
      }
    };
  });
}

function writeCanvasState(snapshot) {
  if (!state.db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction('canvas', 'readwrite');
    tx.objectStore('canvas').put(snapshot, 'state');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function readCanvasState() {
  if (!state.db) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction('canvas', 'readonly');
    const request = tx.objectStore('canvas').get('state');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function serializeState() {
  const notes = Array.from(state.notes.values()).map((note) => ({
    id: note.id,
    x: note.x,
    y: note.y,
    width: note.width,
    height: note.height,
    content: note.type === 'image' ? '' : note.textarea.value,
    title: note.title ?? '',
    type: note.type,
    imageData: note.type === 'image' ? note.imageData : null,
  }));

  return {
    notes,
    connections: state.connections.map((conn) => ({ ...conn })),
    transform: {
      scale: state.scale,
      translateX: state.translateX,
      translateY: state.translateY,
    },
  };
}

async function persistState() {
  const snapshot = serializeState();
  try {
    await writeCanvasState(snapshot);
  } catch (error) {
    console.warn('Failed to persist canvas state', error);
  }
}

function pushUndo(description = '', snapshot = null) {
  const snap = snapshot ?? serializeState();
  state.undoStack.push({ snapshot: snap, description });
  if (state.undoStack.length > 100) state.undoStack.shift();
  state.redoStack = [];
}

function restoreSnapshot(snapshot) {
  clearWorkspace();

  state.scale = snapshot.transform?.scale ?? 1;
  state.translateX = snapshot.transform?.translateX ?? 0;
  state.translateY = snapshot.transform?.translateY ?? 0;
  applyTransform();

  snapshot.notes.forEach((noteData) => {
    createNote({
      id: noteData.id,
      x: noteData.x,
      y: noteData.y,
      width: noteData.width,
      height: noteData.height,
      content: noteData.content,
      type: noteData.type,
      title: noteData.title,
      imageData: noteData.imageData,
    });
  });

  snapshot.connections.forEach((connection) => {
    if (state.notes.has(connection.from) && state.notes.has(connection.to)) {
      state.connections.push({ ...connection });
    }
  });

  renderConnections();
}

function undo() {
  if (state.undoStack.length === 0) return;
  const current = serializeState();
  const previous = state.undoStack.pop();
  state.redoStack.push({ snapshot: current });
  restoreSnapshot(previous.snapshot);
  persistState();
}

function redo() {
  if (state.redoStack.length === 0) return;
  const current = serializeState();
  const next = state.redoStack.pop();
  state.undoStack.push({ snapshot: current });
  restoreSnapshot(next.snapshot);
  persistState();
}

function clearWorkspace() {
  state.notes.forEach((note) => note.element.remove());
  state.notes.clear();
  state.connections = [];
  state.connectionSelection.clear();
  state.selection.clear();
  state.activeConnection = null;
  state.zCounter = 0;
  elements.connectionsSvg.innerHTML = '';
  elements.selectionOverlay.innerHTML = '';
}

function applyTransform() {
  state.translateX = Math.min(0, Math.max(state.translateX, innerWidth - CANVAS_SIZE * state.scale));
  state.translateY = Math.min(0, Math.max(state.translateY, innerHeight - CANVAS_SIZE * state.scale));
  elements.gridContainer.style.transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;
  updateGridBackground();
  updateScrollbars();
}

function updateGridBackground() {
  // 原网站使用简单的静态网格，不需要动态更新
  document.documentElement.style.setProperty('--stroke-scale', state.scale <= 1 ? 1 / state.scale : 1);
}

function updateScrollbars() {
  const h = elements.horizontalScrollbar;
  const v = elements.verticalScrollbar;
  const visibleWidth = innerWidth;
  const visibleHeight = innerHeight;
  const contentWidth = CANVAS_SIZE * state.scale;
  const contentHeight = CANVAS_SIZE * state.scale;

  const hRatio = Math.min(1, visibleWidth / contentWidth);
  const vRatio = Math.min(1, visibleHeight / contentHeight);

  const hThumb = h.querySelector('.scrollbar-thumb');
  const vThumb = v.querySelector('.scrollbar-thumb');

  const hThumbWidth = Math.max(visibleWidth * hRatio - 12, 60);
  const vThumbHeight = Math.max(visibleHeight * vRatio - 12, 60);

  hThumb.style.width = `${hThumbWidth}px`;
  vThumb.style.height = `${vThumbHeight}px`;

  const maxHX = Math.max(1, contentWidth - visibleWidth);
  const maxHY = Math.max(1, contentHeight - visibleHeight);

  const hPos = (-state.translateX / maxHX) * (visibleWidth - hThumbWidth - 24);
  const vPos = (-state.translateY / maxHY) * (visibleHeight - vThumbHeight - 24);

  hThumb.style.left = `${hPos}px`;
  vThumb.style.top = `${vPos}px`;
}

function screenToWorld(x, y) {
  const rect = elements.gridContainer.getBoundingClientRect();
  return {
    x: (x - rect.left) / state.scale,
    y: (y - rect.top) / state.scale,
  };
}

function snapToGrid(value) {
  return Math.round(value / GRID_STEP) * GRID_STEP;
}

function createNote({ id, x, y, width = 300, height = 280, content = '', type = 'input', title = '', imageData = null }) {
  const noteId = id || generateId();
  const element = document.createElement('div');
  element.className = `note${type === 'output' ? ' output-note' : ''}${type === 'image' ? ' image-note' : ''}`;
  element.dataset.id = noteId;
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;

  const header = document.createElement('div');
  header.className = 'note-header';

  const leftDot = document.createElement('div');
  leftDot.className = 'note-dot';
  leftDot.dataset.side = 'left';
  const rightDot = document.createElement('div');
  rightDot.className = 'note-dot';
  rightDot.dataset.side = 'right';

  const titleEl = document.createElement('div');
  titleEl.className = 'note-title';
  titleEl.textContent = title || (type === 'output' ? 'Output' : '');

  header.append(leftDot, titleEl, rightDot);

  let textarea = null;

  if (type === 'image' && imageData) {
    const imgContainer = document.createElement('div');
    imgContainer.className = 'note-content';
    imgContainer.style.backgroundImage = `url('${imageData}')`;
    element.append(header, imgContainer);
  } else {
    textarea = document.createElement('textarea');
    textarea.className = 'note-content';
    textarea.value = content;
    textarea.placeholder = type === 'output' ? '' : 'Type your note here...';
    textarea.readOnly = type === 'output';
    element.append(header, textarea);
  }

  const bottomBar = document.createElement('div');
  bottomBar.className = 'note-bottom-bar';

  const modelLabel = document.createElement('div');
  modelLabel.className = 'note-bottom-bar-text';
  modelLabel.textContent = type === 'output' ? '' : state.settings.model || 'deepseek-v3-250324';

  const actionButton = document.createElement('div');
  actionButton.className = 'note-bottom-bar-right';

  // 添加SVG图标
  if (type === 'output') {
    // Copy图标
    actionButton.innerHTML = `
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 0.5H9C9.27614 0.5 9.5 0.723858 9.5 1V7M1 9.5H6.5C6.77614 9.5 7 9.27614 7 9V3.5C7 3.22386 6.77614 3 6.5 3H1C0.723858 3 0.5 3.22386 0.5 3.5V9C0.5 9.27614 0.723858 9.5 1 9.5Z" stroke="rgba(255, 255, 255, 0.4)" stroke-linecap="round" stroke-linejoin="round" style="stroke-opacity: 0.4;"></path>
      </svg>
    `;
  } else {
    // Generate图标
    actionButton.innerHTML = `
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M0.5 6.5H8.5C9.05228 6.5 9.5 6.05228 9.5 5.5V2.5C9.5 1.94772 9.05228 1.5 8.5 1.5H5.5M0.5 6.5L3 4M0.5 6.5L3 9" stroke="rgba(255, 255, 255, 0.4)" stroke-linecap="round" stroke-linejoin="round" style="stroke-opacity: 0.4;"></path>
      </svg>
    `;
  }

  bottomBar.append(modelLabel, actionButton);
  element.append(bottomBar);

  addResizeHandles(element);

  elements.gridContainer.appendChild(element);

  const note = {
    id: noteId,
    element,
    header,
    leftDot,
    rightDot,
    textarea,
    actionButton,
    modelLabel,
    type,
    title: titleEl.textContent,
    x,
    y,
    width,
    height,
    imageData,
  };

  state.notes.set(noteId, note);

  registerNoteEvents(note);
  bringNoteToFront(note);
  return note;
}

function bringNoteToFrontElement(element) {
  if (!element) return;
  state.zCounter += 1;
  element.style.zIndex = state.zCounter;
}

function bringNoteToFront(note) {
  if (!note) return;
  bringNoteToFrontElement(note.element);
}

function addResizeHandles(element) {
  const positions = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  positions.forEach((pos) => {
    const handle = document.createElement('div');
    handle.className = `resize-handle ${pos}`;
    element.appendChild(handle);
  });
}

function registerNoteEvents(note) {
  note.header.addEventListener('pointerdown', (event) => startNoteDrag(event, note));
  note.leftDot.addEventListener('pointerdown', (event) => startConnection(event, note, 'left'));
  note.rightDot.addEventListener('pointerdown', (event) => startConnection(event, note, 'right'));

  note.element.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.resize-handle')) return;
    bringNoteToFront(note);
    focusNote(note, event);
  });

  note.element.querySelectorAll('.resize-handle').forEach((handle) => {
    handle.addEventListener('pointerdown', (event) => startResize(event, note, handle.classList.contains('n'), handle.classList.contains('s'), handle.classList.contains('e'), handle.classList.contains('w')));
  });

  if (note.textarea && note.type !== 'output') {
    note.textarea.addEventListener('input', () => autoResize(note));
    note.textarea.addEventListener('focus', () => {
      if (!state.selection.has(note.id)) {
        state.selection.clear();
        state.selection.add(note.id);
        updateSelectionStyles();
      }
    });
    note.textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        triggerGeneration(note);
      }
    });
    note.textarea.addEventListener('blur', persistState);
  }

  note.actionButton.addEventListener('click', () => {
    if (note.type === 'output') {
      if (note.textarea) navigator.clipboard.writeText(note.textarea.value || '');
    } else {
      triggerGeneration(note);
    }
  });

  autoResize(note);
}

function autoResize(note) {
  if (!note.textarea) return;
  note.textarea.style.height = 'auto';
  const minHeight = 160;
  const newHeight = Math.max(minHeight, note.textarea.scrollHeight + 32);
  note.element.style.height = `${newHeight}px`;
  note.height = newHeight;
  renderConnections();
}

function focusNote(note, event) {
  const isShift = event.shiftKey;
  if (!isShift && !state.selection.has(note.id)) {
    state.selection.clear();
  }

  if (state.selection.has(note.id) && isShift) {
    state.selection.delete(note.id);
  } else {
    state.selection.add(note.id);
  }
  updateSelectionStyles();
  if (!isShift) clearConnectionSelection();
  bringNoteToFront(note);
}

function updateSelectionStyles() {
  state.notes.forEach((note) => {
    if (state.selection.has(note.id)) {
      note.element.classList.add('active');
    } else {
      note.element.classList.remove('active');
    }
  });
}

function clearConnectionSelection(triggerRender = true) {
  if (state.connectionSelection.size === 0) return;
  state.connectionSelection.clear();
  if (triggerRender) renderConnections();
}

function startNoteDrag(event, note) {
  if (event.button !== 0) return;
  event.preventDefault();
  bringNoteToFront(note);
  clearConnectionSelection();
  const pointer = screenToWorld(event.clientX, event.clientY);

  if (!state.selection.has(note.id)) {
    state.selection.clear();
    state.selection.add(note.id);
    updateSelectionStyles();
  }

  let initialPositions = Array.from(state.selection).map((id) => {
    const target = state.notes.get(id);
    return { id, x: target.x, y: target.y };
  });

  if (event.altKey) {
    const clones = duplicateSelection();
    if (clones.length) {
      initialPositions = clones.map((id) => {
        const target = state.notes.get(id);
        return { id, x: target.x, y: target.y };
      });
    }
  }

  state.dragging = {
    startPointer: pointer,
    initialPositions,
  };

  document.addEventListener('pointermove', dragSelectedNotes);
  document.addEventListener('pointerup', endNoteDrag, { once: true });
  pushUndo('Move note');
}

function dragSelectedNotes(event) {
  if (!state.dragging) return;
  const pointer = screenToWorld(event.clientX, event.clientY);
  const dx = pointer.x - state.dragging.startPointer.x;
  const dy = pointer.y - state.dragging.startPointer.y;

  state.dragging.initialPositions.forEach((pos) => {
    const note = state.notes.get(pos.id);
    note.x = snapToGrid(pos.x + dx);
    note.y = snapToGrid(pos.y + dy);
    note.element.style.left = `${note.x}px`;
    note.element.style.top = `${note.y}px`;
  });
  renderConnections();
}

function endNoteDrag() {
  document.removeEventListener('pointermove', dragSelectedNotes);
  state.dragging = null;
  persistState();
}

function startResize(event, note, north, south, east, west) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  const pointer = screenToWorld(event.clientX, event.clientY);
  state.resizing = {
    noteId: note.id,
    startPointer: pointer,
    north,
    south,
    east,
    west,
    initial: {
      x: note.x,
      y: note.y,
      width: note.width,
      height: note.height,
    },
  };

  document.addEventListener('pointermove', resizeNote);
  document.addEventListener('pointerup', endResize, { once: true });
  pushUndo('Resize note');
}

function resizeNote(event) {
  if (!state.resizing) return;
  const pointer = screenToWorld(event.clientX, event.clientY);
  const note = state.notes.get(state.resizing.noteId);
  if (!note) return;

  const dx = pointer.x - state.resizing.startPointer.x;
  const dy = pointer.y - state.resizing.startPointer.y;

  let { x, y, width, height } = state.resizing.initial;

  if (state.resizing.east) width = snapToGrid(Math.max(220, width + dx));
  if (state.resizing.south) height = snapToGrid(Math.max(200, height + dy));
  if (state.resizing.west) {
    const newWidth = snapToGrid(Math.max(220, width - dx));
    const delta = width - newWidth;
    width = newWidth;
    x = snapToGrid(x + delta);
  }
  if (state.resizing.north) {
    const newHeight = snapToGrid(Math.max(200, height - dy));
    const delta = height - newHeight;
    height = newHeight;
    y = snapToGrid(y + delta);
  }

  note.x = x;
  note.y = y;
  note.width = width;
  note.height = height;
  note.element.style.left = `${x}px`;
  note.element.style.top = `${y}px`;
  note.element.style.width = `${width}px`;
  note.element.style.height = `${height}px`;
  renderConnections();
}

function endResize() {
  document.removeEventListener('pointermove', resizeNote);
  state.resizing = null;
  persistState();
}

function duplicateSelection() {
  const snapshot = serializeState();
  const clones = [];
  const offset = 40;
  state.selection.forEach((id) => {
    const original = state.notes.get(id);
    if (!original || original.type === 'output') return;
    const cloned = createNote({
      x: original.x + offset,
      y: original.y + offset,
      width: original.width,
      height: original.height,
      content: original.textarea ? original.textarea.value : '',
      type: original.type,
    });
    clones.push(cloned.id);
  });
  if (clones.length) {
    clearConnectionSelection();
    state.selection = new Set(clones);
    updateSelectionStyles();
    renderConnections();
    pushUndo('Duplicate notes', snapshot);
    persistState();
  }
  return clones;
}

function startConnection(event, note, side) {
  event.preventDefault();
  event.stopPropagation();
  clearConnectionSelection();
  const pointer = screenToWorld(event.clientX, event.clientY);
  state.activeConnection = {
    from: note.id,
    side,
    pointer,
  };

  document.addEventListener('pointermove', updateTemporaryConnection);
  document.addEventListener('pointerup', endConnection, { once: true });
}

function updateTemporaryConnection(event) {
  if (!state.activeConnection) return;
  const pointer = screenToWorld(event.clientX, event.clientY);
  state.activeConnection.pointer = pointer;
  renderConnections();
}

function endConnection(event) {
  document.removeEventListener('pointermove', updateTemporaryConnection);
  const target = event.target.closest('.note-dot');
  if (!target || !state.activeConnection) {
    state.activeConnection = null;
    renderConnections();
    return;
  }

  const targetNoteEl = target.closest('.note');
  const targetNote = state.notes.get(targetNoteEl.dataset.id);
  const targetSide = target.dataset.side;

  if (targetNote && targetSide && targetNote.id !== state.activeConnection.from) {
    const snapshot = serializeState();
    state.connections.push({
      id: generateId(),
      from: state.activeConnection.from,
      fromSide: state.activeConnection.side,
      to: targetNote.id,
      toSide: targetSide,
    });
    pushUndo('Create connection', snapshot);
    persistState();
  }
  state.activeConnection = null;
  renderConnections();
}

function renderConnections() {
  elements.connectionsSvg.innerHTML = '';

  const pathFragment = document.createDocumentFragment();

  function drawConnection(fromPoint, toPoint, connection) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const deltaX = toPoint.x - fromPoint.x;
    const controlOffset = Math.max(60, Math.abs(deltaX) * 0.6);
    const control1 = fromPoint.x + controlOffset * (fromPoint.x < toPoint.x ? 1 : -1);
    const control2 = toPoint.x - controlOffset * (fromPoint.x < toPoint.x ? 1 : -1);
    const d = `M${fromPoint.x},${fromPoint.y} C${control1},${fromPoint.y} ${control2},${toPoint.y} ${toPoint.x},${toPoint.y}`;
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    const strokeMultiplier = state.scale <= 1 ? 1 / state.scale : 1;
    const selected = connection && state.connectionSelection.has(connection.id);
    const highlighted = connection && (state.activeConnection?.from === connection.from || state.activeConnection?.to === connection.to);
    const strokeWidth = selected || highlighted ? 3 * strokeMultiplier : 2 * strokeMultiplier;
    path.setAttribute('stroke-width', strokeWidth);
    if (selected) {
      path.setAttribute('stroke', 'rgba(140, 127, 247, 0.9)');
    } else if (highlighted) {
      path.setAttribute('stroke', 'rgba(255,255,255,0.45)');
    } else {
      path.setAttribute('stroke', 'rgba(255,255,255,0.25)');
    }
    if (connection) {
      path.dataset.connectionId = connection.id;
      path.classList.add('connection-path');
      path.style.pointerEvents = 'stroke';
      path.style.cursor = 'pointer';
      path.addEventListener('pointerdown', handleConnectionPointerDown);
    }
    pathFragment.appendChild(path);
  }

  state.connections.forEach((connection) => {
    const fromNote = state.notes.get(connection.from);
    const toNote = state.notes.get(connection.to);
    if (!fromNote || !toNote) return;

    const fromPoint = getConnectionPoint(fromNote, connection.fromSide);
    const toPoint = getConnectionPoint(toNote, connection.toSide);
    drawConnection(fromPoint, toPoint, connection);
  });

  if (state.activeConnection) {
    const fromNote = state.notes.get(state.activeConnection.from);
    if (fromNote) {
      const fromPoint = getConnectionPoint(fromNote, state.activeConnection.side);
      drawConnection(fromPoint, state.activeConnection.pointer, null);
      const tempPath = pathFragment.lastChild;
      if (tempPath) {
        tempPath.classList.add('connection-temp');
        tempPath.setAttribute('stroke', 'rgba(255,255,255,0.7)');
      }
    }
  }

  elements.connectionsSvg.appendChild(pathFragment);
}

function handleConnectionPointerDown(event) {
  const path = event.currentTarget;
  const connectionId = path.dataset.connectionId;
  if (!connectionId) return;
  event.preventDefault();
  event.stopPropagation();

  const isShift = event.shiftKey;
  if (isShift) {
    if (state.connectionSelection.has(connectionId)) {
      state.connectionSelection.delete(connectionId);
    } else {
      state.connectionSelection.add(connectionId);
    }
  } else {
    if (state.selection.size) {
      state.selection.clear();
      updateSelectionStyles();
    }
    state.connectionSelection.clear();
    state.connectionSelection.add(connectionId);
  }

  renderConnections();
}

function getConnectionPoint(note, side) {
  const rect = note.element.getBoundingClientRect();
  const containerRect = elements.gridContainer.getBoundingClientRect();
  const x = side === 'left' ? rect.left + 12 : rect.right - 12;
  const y = rect.top + 14;
  const world = screenToWorld(x, y);
  return world;
}

function triggerGeneration(sourceNote) {
  if (!state.settings.baseUrl || !state.settings.apiKey || !state.settings.model) {
    toggleMenu(true);
    return;
  }

  const context = buildContext(sourceNote.id);
  if (!context.prompt) {
    return;
  }

  const snapshot = serializeState();
  const targetPosition = findAvailablePosition(sourceNote);
  const outputNote = createNote({
    x: targetPosition.x,
    y: targetPosition.y,
    type: 'output',
    width: sourceNote.width,
    height: 260,
    title: 'Generating…',
  });

  renderConnections();
  state.connections.push({
    id: generateId(),
    from: sourceNote.id,
    fromSide: 'right',
    to: outputNote.id,
    toSide: 'left',
  });
  renderConnections();
  pushUndo('Generate output', snapshot);
  persistState();

  callModel(context.prompt)
    .then((result) => {
      if (outputNote.textarea) {
        outputNote.textarea.readOnly = false;
        outputNote.textarea.value = result.trim();
        outputNote.textarea.readOnly = true;
        autoResize(outputNote);
      }
      outputNote.element.querySelector('.note-title').textContent = context.title;
    })
    .catch((error) => {
      if (outputNote.textarea) {
        outputNote.textarea.readOnly = false;
        outputNote.textarea.value = `⚠️ ${error.message}`;
        outputNote.textarea.readOnly = true;
        autoResize(outputNote);
      }
      outputNote.element.querySelector('.note-title').textContent = 'Generation error';
    })
    .finally(() => {
      persistState();
    });
}

function buildContext(noteId) {
  const visited = new Set();
  const queue = [noteId];
  const segments = [];
  const images = [];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    const note = state.notes.get(currentId);
    if (!note) continue;
    if (note.textarea && note.type !== 'output') {
      segments.push(note.textarea.value.trim());
    }
    if (note.type === 'image' && note.imageData) {
      images.push(`[Image attached to ${note.id}]`);
    }

    state.connections
      .filter((connection) => connection.to === currentId)
      .forEach((connection) => queue.push(connection.from));
  }

  const prompt = [...images.reverse(), ...segments.reverse()].join('\n\n').trim();
  const title = segments[segments.length - 1]?.split('\n')[0]?.slice(0, 40) || 'Output';
  return { prompt, title };
}

function findAvailablePosition(note) {
  const padding = 40;
  let x = snapToGrid(note.x + note.width + padding);
  let y = note.y;
  while (
    Array.from(state.notes.values()).some((other) => {
      if (other.id === note.id) return false;
      const overlapX = Math.abs(other.x - x) < note.width;
      const overlapY = Math.abs(other.y - y) < note.height;
      return overlapX && overlapY;
    })
  ) {
    y = snapToGrid(y + note.height + padding);
  }
  return { x, y };
}

async function callModel(prompt) {
  const settings = state.settings;
  const response = await fetch(settings.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: 'system', content: 'You are Subform, a co-designer for branching prompt workflows. Reply with concrete, structured insights.' },
        { role: 'user', content: prompt },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  const data = await response.json();
  if (Array.isArray(data.choices) && data.choices[0]?.message?.content) {
    return data.choices[0].message.content;
  }
  if (typeof data.output === 'string') return data.output;
  if (data.result) return data.result;
  return JSON.stringify(data, null, 2);
}

function toggleMenu(force) {
  const expanded = force ?? elements.menuButton.getAttribute('aria-expanded') === 'false';
  elements.menuButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function handleMenuClick(event) {
  if (event.target === elements.menuSave) return;
  if (elements.menuButton.getAttribute('aria-expanded') === 'true') return;
  toggleMenu(true);
}

function handleDocumentClick(event) {
  if (!elements.menuButton.contains(event.target)) {
    toggleMenu(false);
  }
}

function saveSettings() {
  unmaskApiKeyIfNeeded();
  const config = {
    baseUrl: elements.inputBase.value.trim(),
    apiKey: elements.inputKey.value.trim(),
    model: elements.inputModel.value.trim() || 'deepseek-v3-250324',
    remember: elements.inputRemember.checked,
  };

  if (!config.baseUrl || !config.apiKey) {
    pulseLoadingBar('error');
    return;
  }

  state.settings = config;
  saveSettingsToStorage(config);
  state.notes.forEach((note) => {
    if (note.type !== 'output') note.modelLabel.textContent = config.model;
  });
  elements.inputKey.value = '•'.repeat(config.apiKey.length);
  elements.inputKey.dataset.masked = 'true';
  pulseLoadingBar('success');
  toggleMenu(false);
}

function pulseLoadingBar(status) {
  elements.loadingBar.style.opacity = '1';
  elements.loadingBar.style.width = '100%';
  elements.loadingBar.style.background = status === 'error' ? 'rgba(255,111,97,0.28)' : 'rgba(108,92,231,0.3)';
  setTimeout(() => {
    elements.loadingBar.style.opacity = '0';
    elements.loadingBar.style.width = '0';
  }, 600);
}

function toggleCaptureLayer(show) {
  const next = typeof show === 'boolean' ? show : elements.captureLayer.getAttribute('aria-hidden') === 'true';
  elements.captureLayer.setAttribute('aria-hidden', next ? 'false' : 'true');
  elements.captureTrigger.setAttribute('aria-expanded', next ? 'true' : 'false');
  if (next) {
    applyCaptureToUI();
    setTimeout(() => {
      elements.captureLayer.querySelector('.capture-panel').focus?.();
    }, 0);
  }
}

function centerCanvas() {
  state.scale = 1;
  state.translateX = -(CANVAS_SIZE / 2 - innerWidth / 2);
  state.translateY = -(CANVAS_SIZE / 2 - innerHeight / 2);
  applyTransform();
}

function handleWheel(event) {
  if (event.ctrlKey || state.isSpacePressed) {
    event.preventDefault();
    const delta = event.deltaY * -0.0025;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale * (1 + delta)));
    const rect = elements.gridContainer.getBoundingClientRect();
    const originX = (event.clientX - rect.left) / state.scale;
    const originY = (event.clientY - rect.top) / state.scale;

    state.translateX = snapToGrid(event.clientX - originX * newScale);
    state.translateY = snapToGrid(event.clientY - originY * newScale);
    state.scale = newScale;
    applyTransform();
    return;
  }

  event.preventDefault();
  const factor = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? 60 : 1;
  const deltaX = event.deltaX * factor;
  const deltaY = event.deltaY * factor;
  state.translateX = Math.min(0, Math.max(innerWidth - CANVAS_SIZE * state.scale, state.translateX - deltaX));
  state.translateY = Math.min(0, Math.max(innerHeight - CANVAS_SIZE * state.scale, state.translateY - deltaY));
  applyTransform();
}

function startPan(event) {
  const isCanvasTarget = event.target === elements.gridContainer || event.target === elements.gridCanvas;
  if (!state.isSpacePressed && event.button !== 1) {
    if (event.button === 0 && isCanvasTarget) {
      if (state.selection.size) {
        state.selection.clear();
        updateSelectionStyles();
      }
      clearConnectionSelection();
      renderConnections();
    }
    return;
  }
  event.preventDefault();
  state.pan.active = true;
  state.pan.startX = event.clientX - state.translateX;
  state.pan.startY = event.clientY - state.translateY;
  elements.gridContainer.style.cursor = 'grabbing';
  document.addEventListener('pointermove', panCanvas);
  document.addEventListener('pointerup', endPan, { once: true });
}

function panCanvas(event) {
  if (!state.pan.active) return;
  state.translateX = event.clientX - state.pan.startX;
  state.translateY = event.clientY - state.pan.startY;
  applyTransform();
}

function endPan() {
  state.pan.active = false;
  elements.gridContainer.style.cursor = 'default';
  document.removeEventListener('pointermove', panCanvas);
}

function handleDoubleClick(event) {
  if (event.target !== elements.gridContainer && event.target !== elements.gridCanvas) return;
  const pointer = screenToWorld(event.clientX, event.clientY);
  const snapshot = serializeState();
  const note = createNote({
    x: snapToGrid(pointer.x) - 150,
    y: snapToGrid(pointer.y) - 120,
    content: '',
  });
  state.selection.clear();
  clearConnectionSelection();
  state.selection.add(note.id);
  updateSelectionStyles();
  if (note.textarea) note.textarea.focus();
  pushUndo('Create note', snapshot);
  persistState();
}

function handleKeydown(event) {
  if (event.key === ' ') {
    state.isSpacePressed = true;
    elements.gridContainer.style.cursor = 'grab';
  }

  if (event.key === 'Escape') {
    if (elements.captureLayer.getAttribute('aria-hidden') === 'false') {
      toggleCaptureLayer(false);
    }
    return;
  }

  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undo();
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    redo();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    duplicateSelection();
  }
  if (event.key === 'Backspace' || event.key === 'Delete') {
    if (document.activeElement?.tagName === 'TEXTAREA') return;
    event.preventDefault();
    deleteSelection();
  }
  if ((event.ctrlKey || event.metaKey) && event.key === '0') {
    event.preventDefault();
    centerCanvas();
  }
}

function handleKeyup(event) {
  if (event.key === ' ') {
    state.isSpacePressed = false;
    elements.gridContainer.style.cursor = 'default';
  }
}

function deleteSelection() {
  const hasNotes = state.selection.size > 0;
  const hasConnections = state.connectionSelection.size > 0;
  if (!hasNotes && !hasConnections) return;

  const snapshot = serializeState();
  pushUndo('Delete selection', snapshot);

  if (hasNotes) {
    state.selection.forEach((id) => {
      const note = state.notes.get(id);
      if (!note) return;
      note.element.remove();
      state.notes.delete(id);
    });
  }

  const noteIds = new Set(state.selection);
  state.connections = state.connections.filter(
    (connection) =>
      !noteIds.has(connection.from) &&
      !noteIds.has(connection.to) &&
      !state.connectionSelection.has(connection.id)
  );

  state.selection.clear();
  state.connectionSelection.clear();
  updateSelectionStyles();
  renderConnections();
  persistState();
}

function handlePaste(event) {
  const items = event.clipboardData?.items;
  if (!items) return;
  const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'));
  if (!imageItem) return;
  event.preventDefault();
  const file = imageItem.getAsFile();
  const reader = new FileReader();
  reader.onload = () => {
    const center = screenToWorld(innerWidth / 2, innerHeight / 2);
    const note = createNote({
      x: snapToGrid(center.x - 160),
      y: snapToGrid(center.y - 160),
      width: 320,
      height: 320,
      type: 'image',
      imageData: reader.result,
    });
    state.selection.clear();
    state.selection.add(note.id);
    updateSelectionStyles();
    pushUndo('Paste image');
    persistState();
    renderConnections();
  };
  reader.readAsDataURL(file);
}

function initScrollbars() {
  ['horizontalScrollbar', 'verticalScrollbar'].forEach((key) => {
    const bar = elements[key];
    let dragging = false;
    let startPos = 0;
    let initialTranslate = 0;
    const thumb = bar.querySelector('.scrollbar-thumb');

    const onPointerDown = (event) => {
      event.preventDefault();
      dragging = true;
      startPos = key === 'horizontalScrollbar' ? event.clientX : event.clientY;
      initialTranslate = key === 'horizontalScrollbar' ? state.translateX : state.translateY;
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp, { once: true });
    };

    const onPointerMove = (event) => {
      if (!dragging) return;
      const currentPos = key === 'horizontalScrollbar' ? event.clientX : event.clientY;
      const delta = currentPos - startPos;
      const contentSize = (key === 'horizontalScrollbar' ? CANVAS_SIZE : CANVAS_SIZE) * state.scale;
      const visibleSize = key === 'horizontalScrollbar' ? innerWidth : innerHeight;
      const maxTranslate = visibleSize - contentSize;
      const ratio = contentSize / visibleSize;
      if (key === 'horizontalScrollbar') {
        state.translateX = Math.min(0, Math.max(maxTranslate, initialTranslate + delta * ratio));
      } else {
        state.translateY = Math.min(0, Math.max(maxTranslate, initialTranslate + delta * ratio));
      }
      applyTransform();
    };

    const onPointerUp = () => {
      dragging = false;
      document.removeEventListener('pointermove', onPointerMove);
    };

    thumb.addEventListener('pointerdown', onPointerDown);
  });
}

function initWorkspace(snapshot) {
    if (snapshot) {
      restoreSnapshot(snapshot);
      return;
    }

    const welcome = createNote({
      x: snapToGrid(CANVAS_SIZE / 2 - 360),
      y: snapToGrid(CANVAS_SIZE / 2 - 160),
      width: 320,
      height: 320,
      content:
        'Welcome to Subform—a canvas for branching AI conversations.\n\nDouble-click anywhere to create a note. Drag connections from the side dots to fork ideas.\n\nYour notes stay on this device in IndexedDB.',
    });

    const shortcuts = createNote({
      x: welcome.x + welcome.width + 40,
      y: welcome.y,
      width: 320,
      height: 360,
      content:
        'Handy shortcuts:\n\n• Double-click canvas — new note\n• Option + drag — duplicate note\n• Enter — generate output\n• Space + drag — pan\n• Ctrl/Cmd + mousewheel — zoom\n• Backspace/Delete — remove selection\n• Ctrl/Cmd + Z — undo',
      type: 'output',
      title: 'Handy shortcuts',
    });

    renderConnections();
    state.selection.clear();
    state.selection.add(welcome.id);
    updateSelectionStyles();
    persistState();
}

function toggleScrollbars(visible) {
  const opacity = visible ? '1' : '0';
  const transform = visible ? 'translate(0, 0)' : 'translateY(12px)';
  elements.horizontalScrollbar.style.opacity = opacity;
  elements.horizontalScrollbar.style.transform = transform;
  elements.verticalScrollbar.style.opacity = opacity;
  elements.verticalScrollbar.style.transform = visible ? 'translate(0,0)' : 'translateX(12px)';
}

function installGlobalListeners() {
  elements.gridContainer.addEventListener('dblclick', handleDoubleClick);
  elements.gridContainer.addEventListener('pointerdown', startPan);
  elements.gridContainer.addEventListener('wheel', handleWheel, { passive: false });
  elements.gridCanvas.addEventListener('pointerdown', startPan);
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('keyup', handleKeyup);
  document.addEventListener('paste', handlePaste);
  document.addEventListener('pointermove', () => toggleScrollbars(true));
  document.addEventListener('pointerleave', () => toggleScrollbars(false));

  elements.menuButton.addEventListener('click', handleMenuClick);
  elements.menuSave.addEventListener('click', saveSettings);
  elements.inputKey.addEventListener('focus', unmaskApiKeyIfNeeded);
  window.addEventListener('click', handleDocumentClick);
  window.addEventListener('resize', () => {
    applyTransform();
    persistState();
  });

  if (elements.captureTrigger) {
    elements.captureTrigger.addEventListener('click', () => toggleCaptureLayer(true));
    elements.captureClose.addEventListener('click', () => toggleCaptureLayer(false));
    elements.captureCancel.addEventListener('click', () => toggleCaptureLayer(false));
    elements.captureLayer.addEventListener('click', (event) => {
      if (event.target === elements.captureLayer) toggleCaptureLayer(false);
    });
    elements.captureForm.addEventListener('submit', (event) => {
      event.preventDefault();
      state.capture = {
        enabled: elements.captureEnabled.checked,
        endpoint: elements.captureEndpoint.value.trim(),
        notes: elements.captureNotes.value.trim(),
      };
      saveCaptureSettings(state.capture);
      toggleCaptureLayer(false);
    });
  }
}

async function bootstrap() {
  state.db = await openDatabase();
  const snapshot = await readCanvasState();
  centerCanvas();
  initWorkspace(snapshot);
  updateScrollbars();
  installGlobalListeners();
  initScrollbars();
}

bootstrap().catch((error) => console.error('Failed to bootstrap workspace', error));
