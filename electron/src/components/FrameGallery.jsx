import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Search,
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
import { useApp } from '../App';
import { addTranslations } from '../i18n';

addTranslations({
  'Folders': 'Папки',
  'No frames': 'Нет кадров',
  'Folder': 'Папка',
  'Back to folders': 'Назад к папкам',
  'Back': 'Назад',
  'Class: {name}': 'Класс: {name}',
  'Frame #...': '№ кадра...',
  'All': 'Все',
  'Labeled': 'Разм.',
  'Unlabeled': 'Неразм.',
  'shown {n}': 'показано {n}',
  'loaded {n}': 'загружено {n}',
  '{n} labeled': '{n} разм.',
  'Loading…': 'Загрузка…',
  'Load 500 more': 'Загрузить ещё 500',
  'Upload video': 'Загрузить видео',
});

// Plural form for "frame" — Russian has three forms, English two.
function framesWord(n, lang) {
  if (lang === 'ru') {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a >= 11 && a <= 14) return 'кадров';
    if (b === 1) return 'кадр';
    if (b >= 2 && b <= 4) return 'кадра';
    return 'кадров';
  }
  return n === 1 ? 'frame' : 'frames';
}

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
  const { t, lang } = useApp();
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
          <Folder size={14} /> {t('Folders')} ({sources.length})
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {sources.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-slate-600 gap-2">
              <ImageIcon size={24} />
              <p className="text-xs">{t('No frames')}</p>
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
                    {t('Folder')}
                  </div>
                  <div className="absolute bottom-1 left-1 right-1">
                    <div className="text-[11px] text-white font-medium truncate flex items-center gap-1">
                      <Folder size={11} className="flex-shrink-0 text-blue-300" />
                      {s.name}
                    </div>
                    <div className="text-[10px] text-slate-300">
                      {s.frame_count} {framesWord(s.frame_count, lang)} · {t('{n} labeled', { n: s.labeled_count })}
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
            {t('Upload video')}
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
            title={t('Back to folders')}
          >
            <ChevronLeft size={14} />
            <span className="truncate">
              {activeKind === 'class' ? t('Class: {name}', { name: activeName }) : activeName || t('Back')}
            </span>
          </button>
        )}
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="w-full pl-7 pr-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200
                       focus:outline-none focus:border-blue-500 placeholder:text-slate-600"
            placeholder={t('Frame #...')}
            value={searchIdx}
            onChange={(e) => setSearchIdx(e.target.value)}
            type="number"
            min="0"
          />
        </div>

        {/* Segmented filter control */}
        <div className="flex p-0.5 bg-slate-800 border border-slate-700 rounded-lg text-[11px] font-medium">
          {[
            { id: 'all', label: t('All'), active: 'bg-slate-600 text-white' },
            { id: 'labeled', label: t('Labeled'), active: 'bg-green-600/80 text-white' },
            { id: 'unlabeled', label: t('Unlabeled'), active: 'bg-amber-600/80 text-white' },
          ].map((f) => (
            <button
              key={f.id}
              className={`flex-1 px-1 py-1 rounded-md transition ${
                filter === f.id ? f.active : 'text-slate-400 hover:text-slate-200'
              }`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Count summary */}
        <div className="flex items-center justify-between text-[11px] text-slate-500 px-0.5">
          <span className="flex items-center gap-1">
            <ImageIcon size={12} className="text-slate-600" />
            <span className="text-slate-200 font-semibold tabular-nums">{total}</span>
            <span>{framesWord(total, lang)}</span>
          </span>
          {(filter !== 'all' || searchIdx)
            ? <span className="tabular-nums">{t('shown {n}', { n: filteredFrames.length })}</span>
            : frames.length < total
              ? <span className="tabular-nums">{t('loaded {n}', { n: frames.length })}</span>
              : null}
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
                    alt={`Frame ${frame.frame_index}`}
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
            <Loader2 size={14} className="loading-spinner" /> {t('Loading…')}
          </div>
        )}
        {!loading && hasMore && (
          <button
            className="w-full text-xs text-blue-400 hover:text-blue-300 py-2"
            onClick={onLoadMore}
          >
            {t('Load 500 more')}
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
