import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Search,
  Filter,
  Image as ImageIcon,
  CheckCircle2,
  Upload,
  Loader2,
  Folder,
  ChevronLeft,
  Film,
  Tag,
} from 'lucide-react';
import apiClient from '../api/client';

export default function FrameGallery({
  view = 'frames',          // 'folders' | 'frames'
  sources = [],
  frames,
  currentIndex,
  projectId,
  total = 0,
  hasMore = false,
  loading = false,
  showBack = false,
  activeName = '',
  activeKind = '',          // 'video' | 'imported' | 'class' | 'all'
  onOpenSource,
  onBack,
  onSelectFrame,
  onUploadClick,
  onLoadMore,
}) {
  const [filter, setFilter] = useState('all');
  const [searchIdx, setSearchIdx] = useState('');
  const galleryRef = useRef(null);

  const filteredFrames = useMemo(() => {
    let result = frames;
    if (filter === 'labeled') result = result.filter((f) => f.is_labeled);
    if (filter === 'unlabeled') result = result.filter((f) => !f.is_labeled);
    if (searchIdx) {
      const num = parseInt(searchIdx);
      if (!isNaN(num)) result = result.filter((f) => f.frame_index === num);
    }
    return result;
  }, [frames, filter, searchIdx]);

  useEffect(() => {
    if (view === 'frames' && galleryRef.current && currentIndex >= 0) {
      const thumb = galleryRef.current.querySelector(`[data-idx="${currentIndex}"]`);
      if (thumb) thumb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentIndex, view]);

  // Infinite scroll: load the next chunk when scrolled near the bottom.
  const handleScroll = useCallback((e) => {
    if (!hasMore || loading || !onLoadMore) return;
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) onLoadMore();
  }, [hasMore, loading, onLoadMore]);

  // ----------------------------------------------------------------- folders
  if (view === 'folders') {
    return (
      <div className="h-full flex flex-col bg-slate-900/50">
        <div className="p-2 border-b border-slate-700/50 text-xs text-slate-400 font-medium flex items-center gap-1.5">
          <Folder size={14} /> Папки ({sources.length})
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {sources.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-slate-600 gap-2">
              <ImageIcon size={24} />
              <p className="text-xs">Нет кадров</p>
            </div>
          ) : (
            sources.map((s) => (
              <button
                key={`${s.kind}:${s.video_id ?? 'imp'}`}
                className="w-full text-left frame-thumb hover:border-blue-500/60"
                onClick={() => onOpenSource(s)}
                title={s.name}
              >
                <div className="aspect-video bg-slate-800 relative">
                  {s.thumb ? (
                    <img
                      src={apiClient.getFrameThumbUrl(projectId, s.thumb)}
                      alt=""
                      className="w-full h-full object-cover opacity-90"
                      loading="lazy"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  ) : null}
                  {/* Folder badge — marks this card as a folder, not a single photo. */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-black/10" />
                  <div className="absolute top-1 left-1 bg-blue-600/90 px-1.5 py-0.5 rounded text-[10px] text-white flex items-center gap-1">
                    {s.kind === 'imported' ? <Tag size={10} /> : <Film size={10} />}
                    Папка
                  </div>
                  <div className="absolute bottom-1 left-1 right-1">
                    <div className="text-[11px] text-white font-medium truncate flex items-center gap-1">
                      <Folder size={11} className="flex-shrink-0 text-blue-300" />
                      {s.name}
                    </div>
                    <div className="text-[10px] text-slate-300">
                      {s.frame_count} кадров · {s.labeled_count} разм.
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
        <div className="p-2 border-t border-slate-700/50">
          <button
            className="w-full btn-secondary flex items-center justify-center gap-1.5 text-xs py-2"
            onClick={onUploadClick}
          >
            <Upload size={14} />
            Загрузить видео
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ frames
  return (
    <div className="h-full flex flex-col bg-slate-900/50">
      <div className="p-2 border-b border-slate-700/50 space-y-2">
        {(showBack || activeKind === 'class') && (
          <button
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 w-full"
            onClick={onBack}
            title="Назад к папкам"
          >
            <ChevronLeft size={14} />
            <span className="truncate">
              {activeKind === 'class' ? `Класс: ${activeName}` : activeName || 'Назад'}
            </span>
          </button>
        )}
        <div className="flex items-center gap-1">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              className="w-full pl-7 pr-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200
                         focus:outline-none focus:border-blue-500 placeholder:text-slate-600"
              placeholder="№ кадра..."
              value={searchIdx}
              onChange={(e) => setSearchIdx(e.target.value)}
              type="number"
              min="0"
            />
          </div>
          <button
            className={`p-1.5 rounded-lg transition text-slate-400 hover:text-slate-200 hover:bg-slate-700 ${
              filter !== 'all' ? 'bg-slate-700 text-blue-400' : ''
            }`}
            onClick={() => setFilter(filter === 'all' ? 'labeled' : filter === 'labeled' ? 'unlabeled' : 'all')}
            title={`Фильтр: ${filter === 'all' ? 'Все' : filter === 'labeled' ? 'Размеченные' : 'Неразмеченные'}`}
          >
            <Filter size={14} />
          </button>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{filteredFrames.length} загружено / {total} кадров</span>
          <div className="flex gap-2">
            <button
              className={`px-1.5 py-0.5 rounded transition ${filter === 'all' ? 'bg-slate-700 text-slate-200' : 'hover:text-slate-300'}`}
              onClick={() => setFilter('all')}
            >Все</button>
            <button
              className={`px-1.5 py-0.5 rounded transition ${filter === 'labeled' ? 'bg-green-900/40 text-green-400' : 'hover:text-slate-300'}`}
              onClick={() => setFilter('labeled')}
            >Разм.</button>
            <button
              className={`px-1.5 py-0.5 rounded transition ${filter === 'unlabeled' ? 'bg-yellow-900/40 text-yellow-400' : 'hover:text-slate-300'}`}
              onClick={() => setFilter('unlabeled')}
            >Неразм.</button>
          </div>
        </div>
      </div>

      <div ref={galleryRef} className="flex-1 overflow-y-auto p-2 space-y-1" onScroll={handleScroll}>
        {filteredFrames.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center h-32 text-slate-600 gap-2">
            <ImageIcon size={24} />
            <p className="text-xs">Нет кадров</p>
          </div>
        ) : (
          filteredFrames.map((frame) => {
            const originalIndex = frames.findIndex((f) => f.id === frame.id);
            const isActive = originalIndex === currentIndex;
            const isLabeled = frame.is_labeled;
            return (
              <div
                key={frame.id}
                data-idx={originalIndex}
                className={`frame-thumb ${isActive ? 'active' : ''} ${isLabeled ? 'labeled' : ''}`}
                onClick={() => onSelectFrame(originalIndex)}
              >
                <div className="aspect-video bg-slate-800 relative">
                  <img
                    src={apiClient.getFrameThumbUrl(projectId, frame.image_path)}
                    alt={`Кадр ${frame.frame_index}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.parentElement.classList.add('flex', 'items-center', 'justify-center');
                    }}
                  />
                  <div className="absolute top-1 left-1 bg-black/70 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-300">
                    {frame.frame_index}
                  </div>
                  {isLabeled && (
                    <div className="absolute top-1 right-1">
                      <CheckCircle2 size={14} className="text-green-400" />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        {loading && (
          <div className="flex items-center justify-center py-3 text-slate-500 gap-2 text-xs">
            <Loader2 size={14} className="loading-spinner" /> Загрузка…
          </div>
        )}
        {!loading && hasMore && (
          <button
            className="w-full text-xs text-blue-400 hover:text-blue-300 py-2"
            onClick={onLoadMore}
          >
            Загрузить ещё 500
          </button>
        )}
      </div>

      <div className="p-2 border-t border-slate-700/50">
        <button
          className="w-full btn-secondary flex items-center justify-center gap-1.5 text-xs py-2"
          onClick={onUploadClick}
        >
          <Upload size={14} />
          Загрузить видео
        </button>
      </div>
    </div>
  );
}
