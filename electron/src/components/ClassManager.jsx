import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  Edit3,
  Palette,
  Loader2,
  AlertCircle,
  Check,
  Upload,
} from 'lucide-react';
import { useApp } from '../App';
import apiClient from '../api/client';

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#84cc16',
  '#14b8a6', '#6366f1', '#a855f7', '#d946ef', '#0ea5e9',
  '#10b981', '#f59e0b', '#64748b', '#78716c', '#6d28d9',
];

function ColorPicker({ value, onChange }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <button
        className="w-8 h-8 rounded-lg border-2 border-slate-600 hover:border-slate-400 transition"
        style={{ backgroundColor: value }}
        onClick={() => setShow(!show)}
      />
      {show && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShow(false)} />
          <div className="absolute z-20 top-full mt-2 left-0 bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl w-56">
            <div className="grid grid-cols-5 gap-2 mb-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  className={`w-8 h-8 rounded-md border-2 transition ${
                    value === c ? 'border-white' : 'border-transparent hover:border-slate-400'
                  }`}
                  style={{ backgroundColor: c }}
                  onClick={() => { onChange(c); setShow(false); }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-8 h-8 rounded cursor-pointer bg-transparent border-0 p-0"
              />
              <input
                className="input-field flex-1 text-xs py-1"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="#000000"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function ClassManager({ projectId, onClose }) {
  const { classes, loadClasses, addToast } = useApp();
  const [localClasses, setLocalClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await apiClient.getClasses(projectId);
      setLocalClasses(res.data || []);
    } catch {
      addToast('Ошибка загрузки классов', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newName.trim()) {
      setError('Введите название класса');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await apiClient.createClass(projectId, {
        name: newName.trim(),
        color: newColor,
      });
      setLocalClasses([...localClasses, res.data]);
      setNewName('');
      setNewColor(PRESET_COLORS[localClasses.length % PRESET_COLORS.length]);
      await loadClasses(projectId);
      addToast('Класс добавлен', 'success');
    } catch (err) {
      setError(err.message || 'Ошибка добавления');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (classId) => {
    if (!confirm('Удалить класс? Существующие аннотации этого класса будут удалены.')) return;
    try {
      await apiClient.deleteClass(projectId, classId);
      setLocalClasses(localClasses.filter((c) => c.id !== classId));
      await loadClasses(projectId);
      addToast('Класс удалён', 'success');
    } catch (err) {
      addToast('Ошибка удаления класса', 'error');
    }
  };

  const startEdit = (cls) => {
    setEditingId(cls.id);
    setEditName(cls.name);
    setEditColor(cls.color);
  };

  const saveEdit = async (classId) => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const res = await apiClient.updateClass(projectId, classId, {
        name: editName.trim(),
        color: editColor,
      });
      setLocalClasses(localClasses.map((c) => (c.id === classId ? res.data : c)));
      setEditingId(null);
      await loadClasses(projectId);
      addToast('Класс обновлён', 'success');
    } catch (err) {
      addToast('Ошибка обновления класса', 'error');
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center animate-fade-in">
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Palette size={20} className="text-blue-400" />
            Управление классами
          </h2>
          <button className="p-1 hover:bg-slate-700 rounded-lg transition" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={24} className="loading-spinner text-blue-400" />
          </div>
        ) : (
          <>
            <div className="space-y-1 max-h-64 overflow-y-auto mb-4">
              {localClasses.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">Нет классов</p>
              ) : (
                localClasses.map((cls) => (
                  <div
                    key={cls.id}
                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-700/50 transition group"
                  >
                    {editingId === cls.id ? (
                      <>
                        <ColorPicker value={editColor} onChange={setEditColor} />
                        <input
                          className="input-field flex-1 text-xs py-1.5"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(cls.id);
                            if (e.key === 'Escape') cancelEdit();
                          }}
                        />
                        <button
                          className="p-1 text-green-400 hover:bg-green-900/30 rounded"
                          onClick={() => saveEdit(cls.id)}
                        >
                          <Check size={14} />
                        </button>
                        <button
                          className="p-1 text-slate-400 hover:bg-slate-600 rounded"
                          onClick={cancelEdit}
                        >
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="class-swatch" style={{ backgroundColor: cls.color }} />
                        <span className="flex-1 text-sm text-slate-200 truncate">{cls.name}</span>
                        <span className="text-xs text-slate-500 font-mono w-6 text-right">{cls.index}</span>
                        <button
                          className="p-1 text-slate-500 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition rounded hover:bg-slate-600"
                          onClick={() => startEdit(cls)}
                          title="Редактировать"
                        >
                          <Edit3 size={12} />
                        </button>
                        <button
                          className="p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition rounded hover:bg-red-900/30"
                          onClick={() => handleDelete(cls.id)}
                          title="Удалить"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-slate-700 pt-4">
              <h3 className="text-sm font-medium text-slate-400 mb-2">Добавить класс</h3>
              <div className="flex items-center gap-2">
                <ColorPicker value={newColor} onChange={setNewColor} />
                <input
                  className="input-field flex-1 text-sm py-1.5"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Название класса..."
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                />
                <button
                  className="btn-primary flex items-center gap-1 text-sm py-1.5"
                  onClick={handleAdd}
                  disabled={saving || !newName.trim()}
                >
                  <Plus size={14} />
                  Добавить
                </button>
              </div>
              {error && (
                <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                  <AlertCircle size={12} /> {error}
                </p>
              )}
            </div>
          </>
        )}

        <div className="flex justify-end mt-4">
          <button className="btn-secondary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
