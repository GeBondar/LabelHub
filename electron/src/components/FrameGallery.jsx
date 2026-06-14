import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Search,
  Filter,
  Image as ImageIcon,
  CheckCircle2,
  Upload,
  Loader2,
} from 'lucide-react';
import apiClient from '../api/client';

export default function FrameGallery({
  frames,
  currentIndex,
  projectId,
  onSelectFrame,
  onUploadClick,
}) {
  const [filter, setFilter] = useState('all');
  const [searchIdx, setSearchIdx] = useState('');
  const [thumbStatuses, setThumbStatuses] = useState({});
  const galleryRef = useRef(null);

  const filteredFrames = useMemo(() => {
    let result = frames;
    if (filter === 'labeled') result = result.filter((f) => f.is_labeled);
    if (filter === 'unlabeled') result = result.filter((f) => !f.is_labeled);
    if (searchIdx) {
      const num = parseInt(searchIdx);
      if (!isNaN(num)) {
        result = result.filter((f) => f.frame_index === num);
      }
    }
    return result;
  }, [frames, filter, searchIdx]);

  useEffect(() => {
    if (galleryRef.current && currentIndex >= 0) {
      const thumb = galleryRef.current.querySelector(`[data-idx="${currentIndex}"]`);
      if (thumb) {
        thumb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [currentIndex]);

  const handleScroll = useCallback(() => {
    // Virtual scrolling placeholder - in production would implement lazy loading
  }, []);

  return (
    <div className="h-full flex flex-col bg-slate-900/50">
      <div className="p-2 border-b border-slate-700/50 space-y-2">
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
          <span>{filteredFrames.length} / {frames.length} кадров</span>
          <div className="flex gap-2">
            <button
              className={`px-1.5 py-0.5 rounded transition ${filter === 'all' ? 'bg-slate-700 text-slate-200' : 'hover:text-slate-300'}`}
              onClick={() => setFilter('all')}
            >
              Все
            </button>
            <button
              className={`px-1.5 py-0.5 rounded transition ${filter === 'labeled' ? 'bg-green-900/40 text-green-400' : 'hover:text-slate-300'}`}
              onClick={() => setFilter('labeled')}
            >
              Разм.
            </button>
            <button
              className={`px-1.5 py-0.5 rounded transition ${filter === 'unlabeled' ? 'bg-yellow-900/40 text-yellow-400' : 'hover:text-slate-300'}`}
              onClick={() => setFilter('unlabeled')}
            >
              Неразм.
            </button>
          </div>
        </div>
      </div>

      <div
        ref={galleryRef}
        className="flex-1 overflow-y-auto p-2 space-y-1"
        onScroll={handleScroll}
      >
        {filteredFrames.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-slate-600 gap-2">
            <ImageIcon size={24} />
            <p className="text-xs">Нет кадров</p>
          </div>
        ) : (
          filteredFrames.map((frame, idx) => {
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
