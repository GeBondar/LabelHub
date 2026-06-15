import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Download,
  Layers,
  Tag,
  CheckCircle,
  AlertCircle,
  Loader2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Grid3X3,
  Eye,
  EyeOff,
  Film,
  Activity,
} from 'lucide-react';
import { useApp } from '../App';
import apiClient from '../api/client';
import FrameGallery from './FrameGallery';
import AnnotationCanvas from './AnnotationCanvas';
import ClassManager from './ClassManager';
import ExportPanel from './ExportPanel';
import VideoUploader from './VideoUploader';
import TrainingPanel from './TrainingPanel';

function ToolbarButton({ icon: Icon, label, active, onClick, disabled, shortcut }) {
  return (
    <button
      className={`tool-btn flex items-center gap-1.5 ${active ? 'active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
    >
      <Icon size={16} />
      <span className="hidden lg:inline text-xs">{label}</span>
    </button>
  );
}

export default function ProjectWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    currentProject,
    setCurrentProject,
    frames,
    setFrames,
    currentFrameIndex,
    setCurrentFrameIndex,
    annotations,
    setAnnotations,
    classes,
    loadClasses,
    loadAnnotations,
    addToast,
  } = useApp();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showExport, setShowExport] = useState(false);
  const [showClassManager, setShowClassManager] = useState(false);
  const [showVideoUploader, setShowVideoUploader] = useState(false);
  const [showTraining, setShowTraining] = useState(false);
  const [canvasMode, setCanvasMode] = useState('draw');
  const [selectedClassId, setSelectedClassId] = useState(null);
  const [saving, setSaving] = useState(false);
  const applyClassRef = useRef(null);
  const [editingClassId, setEditingClassId] = useState(null);
  const [editClassName, setEditClassName] = useState('');
  const editInputRef = useRef(null);
  const [changingAnnId, setChangingAnnId] = useState(null);
  const [selectedAnnId, setSelectedAnnId] = useState(null);
  const saveRef = useRef(null);
  const selectAnnotationRef = useRef(null);
  const deleteAnnotationRef = useRef(null);
  const saveTimerRef = useRef(null);
  const [leftWidth, setLeftWidth] = useState(220);
  const [rightWidth, setRightWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(null);

  // Gallery: folders (one per video + Импорт) vs. a chunk-loaded frame list.
  const [sources, setSources] = useState([]);
  const [galleryView, setGalleryView] = useState('frames'); // 'folders' | 'frames'
  const [activeSource, setActiveSource] = useState(null);    // {kind, video_id?, class_id?, name}
  const [framesLoading, setFramesLoading] = useState(false);
  const [framesHasMore, setFramesHasMore] = useState(false);
  const [framesTotal, setFramesTotal] = useState(0);
  const framesPageRef = useRef(1);
  const PAGE = 500;

  const projectId = parseInt(id);
  const taskType = currentProject?.task_type || 'obb';
  const TASK_LABEL = { obb: 'OBB', detect: 'Detect', segment: 'Segment' };

  const currentFrame = frames[currentFrameIndex];
  const currentAnnotations = currentFrame ? (annotations[currentFrame.id] || []) : [];
  const hasFolders = sources.length >= 2;

  // ----------------------------------------------------------- frame loading
  const loadSources = useCallback(async () => {
    try {
      const res = await apiClient.getProjectSources(projectId);
      return res.data || [];
    } catch {
      return [];
    }
  }, [projectId]);

  // Load one 500-frame chunk for a source (video / imported / class / all).
  const loadSourceFrames = useCallback(async (source, page = 1, append = false) => {
    setFramesLoading(true);
    try {
      const params = { page, page_size: PAGE };
      if (source?.kind === 'video') params.video_id = source.video_id;
      else if (source?.kind === 'imported') params.imported = true;
      else if (source?.kind === 'class') params.class_id = source.class_id;
      const res = await apiClient.getProjectFrames(projectId, params);
      const items = res.data?.items || [];
      const total = res.data?.total || 0;
      framesPageRef.current = page;
      setFramesTotal(total);
      setFramesHasMore(page * PAGE < total);
      if (append) {
        setFrames((prev) => [...prev, ...items]);
      } else {
        setFrames(items);
        setCurrentFrameIndex(0);
      }
    } catch (e) {
      addToast('Не удалось загрузить кадры', 'error');
    } finally {
      setFramesLoading(false);
    }
  }, [projectId, addToast, setFrames, setCurrentFrameIndex]);

  const openSource = useCallback((s) => {
    const src = { kind: s.kind, video_id: s.video_id, name: s.name };
    setActiveSource(src);
    setGalleryView('frames');
    loadSourceFrames(src, 1, false);
  }, [loadSourceFrames]);

  const backToFolders = useCallback(async () => {
    setActiveSource(null);
    setGalleryView('folders');
    setFrames([]);
    setSources(await loadSources());
  }, [loadSources, setFrames]);

  const loadMore = useCallback(() => {
    if (framesHasMore && !framesLoading) {
      loadSourceFrames(activeSource, framesPageRef.current + 1, true);
    }
  }, [framesHasMore, framesLoading, activeSource, loadSourceFrames]);

  const exitToDefault = useCallback(() => {
    if (sources.length >= 2) {
      backToFolders();
    } else if (sources[0]) {
      openSource(sources[0]);
    } else {
      const all = { kind: 'all', name: 'Все кадры' };
      setActiveSource(all);
      setGalleryView('frames');
      loadSourceFrames(all, 1, false);
    }
  }, [sources, backToFolders, openSource, loadSourceFrames]);

  // Click a class chip -> show only frames containing it (project-wide, flat);
  // click the same class again -> clear and return to folders / single source.
  const toggleClassFilter = useCallback((classId, name) => {
    if (activeSource?.kind === 'class' && activeSource.class_id === classId) {
      exitToDefault();
    } else {
      const src = { kind: 'class', class_id: classId, name };
      setActiveSource(src);
      setGalleryView('frames');
      loadSourceFrames(src, 1, false);
    }
  }, [activeSource, exitToDefault, loadSourceFrames]);

  const enterInitialView = useCallback(async (srcs) => {
    setSources(srcs);
    if (srcs.length >= 2) {
      setGalleryView('folders');
      setActiveSource(null);
      setFrames([]);
    } else {
      const only = srcs[0];
      const src = only
        ? { kind: only.kind, video_id: only.video_id, name: only.name }
        : { kind: 'all', name: 'Все кадры' };
      setActiveSource(src);
      setGalleryView('frames');
      await loadSourceFrames(src, 1, false);
    }
  }, [loadSourceFrames, setFrames]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoading(true);
      setError('');
      try {
        const projectRes = await apiClient.getProject(projectId);
        if (cancelled) return;
        setCurrentProject(projectRes.data);
        await loadClasses(projectId);
        const srcs = await loadSources();
        if (cancelled) return;
        await enterInitialView(srcs);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Ошибка загрузки проекта');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, [projectId]);

  // Prefetch the next chunk as the user approaches the end of the loaded frames.
  useEffect(() => {
    if (galleryView === 'frames' && framesHasMore && !framesLoading
        && currentFrameIndex >= frames.length - 3) {
      loadMore();
    }
  }, [currentFrameIndex, frames.length, framesHasMore, framesLoading, galleryView, loadMore]);

  useEffect(() => {
    if (classes.length > 0 && !selectedClassId) {
      setSelectedClassId(classes[0].id);
    }
  }, [classes, selectedClassId]);

  useEffect(() => {
    if (currentFrame?.id) {
      loadAnnotations(currentFrame.id);
    }
    setSelectedAnnId(null);
    setChangingAnnId(null);
  }, [currentFrame?.id]);

  // Auto-save: as soon as a frame has any annotation (drawn, SAM2, polygon), it
  // is automatically marked "Размечен" — both in the UI and on the backend — so
  // the user never has to press Save to register a photo into the dataset.
  useEffect(() => {
    if (!currentFrame?.id) return;
    if (currentAnnotations.length > 0 && !currentFrame.is_labeled) {
      setFrames((prev) => prev.map((f) =>
        f.id === currentFrame.id ? { ...f, is_labeled: true } : f));
      apiClient.updateFrameStatus(currentFrame.id, true).catch(() => {});
    }
  }, [currentAnnotations.length, currentFrame?.id, currentFrame?.is_labeled]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        return;
      }

      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        handleManualSave();
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateFrame(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateFrame(1);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // Delete the selected annotation (selected by clicking it on the canvas
        // or in the Аннотации panel).
        e.preventDefault();
        deleteAnnotationRef.current?.();
      } else if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1;
        if (classes[idx]) {
          setSelectedClassId(classes[idx].id);
          addToast(`Выбран класс: ${classes[idx].name}`, 'info', 1500);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [classes, currentFrameIndex, frames]);

  const navigateFrame = useCallback((delta) => {
    setCurrentFrameIndex((prev) => {
      const next = prev + delta;
      if (next < 0 || next >= frames.length) return prev;
      return next;
    });
  }, [frames.length]);

  const handleManualSave = async () => {
    setSaving(true);
    try {
      if (saveRef.current) await saveRef.current();
      if (currentFrame?.id) {
        await apiClient.updateFrameStatus(currentFrame.id, true);
        setFrames(prev => prev.map(f => f.id === currentFrame.id ? { ...f, is_labeled: true } : f));
      }
      addToast('Аннотации сохранены', 'success');
    } catch (e) {
      addToast('Ошибка сохранения: ' + (e.message || ''), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRefreshFrames = async () => {
    // A new video adds a folder; re-evaluate folders vs. single-source view.
    const srcs = await loadSources();
    await enterInitialView(srcs);
    addToast('Список кадров обновлён', 'success');
  };

  const handleMouseMove = useCallback((e) => {
    if (!isResizing) return;
    const containerWidth = document.getElementById('workspace-container')?.offsetWidth || 1200;
    if (isResizing === 'left') {
      const newWidth = Math.max(160, Math.min(400, e.clientX - 60));
      setLeftWidth(newWidth);
    } else if (isResizing === 'right') {
      const newWidth = Math.max(200, Math.min(500, containerWidth - e.clientX - 60));
      setRightWidth(newWidth);
    }
  }, [isResizing]);

  const handleMouseUp = () => setIsResizing(null);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing, handleMouseMove]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={40} className="loading-spinner text-blue-400" />
          <p className="text-slate-400">Загрузка проекта...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <AlertCircle size={48} className="text-red-400" />
          <h2 className="text-xl font-bold">Ошибка загрузки</h2>
          <p className="text-slate-400">{error}</p>
          <div className="flex gap-3">
            <button className="btn-secondary flex items-center gap-2" onClick={() => navigate('/')}>
              <ArrowLeft size={16} /> Назад
            </button>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Повторить
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!currentProject) return null;

  return (
    <div className="h-full flex flex-col overflow-hidden" id="workspace-container">
      {/* Top Toolbar */}
      <div className="h-12 bg-slate-800 border-b border-slate-700 flex items-center px-3 gap-2 flex-shrink-0">
        <button
          className="tool-btn flex items-center gap-1.5"
          onClick={() => navigate('/')}
          title="Назад к проектам"
        >
          <ArrowLeft size={16} />
        </button>

        <div className="h-6 w-px bg-slate-700 mx-1" />

        <span className="text-sm font-medium text-slate-200 px-2 truncate max-w-[200px]">
          {currentProject.name}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-blue-300 border border-slate-600 uppercase flex-shrink-0">
          {TASK_LABEL[taskType] || taskType}
        </span>

        <div className="flex-1" />

        <ToolbarButton
          icon={canvasMode === 'draw' ? Grid3X3 : Grid3X3}
          label="Рисовать"
          active={canvasMode === 'draw'}
          onClick={() => setCanvasMode('draw')}
        />
        <ToolbarButton
          icon={Eye}
          label="Редактировать"
          active={canvasMode === 'edit'}
          onClick={() => setCanvasMode('edit')}
        />
        <ToolbarButton
          icon={EyeOff}
          label="Удалить"
          active={canvasMode === 'delete'}
          onClick={() => setCanvasMode('delete')}
        />

        <div className="h-6 w-px bg-slate-700 mx-1" />

        <ToolbarButton
          icon={Layers}
          label="Классы"
          onClick={() => setShowClassManager(true)}
        />

        <ToolbarButton
          icon={Download}
          label="Экспорт"
          onClick={() => setShowExport(true)}
        />

        <ToolbarButton
          icon={Activity}
          label="Обучение"
          onClick={() => setShowTraining(true)}
        />

        <div className="h-6 w-px bg-slate-700 mx-1" />

        <ToolbarButton
          icon={Save}
          label="Сохранить"
          onClick={handleManualSave}
          shortcut="Ctrl+S"
          disabled={saving}
        />
      </div>

      {/* Class selector bar */}
      {classes.length > 0 && (
        <div className="h-10 bg-slate-800/50 border-b border-slate-700/50 flex items-center px-3 gap-1 overflow-x-auto flex-shrink-0">
          {classes.map((cls, idx) => (
            editingClassId === cls.id ? (
              <form key={cls.id} className="flex items-center gap-1 flex-shrink-0" onSubmit={async (e) => {
                e.preventDefault();
                if (editClassName.trim()) {
                  await apiClient.updateClass(projectId, cls.id, { name: editClassName.trim() });
                  await loadClasses(projectId);
                }
                setEditingClassId(null);
              }}>
                <span className="w-3 h-3 rounded-sm border border-slate-500 flex-shrink-0" style={{ backgroundColor: cls.color }} />
                <input
                  ref={editInputRef}
                  className="bg-slate-900 border border-blue-500 rounded px-1.5 py-0.5 text-xs text-white w-24 outline-none"
                  value={editClassName}
                  onChange={(e) => setEditClassName(e.target.value)}
                  onBlur={() => setEditingClassId(null)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setEditingClassId(null); }}
                  autoFocus
                />
              </form>
            ) : (
              <button
                key={cls.id}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all flex-shrink-0 ${
                  activeSource?.kind === 'class' && activeSource.class_id === cls.id
                    ? 'bg-purple-600 text-white ring-2 ring-purple-300/60'
                    : selectedClassId === cls.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
                onClick={() => {
                  // If an object is selected, the chip reassigns its class.
                  if (applyClassRef.current?.(cls.id)) return;
                  // Otherwise pick it as the drawing class AND filter the gallery
                  // to frames containing it (click again to clear).
                  setSelectedClassId(cls.id);
                  toggleClassFilter(cls.id, cls.name);
                }}
                onDoubleClick={() => {
                  setEditingClassId(cls.id);
                  setEditClassName(cls.name);
                  setTimeout(() => editInputRef.current?.focus(), 10);
                }}
                title={`${idx + 1}: ${cls.name} — клик: фильтр по классу · двойной клик: переименовать`}
              >
                <span className="w-3 h-3 rounded-sm border border-slate-500" style={{ backgroundColor: cls.color }} />
                <span>{idx + 1}. {cls.name}</span>
              </button>
            )
          ))}
        </div>
      )}

      {/* Main Workspace: 3 panels */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Frame Gallery */}
        <div style={{ width: leftWidth }} className="flex-shrink-0 relative">
          <FrameGallery
            view={galleryView}
            sources={sources}
            frames={frames}
            currentIndex={currentFrameIndex}
            projectId={projectId}
            total={framesTotal}
            hasMore={framesHasMore}
            loading={framesLoading}
            showBack={hasFolders && activeSource?.kind !== 'class'}
            activeName={activeSource?.name || ''}
            activeKind={activeSource?.kind || ''}
            onOpenSource={openSource}
            onBack={exitToDefault}
            onSelectFrame={setCurrentFrameIndex}
            onUploadClick={() => setShowVideoUploader(true)}
            onLoadMore={loadMore}
          />
          <div
            className="resizable-handle"
            style={{ right: 0, top: 0 }}
            onMouseDown={() => setIsResizing('left')}
          />
        </div>

        {/* Center: Annotation Canvas */}
        <div className="flex-1 bg-[#0a0f1a] relative overflow-hidden">
          {galleryView === 'folders' ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <Film size={48} className="text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400">Выберите папку слева</p>
                <p className="text-slate-600 text-sm mt-1">Каждое видео — отдельная папка с кадрами</p>
              </div>
            </div>
          ) : frames.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <Film size={48} className="text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 mb-4">
                  {framesLoading ? 'Загрузка кадров…' : 'Нет кадров в проекте'}
                </p>
                {!framesLoading && (
                  <button className="btn-primary" onClick={() => setShowVideoUploader(true)}>
                    Загрузить видео
                  </button>
                )}
              </div>
            </div>
          ) : (
            <AnnotationCanvas
              projectId={projectId}
              taskType={taskType}
              frame={currentFrame}
              annotations={currentAnnotations}
              classes={classes}
              mode={canvasMode}
              selectedClassId={selectedClassId}
              onFrameNavigate={navigateFrame}
              applyClassRef={applyClassRef}
              saveRef={saveRef}
              selectAnnotationRef={selectAnnotationRef}
              deleteActiveRef={deleteAnnotationRef}
              onRefreshAnnotations={() => {
                // will be handled internally
              }}
            />
          )}
        </div>

        {/* Right resize handle */}
        {frames.length > 0 && (
          <div
            className="resizable-handle"
            style={{ left: 0, top: 0, position: 'absolute' }}
          />
        )}

        {/* Right Panel: Info */}
        <div style={{ width: rightWidth }} className="flex-shrink-0 bg-slate-800 border-l border-slate-700 relative">
          <div
            className="resizable-handle"
            style={{ left: 0, top: 0 }}
            onMouseDown={() => setIsResizing('right')}
          />
          <div className="h-full flex flex-col">
            <div className="p-3 border-b border-slate-700">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Информация о кадре</h3>
              {currentFrame ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Кадр:</span>
                    <span className="text-slate-200 font-mono">{currentFrame.frame_index}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Размер:</span>
                    <span className="text-slate-200 font-mono">{currentFrame.width}x{currentFrame.height}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Статус:</span>
                    <span className={currentFrame.is_labeled ? 'text-green-400' : 'text-slate-500'}>
                      {currentFrame.is_labeled ? 'Размечен' : 'Не размечен'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Аннотаций:</span>
                    <span className="text-slate-200 font-mono">{currentAnnotations.length}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Нет активного кадра</p>
              )}
            </div>

            <div className="p-3 border-b border-slate-700">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Горячие клавиши</h3>
              <div className="space-y-1 text-xs text-slate-400">
                <div className="flex justify-between"><span>← →</span><span>Навигация</span></div>
                <div className="flex justify-between"><span>1-9</span><span>Выбор класса</span></div>
                {taskType === 'obb' && (
                  <>
                    <div className="flex justify-between"><span>F / Shift+F</span><span>Направление стрелки ±90°</span></div>
                    <div className="flex justify-between"><span>R / Shift+R</span><span>Поворот БОКСА ±90°</span></div>
                    <div className="flex justify-between"><span>Q / E</span><span>Поворот БОКСА ±5°</span></div>
                  </>
                )}
                {taskType === 'segment' && (
                  <div className="flex justify-between"><span>Двойной клик / Enter</span><span>Замкнуть полигон</span></div>
                )}
                <div className="flex justify-between"><span>Delete</span><span>Удалить объект</span></div>
                <div className="flex justify-between"><span>Ctrl+S</span><span>Сохранить</span></div>
                <div className="flex justify-between"><span>Ctrl+Z / Shift+Z</span><span>Отмена / Повтор</span></div>
                <div className="flex justify-between"><span>Колёсико</span><span>Масштаб</span></div>
                <div className="flex justify-between"><span>Alt+Drag</span><span>Панорама</span></div>
              </div>
            </div>

            <div className="p-3 flex-1 overflow-y-auto">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Аннотации ({currentAnnotations.length})
              </h3>
              {currentAnnotations.length === 0 ? (
                <p className="text-xs text-slate-500">Нет аннотаций на этом кадре</p>
              ) : (
                <div className="space-y-1">
                  {currentAnnotations.map((ann, idx) => {
                    const cls = classes.find((c) => c.id === ann.class_id);
                    return (
                      <div key={ann.id || idx} className="relative">
                        <div
                          className={`flex items-center gap-2 p-1.5 rounded text-xs cursor-pointer transition ${
                            selectedAnnId === ann.id
                              ? 'bg-blue-600/30 ring-1 ring-blue-500/60'
                              : 'bg-slate-700/50 hover:bg-slate-600/50'
                          }`}
                          onClick={() => {
                            setChangingAnnId(changingAnnId === ann.id ? null : ann.id);
                            // Sticky select: this object stays selected so Delete
                            // removes it even after the mouse leaves the row.
                            setSelectedAnnId(ann.id);
                            if (selectAnnotationRef.current) selectAnnotationRef.current(ann.id);
                          }}
                          onMouseEnter={() => {
                            if (selectAnnotationRef.current) selectAnnotationRef.current(ann.id, true);
                          }}
                          onMouseLeave={() => {
                            // Re-assert the sticky selection (don't clear it).
                            if (selectAnnotationRef.current) selectAnnotationRef.current(selectedAnnId || null);
                          }}
                        >
                          <span
                            className="w-3 h-3 rounded-sm flex-shrink-0 border border-slate-600"
                            style={{ backgroundColor: cls?.color || '#666' }}
                          />
                          <span className="text-slate-300 flex-1 truncate">{cls?.name || `#${ann.class_id}`}</span>
                          {ann.is_verified && <CheckCircle size={12} className="text-green-400 flex-shrink-0" />}
                        </div>
                        {changingAnnId === ann.id && (
                          <div className="mt-0.5 ml-5 bg-slate-700 border border-slate-600 rounded-lg py-1 shadow-lg z-10">
                            {classes.map((c) => (
                              <button
                                key={c.id}
                                className={`w-full flex items-center gap-2 px-3 py-1 text-xs hover:bg-slate-600 transition ${
                                  c.id === ann.class_id ? 'text-blue-400' : 'text-slate-300'
                                }`}
                                onClick={async () => {
                                  try {
                                    await apiClient.updateAnnotation(ann.id, { class_id: c.id });
                                    setAnnotations(prev => {
                                      const current = prev[currentFrame?.id] || [];
                                      return { ...prev, [currentFrame?.id]: current.map(a => a.id === ann.id ? { ...a, class_id: c.id } : a) };
                                    });
                                    addToast(`Класс изменён на: ${c.name}`, 'success', 1500);
                                  } catch {
                                    addToast('Ошибка смены класса', 'error');
                                  }
                                  setChangingAnnId(null);
                                }}
                              >
                                <span className="w-3 h-3 rounded-sm border border-slate-500 flex-shrink-0" style={{ backgroundColor: c.color }} />
                                <span>{c.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div className="h-8 bg-slate-800 border-t border-slate-700 flex items-center px-3 gap-4 text-xs text-slate-400 flex-shrink-0">
        <span>
          Кадр {frames.length > 0 ? currentFrameIndex + 1 : 0} / {frames.length}
        </span>
        <span className="h-4 w-px bg-slate-700" />
        <span>
          Аннотаций: {currentAnnotations.length}
        </span>
        <span className="h-4 w-px bg-slate-700" />
        <span>
          Режим: {canvasMode === 'draw' ? 'Рисование' : canvasMode === 'edit' ? 'Редактирование' : 'Удаление'}
        </span>
        <span className="flex-1" />
        {saving ? (
          <span className="flex items-center gap-1 text-blue-400">
            <Loader2 size={12} className="loading-spinner" /> Сохранение...
          </span>
        ) : (
          <span className="flex items-center gap-1 text-green-500/80" title="Разметка сохраняется автоматически">
            <CheckCircle size={12} /> Автосохранение
          </span>
        )}
      </div>

      {/* Modals */}
      {showExport && (
        <ExportPanel
          projectId={projectId}
          taskType={taskType}
          onClose={() => setShowExport(false)}
        />
      )}

      {showClassManager && (
        <ClassManager
          projectId={projectId}
          onClose={() => { setShowClassManager(false); loadClasses(projectId); }}
        />
      )}

      {showVideoUploader && (
        <VideoUploader
          projectId={projectId}
          onClose={() => setShowVideoUploader(false)}
          onComplete={handleRefreshFrames}
        />
      )}

      {showTraining && (
        <TrainingPanel
          projectId={projectId}
          taskType={taskType}
          onClose={() => setShowTraining(false)}
        />
      )}
    </div>
  );
}
