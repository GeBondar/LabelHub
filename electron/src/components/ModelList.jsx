import React, { useEffect, useState, useCallback } from 'react';
import {
  Boxes,
  Upload,
  Play,
  Trash2,
  Pencil,
  Download,
  Info,
  Calendar,
  Cpu,
  Tag,
  AlertCircle,
  Loader2,
  X,
  GraduationCap,
  PackageOpen,
} from 'lucide-react';
import { useApp } from '../App';
import apiClient from '../api/client';
import ModelTester from './ModelTester';

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function RenameModal({ model, onClose, onDone }) {
  const [name, setName] = useState(model.name);
  const [loading, setLoading] = useState(false);
  const { addToast } = useApp();

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await apiClient.renameModel(model.id, name.trim());
      onDone();
      onClose();
    } catch (err) {
      addToast('Не удалось переименовать: ' + (err.message || ''), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center animate-fade-in">
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-bold mb-4">Переименовать модель</h2>
        <form onSubmit={submit}>
          <input
            className="input-field mb-4"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={255}
          />
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
              Отмена
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? <Loader2 size={16} className="loading-spinner inline" /> : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InfoModal({ model, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center animate-fade-in" onClick={onClose}>
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{model.name}</h2>
          <button className="p-1 hover:bg-slate-700 rounded-lg" onClick={onClose}><X size={18} /></button>
        </div>
        <dl className="space-y-2 text-sm">
          <Row k="Тип" v={model.kind === 'trained' ? 'Обучена' : 'Импортирована'} />
          <Row k="Базовая модель" v={model.base_model || '—'} />
          <Row k="Проект-источник" v={model.project_name || '—'} />
          <Row k="imgsz" v={model.imgsz} />
          <Row k="mAP50" v={model.map50 != null ? model.map50.toFixed(3) : '—'} />
          <Row k="mAP50-95" v={model.map5095 != null ? model.map5095.toFixed(3) : '—'} />
          <Row k="Создана" v={fmtDate(model.created_at)} />
        </dl>
        <div className="mt-4">
          <p className="text-xs text-slate-400 mb-1">Классы ({model.classes.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {model.classes.length === 0 && <span className="text-xs text-slate-500">нет данных</span>}
            {model.classes.map((c, i) => (
              <span key={i} className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-200">{c}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-400">{k}</dt>
      <dd className="text-slate-200 text-right">{v}</dd>
    </div>
  );
}

function ModelCard({ model, onTest, onRename, onDelete, onInfo, onExport }) {
  const trained = model.kind === 'trained';
  return (
    <div className="card group flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-2 rounded-lg flex-shrink-0 ${trained ? 'bg-blue-900/40 text-blue-400' : 'bg-purple-900/40 text-purple-400'}`}>
            {trained ? <GraduationCap size={18} /> : <PackageOpen size={18} />}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-200 truncate">{model.name}</h3>
            <span className={`text-[10px] uppercase tracking-wider ${trained ? 'text-blue-400' : 'text-purple-400'}`}>
              {trained ? 'обучена' : 'импортирована'}
            </span>
          </div>
        </div>
      </div>

      {model.missing && (
        <div className="flex items-center gap-1.5 text-xs text-red-400 mb-2">
          <AlertCircle size={12} /> Файл весов не найден
        </div>
      )}

      <div className="space-y-1.5 text-xs text-slate-400 flex-1">
        {trained && (
          <div className="flex items-center justify-between">
            <span>mAP50 / 50-95</span>
            <span className="text-slate-200">
              {model.map50 != null ? model.map50.toFixed(3) : '—'} / {model.map5095 != null ? model.map5095.toFixed(3) : '—'}
            </span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Cpu size={12} /> {model.base_model || (trained ? '—' : 'внешняя .pt')}
        </div>
        <div className="flex items-center gap-1.5">
          <Tag size={12} /> {model.classes.length} классов{model.project_name ? ` · ${model.project_name}` : ''}
        </div>
        <div className="flex items-center gap-1.5">
          <Calendar size={12} /> {fmtDate(model.created_at)}
        </div>
      </div>

      <div className="flex items-center gap-1 mt-3 pt-3 border-t border-slate-700/60">
        <button
          className="btn-primary flex-1 flex items-center justify-center gap-1.5 text-sm py-1.5 disabled:opacity-40"
          onClick={() => onTest(model)}
          disabled={model.missing}
          title="Тестировать на видео"
        >
          <Play size={14} /> Тестировать
        </button>
        <IconBtn title="Метрики и инфо" onClick={() => onInfo(model)}><Info size={15} /></IconBtn>
        <IconBtn title="Переименовать" onClick={() => onRename(model)}><Pencil size={15} /></IconBtn>
        <IconBtn title="Экспорт весов" onClick={() => onExport(model)} disabled={model.missing}><Download size={15} /></IconBtn>
        <IconBtn title="Удалить" danger onClick={() => onDelete(model)}><Trash2 size={15} /></IconBtn>
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, title, danger, disabled }) {
  return (
    <button
      className={`p-2 rounded-lg transition disabled:opacity-30 ${
        danger ? 'text-slate-400 hover:text-red-400 hover:bg-red-900/30' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
      }`}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export default function ModelList() {
  const { addToast } = useApp();
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [tester, setTester] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [infoTarget, setInfoTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.getModels();
      setModels(res.data || []);
    } catch (e) {
      addToast('Не удалось загрузить модели', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const handleImport = async () => {
    if (!window.electronAPI?.selectModelFile) {
      addToast('Импорт доступен только в десктоп-приложении', 'error');
      return;
    }
    const path = await window.electronAPI.selectModelFile();
    if (!path) return;
    setImporting(true);
    try {
      await apiClient.importModel({ path });
      addToast('Модель импортирована', 'success');
      await load();
    } catch (e) {
      addToast('Ошибка импорта: ' + (e.message || ''), 'error', 7000);
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (model) => {
    if (!confirm(`Удалить модель "${model.name}"?${model.kind === 'imported' ? ' Файл весов будет удалён.' : ''}`)) return;
    try {
      await apiClient.deleteModel(model.id);
      addToast('Модель удалена', 'success');
      load();
    } catch (e) {
      addToast('Ошибка удаления: ' + (e.message || ''), 'error');
    }
  };

  const handleExport = (model) => {
    const url = apiClient.exportModelUrl(model.id);
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50 flex-shrink-0">
        <div>
          <h2 className="text-xl font-bold">Модели</h2>
          <p className="text-sm text-slate-400 mt-0.5">Обученные и импортированные модели для тестирования</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={handleImport} disabled={importing}>
          {importing ? <Loader2 size={16} className="loading-spinner" /> : <Upload size={16} />}
          Импортировать модель
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 size={32} className="loading-spinner text-blue-400" />
          </div>
        ) : models.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-4">
            <Boxes size={64} strokeWidth={1} />
            <div className="text-center">
              <p className="text-lg font-medium">Нет моделей</p>
              <p className="text-sm mt-1">Завершите обучение в проекте или импортируйте .pt</p>
            </div>
            <button className="btn-primary flex items-center gap-2" onClick={handleImport} disabled={importing}>
              <Upload size={16} /> Импортировать модель
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {models.map((m) => (
              <ModelCard
                key={m.id}
                model={m}
                onTest={setTester}
                onRename={setRenameTarget}
                onInfo={setInfoTarget}
                onDelete={handleDelete}
                onExport={handleExport}
              />
            ))}
          </div>
        )}
      </div>

      {tester && <ModelTester model={tester} onClose={() => setTester(null)} />}
      {renameTarget && (
        <RenameModal model={renameTarget} onClose={() => setRenameTarget(null)} onDone={load} />
      )}
      {infoTarget && <InfoModal model={infoTarget} onClose={() => setInfoTarget(null)} />}
    </div>
  );
}
