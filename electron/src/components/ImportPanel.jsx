import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  FolderOpen,
  FileText,
  Upload,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Info,
  RefreshCw,
} from 'lucide-react';
import { useApp } from '../App';
import apiClient from '../api/client';

const IMPORT_TASK_TYPES = [
  { id: 'obb', label: 'OBB', desc: 'Ориентированные боксы (class x1 y1 … x4 y4)' },
  { id: 'detect', label: 'Detect', desc: 'Обычные боксы (class cx cy w h)' },
  { id: 'segment', label: 'Сегментация', desc: 'Полигоны instance-сегментации (class x1 y1 … xn yn)' },
];

const TASK_TO_FORMAT = { obb: 'yolov8-obb', detect: 'yolov8-detect', segment: 'yolov8-seg' };

export default function ImportPanel({ onClose, onImported }) {
  const { addToast, loadProjects } = useApp();
  const [taskType, setTaskType] = useState('obb');
  const format = TASK_TO_FORMAT[taskType];
  const [importPath, setImportPath] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [classMapping, setClassMapping] = useState({});
  const [mergeStrategy, setMergeStrategy] = useState('append');
  const [step2, setStep2] = useState('select');

  const handleBrowse = async () => {
    if (!window.electronAPI) {
      addToast('Обзор папок доступен только в десктоп-приложении. Вставьте путь вручную.', 'info', 5000);
      return;
    }
    const path = await window.electronAPI.selectDirectory();
    if (path) {
      setImportPath(path);
      setError('');
      setPreview(null);
    }
  };

  const handleFileBrowse = async () => {
    if (!window.electronAPI) {
      addToast('Обзор папок доступен только в десктоп-приложении. Вставьте путь вручную.', 'info', 5000);
      return;
    }
    const path = await window.electronAPI.selectDirectory();
    if (path) {
      setImportPath(path);
      setError('');
      setPreview(null);
    }
  };

  const handlePreview = async () => {
    if (!importPath) return;
    setPreviewLoading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('path', importPath);
      form.append('format', format);
      const res = await apiClient.previewImport(0, form);
      setPreview(res.data);
      if (res.data.classes) {
        const mapping = {};
        res.data.classes.forEach((cls) => {
          mapping[cls] = cls;
        });
        setClassMapping(mapping);
      }
      setStep2('preview');
    } catch (err) {
      setError(err.message || 'Ошибка предпросмотра');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleImport = async () => {
    if (!projectName.trim()) {
      setError('Введите название проекта');
      return;
    }
    setImporting(true);
    setProgress(0);
    setError('');

    try {
      const createRes = await apiClient.createProject({
        name: projectName.trim(),
        description: `Импорт из ${format.toUpperCase()}`,
        task_type: taskType,
      });
      const newProjectId = createRes.data.id;

      const res = await apiClient.importFromDir(newProjectId, {
        path: importPath,
        format,
        merge_strategy: mergeStrategy,
        class_mapping: classMapping,
      });

      setProgress(100);
      setDone(true);
      addToast('Датасет импортирован', 'success');
      setTimeout(() => {
        onImported && onImported();
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.message || 'Ошибка импорта');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center animate-fade-in">
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Upload size={20} className="text-blue-400" />
            Импорт датасета
          </h2>
          <button className="p-1 hover:bg-slate-700 rounded-lg transition" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Task type of the imported dataset (matches project types). */}
        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-2 font-medium">Тип размеченного датасета (YOLO)</label>
          <div className="flex gap-2">
            {IMPORT_TASK_TYPES.map((t) => (
              <button
                key={t.id}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  taskType === t.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
                onClick={() => { setTaskType(t.id); setImportPath(''); setPreview(null); }}
                title={t.desc}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-500 mt-1">
            {IMPORT_TASK_TYPES.find((t) => t.id === taskType)?.desc}
          </p>
        </div>

        {/* Path Select */}
        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-1 font-medium">
            Папка датасета
          </label>
          <div className="flex gap-2">
            <input
              className="input-field flex-1"
              value={importPath}
              onChange={(e) => setImportPath(e.target.value)}
              placeholder="C:\\datasets\\my_dataset"
            />
            <button className="btn-secondary flex items-center gap-1" onClick={handleFileBrowse}>
              <FolderOpen size={14} />
              Обзор
            </button>
          </div>
          <button
            className="btn-secondary text-xs mt-2 flex items-center gap-1"
            onClick={handlePreview}
            disabled={!importPath || previewLoading}
          >
            {previewLoading ? <Loader2 size={14} className="loading-spinner" /> : <Info size={14} />}
            Предпросмотр
          </button>
        </div>

        {/* Preview */}
        {preview && (
          <div className="mb-4 p-3 bg-slate-700/30 border border-slate-600 rounded-lg">
            <h3 className="text-sm font-medium text-slate-300 mb-2">Предпросмотр датасета</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Изображений:</span>
                <span className="text-slate-200">{preview.image_count || preview.total_images || '?'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Аннотаций:</span>
                <span className="text-slate-200">{preview.annotation_count || preview.total_annotations || '?'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Классов:</span>
                <span className="text-slate-200">{preview.class_count || (preview.classes?.length || '?')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Тип:</span>
                <span className="text-slate-200">
                  {IMPORT_TASK_TYPES.find((t) => t.id === taskType)?.label} · {format}
                </span>
              </div>
            </div>
            {preview.classes && preview.classes.length > 0 && (
              <div className="mt-2">
                <p className="text-[10px] text-slate-500 mb-1">Обнаруженные классы:</p>
                <div className="flex flex-wrap gap-1">
                  {preview.classes.map((cls) => (
                    <span key={cls} className="px-2 py-0.5 bg-slate-600 rounded text-[10px] text-slate-300">
                      {cls}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Project Name */}
        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-1 font-medium">Название проекта</label>
          <input
            className="input-field"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Мой импортированный датасет"
          />
        </div>

        {/* Merge Strategy */}
        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-2 font-medium">Стратегия импорта</label>
          <div className="flex gap-2">
            {[
              { id: 'append', label: 'Добавить' },
              { id: 'replace', label: 'Заменить' },
            ].map((s) => (
              <button
                key={s.id}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  mergeStrategy === s.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
                onClick={() => setMergeStrategy(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-500 mt-1">
            {mergeStrategy === 'append'
              ? 'Добавить импортируемые данные к существующим в проекте'
              : 'Заменить все данные проекта импортируемыми'}
          </p>
        </div>

        {/* Progress */}
        {(importing || done) && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>{importing ? (step || 'Импорт...') : 'Импорт завершён'}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full progress-bar ${done ? 'bg-green-500' : 'bg-blue-500'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={onClose} disabled={importing}>
            Отмена
          </button>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={handleImport}
            disabled={importing || done || !importPath || !projectName.trim()}
          >
            {importing ? (
              <Loader2 size={16} className="loading-spinner" />
            ) : (
              <Upload size={16} />
            )}
            {done ? 'Готово' : 'Импортировать'}
          </button>
        </div>
      </div>
    </div>
  );
}
