// Lightweight i18n. Keys ARE the English source text, so `t('Save')` returns
// "Save" in English (the default) and the Russian override when lang === 'ru'.
// Missing Russian entries fall back to the English key, so the UI never breaks.

export const LANGUAGES = [
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'ru', label: 'Русский', short: 'RU' },
];

const STORAGE_KEY = 'labelhub.lang';

export function loadLang() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'en' || v === 'ru') return v;
  } catch (e) { /* ignore */ }
  return 'en'; // default English
}

export function saveLang(lang) {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
}

// English key -> Russian translation.
const RU = {
  // --- header / nav / status ---
  'Annotation, training and model storage tool': 'Инструмент аннотации, обучения и хранения моделей',
  'Datasets': 'Датасеты',
  'Models': 'Модели',
  'Server error: {msg}': 'Ошибка сервера: {msg}',
  'Language': 'Язык',

  // --- common toasts / errors ---
  'Failed to load projects': 'Не удалось загрузить проекты',
  'Failed to load classes': 'Не удалось загрузить классы',
  'Failed to load frames': 'Не удалось загрузить кадры',
};

export function makeT(lang) {
  return function t(key, params) {
    let s = (lang === 'ru' && RU[key] != null) ? RU[key] : key;
    if (params) {
      for (const k in params) s = s.split('{' + k + '}').join(String(params[k]));
    }
    return s;
  };
}

// Allow other modules to register translations (so each component can keep its
// strings nearby) without editing this file for every string.
export function addTranslations(map) {
  Object.assign(RU, map);
}
