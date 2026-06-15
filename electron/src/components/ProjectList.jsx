import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  FolderOpen,
  Trash2,
  Image as ImageIcon,
  Tag,
  Calendar,
  Upload,
  Film,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useApp } from '../App';
import apiClient from '../api/client';
import ImportPanel from './ImportPanel';
import { addTranslations } from '../i18n';

addTranslations({
  'OBB (oriented boxes)': 'OBB (ориентированные боксы)',
  'Rotated rectangles with a heading arrow (YOLO-OBB)': 'Повёрнутые прямоугольники со стрелкой направления (YOLO-OBB)',
  'Detection (plain boxes)': 'Детекция (обычные боксы)',
  'Axis-aligned rectangles (YOLO detect)': 'Прямоугольники без поворота (YOLO detect)',
  'Segmentation (polygons)': 'Сегментация (полигоны)',
  'Instance segmentation polygons + SAM2 (YOLO-seg)': 'Instance-сегментация полигонами + SAM2 (YOLO-seg)',
  'Enter a project name': 'Введите название проекта',
  'Failed to create project': 'Ошибка создания проекта',
  'Create a new project': 'Создать новый проект',
  'Project name *': 'Название проекта *',
  'My annotation project': 'Мой проект разметки',
  'Description': 'Описание',
  'Project description...': 'Описание проекта...',
  'Network type *': 'Тип нейросети *',
  'The type is fixed at creation and drives the annotation tools, export and training.':
    'Тип фиксируется при создании и определяет инструменты разметки, экспорт и обучение.',
  'Cancel': 'Отмена',
  'Create': 'Создать',
  'Project "{name}" deleted': 'Проект "{name}" удалён',
  'Failed to delete project': 'Ошибка удаления проекта',
  'Delete project?': 'Удалить проект?',
  'Do you really want to delete the project "{name}"?': 'Вы действительно хотите удалить проект "{name}"?',
  'All data, including frames and annotations, will be permanently deleted.':
    'Все данные, включая кадры и аннотации, будут безвозвратно удалены.',
  'Delete project': 'Удалить проект',
  'Total frames': 'Всего кадров',
  'Labeled frames / total annotations': 'Размечено кадров / всего аннотаций',
  'Manage annotation projects': 'Управление проектами аннотации',
  'Import dataset': 'Импорт датасета',
  'New project': 'Новый проект',
  'No projects': 'Нет проектов',
  'Create a new project or import an existing dataset': 'Создайте новый проект или импортируйте существующий датасет',
  'Create project': 'Создать проект',
});

const TASK_TYPE_LABEL = { obb: 'OBB', detect: 'Detect', segment: 'Segment' };

const TASK_TYPES = [
  { id: 'obb', name: 'OBB (oriented boxes)', desc: 'Rotated rectangles with a heading arrow (YOLO-OBB)' },
  { id: 'detect', name: 'Detection (plain boxes)', desc: 'Axis-aligned rectangles (YOLO detect)' },
  { id: 'segment', name: 'Segmentation (polygons)', desc: 'Instance segmentation polygons + SAM2 (YOLO-seg)' },
];

function CreateProjectModal({ onClose, onCreated }) {
  const { t } = useApp();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [taskType, setTaskType] = useState('obb');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(t('Enter a project name'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      await apiClient.createProject({
        name: name.trim(),
        description: description.trim(),
        task_type: taskType,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err.message || t('Failed to create project'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center animate-fade-in">
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-bold mb-4">{t('Create a new project')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm text-slate-400 mb-1">{t('Project name *')}</label>
            <input
              className="input-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('My annotation project')}
              autoFocus
              maxLength={255}
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm text-slate-400 mb-1">{t('Description')}</label>
            <textarea
              className="input-field resize-none h-24"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('Project description...')}
              maxLength={2000}
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm text-slate-400 mb-2">{t('Network type *')}</label>
            <div className="space-y-2">
              {TASK_TYPES.map((opt) => (
                <label
                  key={opt.id}
                  className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${
                    taskType === opt.id
                      ? 'border-blue-500 bg-blue-900/20'
                      : 'border-slate-600 bg-slate-700/30 hover:border-slate-500'
                  }`}
                >
                  <input
                    type="radio"
                    name="task_type"
                    value={opt.id}
                    checked={taskType === opt.id}
                    onChange={() => setTaskType(opt.id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-200">{t(opt.name)}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{t(opt.desc)}</div>
                  </div>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {t('The type is fixed at creation and drives the annotation tools, export and training.')}
            </p>
          </div>
          {error && (
            <div className="mb-4 flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
              {t('Cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? <Loader2 size={16} className="loading-spinner inline" /> : t('Create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ project, onClose, onDeleted }) {
  const [loading, setLoading] = useState(false);
  const { addToast, t } = useApp();

  const handleDelete = async () => {
    setLoading(true);
    try {
      await apiClient.deleteProject(project.id);
      addToast(t('Project "{name}" deleted', { name: project.name }), 'success');
      onDeleted();
      onClose();
    } catch (err) {
      addToast(t('Failed to delete project'), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center animate-fade-in">
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-center gap-3 mb-4 text-red-400">
          <AlertCircle size={24} />
          <h2 className="text-lg font-bold">{t('Delete project?')}</h2>
        </div>
        <p className="text-slate-400 mb-2">
          {t('Do you really want to delete the project "{name}"?', { name: project.name })}
        </p>
        <p className="text-sm text-slate-500 mb-6">
          {t('All data, including frames and annotations, will be permanently deleted.')}
        </p>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={onClose} disabled={loading}>
            {t('Cancel')}
          </button>
          <button className="btn-danger" onClick={handleDelete} disabled={loading}>
            {loading ? <Loader2 size={16} className="loading-spinner inline" /> : t('Delete')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ project, onDelete, onSelect }) {
  const { t, lang } = useApp();
  const [thumbnail, setThumbnail] = useState(null);
  const [stats, setStats] = useState(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient.getProject(project.id).then((res) => {
      if (!cancelled) {
        const p = res.data;
        setStats({
          total_frames: p.frame_count || 0,
          labeled_frames: p.labeled_frame_count || 0,
          total_annotations: p.annotation_count || 0,
        });
      }
    }).catch(() => {});

    apiClient.getProjectFrames(project.id, { page_size: 1 }).then((res) => {
      if (!cancelled && res.data?.items?.length > 0) {
        const frame = res.data.items[0];
        setThumbnail(apiClient.getFrameThumbUrl(project.id, frame.image_path));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [project.id]);

  const formatDate = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  };

  return (
    <div
      className="card group cursor-pointer hover:border-blue-500/50"
      onClick={() => onSelect(project.id)}
    >
      <div className="w-full h-36 rounded-lg bg-slate-900 overflow-hidden mb-3 border border-slate-700">
        {thumbnail && !imgError ? (
          <img
            src={thumbnail}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-600">
            <Film size={40} />
          </div>
        )}
      </div>
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-slate-200 truncate flex-1">{project.name}</h3>
          {project.task_type && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 border border-slate-600 flex-shrink-0 uppercase">
              {TASK_TYPE_LABEL[project.task_type] || project.task_type}
            </span>
          )}
          <button
            className="p-1 rounded hover:bg-red-900/40 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
            onClick={(e) => { e.stopPropagation(); onDelete(project); }}
            title={t('Delete project')}
          >
            <Trash2 size={16} />
          </button>
        </div>
        {project.description && (
          <p className="text-xs text-slate-400 line-clamp-2">{project.description}</p>
        )}
        <div className="flex items-center gap-4 text-xs text-slate-500">
          {stats && (
            <>
              <span className="flex items-center gap-1" title={t('Total frames')}>
                <ImageIcon size={12} />
                {stats.total_frames || 0}
              </span>
              <span
                className="flex items-center gap-1"
                title={t('Labeled frames / total annotations')}
              >
                <Tag size={12} />
                {stats.labeled_frames || 0} / {stats.total_annotations || 0}
              </span>
            </>
          )}
          <span className="flex items-center gap-1 ml-auto">
            <Calendar size={12} />
            {formatDate(project.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function ProjectList() {
  const navigate = useNavigate();
  const { projects, projectsLoading, loadProjects, addToast, t } = useApp();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleSelect = (id) => navigate(`/project/${id}`);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50 flex-shrink-0">
        <div>
          <h2 className="text-xl font-bold">{t('Datasets')}</h2>
          <p className="text-sm text-slate-400 mt-0.5">{t('Manage annotation projects')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-secondary flex items-center gap-2" onClick={() => setShowImport(true)}>
            <Upload size={16} />
            {t('Import dataset')}
          </button>
          <button className="btn-primary flex items-center gap-2" onClick={() => setShowCreate(true)}>
            <Plus size={16} />
            {t('New project')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {projectsLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 size={32} className="loading-spinner text-blue-400" />
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-4">
            <FolderOpen size={64} strokeWidth={1} />
            <div className="text-center">
              <p className="text-lg font-medium">{t('No projects')}</p>
              <p className="text-sm mt-1">{t('Create a new project or import an existing dataset')}</p>
            </div>
            <button className="btn-primary flex items-center gap-2" onClick={() => setShowCreate(true)}>
              <Plus size={16} />
              {t('Create project')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onSelect={handleSelect}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={loadProjects}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          project={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={loadProjects}
        />
      )}

      {showImport && (
        <ImportPanel
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); loadProjects(); }}
        />
      )}
    </div>
  );
}
