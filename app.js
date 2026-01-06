const modes = {
  'en-mam': {
    id: 'en-mam',
    label: 'Doctor → Patient (English → Mam)',
    source: 'English',
    target: 'Mam',
    sl: 'en',
    tl: 'mam',
    dictateLang: 'en-US'
  },
  'es-mam': {
    id: 'es-mam',
    label: 'Doctor → Patient (Spanish → Mam)',
    source: 'Spanish',
    target: 'Mam',
    sl: 'es',
    tl: 'mam',
    dictateLang: 'es-ES'
  },
  'mam-en': {
    id: 'mam-en',
    label: 'Patient → Doctor (Mam → English)',
    source: 'Mam',
    target: 'English',
    sl: 'mam',
    tl: 'en',
    dictateLang: null
  }
};

let phraseData = [];
let activeCategory = null;
let favorites = new Set();
let activeMode = null;
let longPressTimer = null;

const homeSection = document.getElementById('home');
const workspace = document.getElementById('workspace');
const homeButton = document.getElementById('homeButton');
const modeButtons = document.querySelectorAll('.mode-card');
const modeLabel = document.getElementById('modeLabel');
const modeLang = document.getElementById('modeLang');
const phraseModeBadge = document.getElementById('phraseModeBadge');
const sourceHint = document.getElementById('sourceHint');
const sourceText = document.getElementById('sourceText');
const notesBox = document.getElementById('notesBox');
const openButton = document.getElementById('openButton');
const copyButton = document.getElementById('copyButton');
const clearButton = document.getElementById('clearButton');
const dictateButton = document.getElementById('dictateButton');
const dictationStatus = document.getElementById('dictationStatus');
const categoryChips = document.getElementById('categoryChips');
const phraseList = document.getElementById('phraseList');
const favoriteSection = document.getElementById('favoriteSection');
const favoriteList = document.getElementById('favoriteList');
const phrasebookNote = document.getElementById('phrasebookNote');
const phrasebookCard = document.getElementById('phrasebookCard');

async function loadPhrases() {
  try {
    const res = await fetch('phrases.json');
    const data = await res.json();
    phraseData = data.categories || [];
    renderCategoryChips();
  } catch (err) {
    phrasebookNote.textContent = 'Phrasebook unavailable offline on first load. Try again online.';
    console.error(err);
  }
}

function setMode(modeId) {
  activeMode = modes[modeId];
  if (!activeMode) return;

  modeLabel.textContent = activeMode.label;
  modeLang.textContent = `${activeMode.source} → ${activeMode.target}`;
  phraseModeBadge.textContent = activeMode.source;
  sourceHint.textContent = `Type or paste ${activeMode.source} text to send to Google Translate.`;
  sourceText.placeholder = `Enter ${activeMode.source} text...`;
  sourceText.value = '';
  notesBox.value = '';
  dictationStatus.textContent = '';

  const showDictation = Boolean(activeMode.dictateLang && speechSupported());
  dictateButton.hidden = !showDictation;
  dictateButton.textContent = activeMode.source === 'Spanish' ? '🎙️ Dictate (ES)' : '🎙️ Dictate (EN)';
  phrasebookCard.style.display = 'block';
  phrasebookNote.textContent = activeMode.id === 'mam-en'
    ? 'Phrasebook best supports doctor → patient flows. For Mam input, type exactly what the patient says.'
    : '';

  homeSection.classList.remove('visible');
  workspace.classList.add('visible');
  homeSection.classList.add('panel');
  homeButton.hidden = false;
  renderCategoryChips();
  renderPhrases();
}

function renderCategoryChips() {
  categoryChips.innerHTML = '';
  if (!phraseData.length) return;
  if (!activeCategory) activeCategory = phraseData[0].id;

  phraseData.forEach(cat => {
    const btn = document.createElement('button');
    btn.textContent = cat.label;
    btn.className = activeCategory === cat.id ? 'active' : '';
    btn.addEventListener('click', () => {
      activeCategory = cat.id;
      renderCategoryChips();
      renderPhrases();
    });
    categoryChips.appendChild(btn);
  });
}

function phraseTextForMode(phrase) {
  if (activeMode?.id === 'es-mam') return phrase.es;
  return phrase.en;
}

function renderPhrases() {
  if (!phraseData.length || !activeMode) return;
  phraseList.innerHTML = '';

  const category = phraseData.find(c => c.id === activeCategory);
  if (!category) return;

  const disablePhrases = activeMode.id === 'mam-en';
  phraseList.style.display = disablePhrases ? 'none' : 'grid';
  categoryChips.style.display = disablePhrases ? 'none' : 'flex';

  if (disablePhrases) return;

  category.phrases.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'phrase';
    btn.textContent = phraseTextForMode(item);
    btn.setAttribute('data-id', item.id);

    const star = document.createElement('div');
    star.className = 'star' + (favorites.has(item.id) ? ' active' : '');
    star.textContent = favorites.has(item.id) ? '★' : '☆';
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(item.id);
    });

    btn.addEventListener('pointerdown', () => {
      longPressTimer = setTimeout(() => toggleFavorite(item.id), 600);
    });
    btn.addEventListener('pointerup', () => clearTimeout(longPressTimer));
    btn.addEventListener('pointerleave', () => clearTimeout(longPressTimer));

    btn.addEventListener('click', () => {
      sourceText.value = phraseTextForMode(item);
      sourceText.focus();
    });

    btn.appendChild(star);
    phraseList.appendChild(btn);
  });

  renderFavorites();
}

function renderFavorites() {
  favoriteList.innerHTML = '';
  if (!favorites.size) {
    favoriteSection.hidden = true;
    return;
  }

  const favItems = [];
  phraseData.forEach(cat => {
    cat.phrases.forEach(p => {
      if (favorites.has(p.id)) favItems.push(p);
    });
  });

  favItems.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'phrase';
    btn.textContent = phraseTextForMode(item);

    const star = document.createElement('div');
    star.className = 'star active';
    star.textContent = '★';
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(item.id);
    });

    btn.addEventListener('click', () => {
      sourceText.value = phraseTextForMode(item);
      sourceText.focus();
    });

    btn.appendChild(star);
    favoriteList.appendChild(btn);
  });

  favoriteSection.hidden = false;
}

function toggleFavorite(id) {
  if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
  renderPhrases();
}

function speechSupported() {
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
}

function startDictation() {
  if (!activeMode?.dictateLang) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  const recognition = new SpeechRecognition();
  recognition.lang = activeMode.dictateLang;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    dictationStatus.textContent = 'Listening…';
  };
  recognition.onerror = (event) => {
    dictationStatus.textContent = 'Dictation error: ' + (event.error || 'try again');
  };
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    sourceText.value = (sourceText.value + ' ' + transcript).trim();
    dictationStatus.textContent = 'Captured. Tap Translate to open Google.';
  };
  recognition.onend = () => {
    setTimeout(() => (dictationStatus.textContent = ''), 1500);
  };

  recognition.start();
}

function openTranslate() {
  if (!activeMode) return;
  const text = encodeURIComponent(sourceText.value.trim());
  if (!text) {
    dictationStatus.textContent = 'Enter text to translate.';
    return;
  }
  const url = `https://translate.google.com/?sl=${activeMode.sl}&tl=${activeMode.tl}&text=${text}&op=translate`;
  window.open(url, '_blank', 'noopener');
}

async function copySource() {
  const text = sourceText.value.trim();
  if (!text) {
    dictationStatus.textContent = 'Nothing to copy yet.';
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    dictationStatus.textContent = 'Copied to clipboard.';
  } catch (err) {
    dictationStatus.textContent = 'Clipboard unavailable.';
  }
}

function clearAll() {
  sourceText.value = '';
  notesBox.value = '';
  dictationStatus.textContent = '';
}

function goHome() {
  workspace.classList.remove('visible');
  homeSection.classList.add('visible');
  homeButton.hidden = true;
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(console.error);
    });
  }
}

modeButtons.forEach(btn => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

homeButton.addEventListener('click', goHome);
openButton.addEventListener('click', openTranslate);
copyButton.addEventListener('click', copySource);
clearButton.addEventListener('click', clearAll);
dictateButton.addEventListener('click', startDictation);

loadPhrases();
registerSW();
