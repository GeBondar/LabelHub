import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  X,
  Upload,
  Film,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Play,
  Zap,
  FileVideo,
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { useApp } from '../App';
import apiClient from '../api/client';
import { addTranslations } from '../i18n';

addTranslations({
  'Video upload': 'Загрузка видео',
  'Failed to read the file ({status})': 'Не удалось прочитать файл ({status})',
  'File is empty or unavailable': 'Файл пуст или недоступен',
  'Video uploaded': 'Видео загружено',
  'Upload error': 'Ошибка загрузки',
  'Starting frame extraction...': 'Начало извлечения кадров...',
  'Frames extracted': 'Кадры извлечены',
  'Frame extraction error': 'Ошибка извлечения кадров',
  'Unknown': 'Неизвестно',
  'B': 'Б', 'KB': 'КБ', 'MB': 'МБ', 'GB': 'ГБ',
  'Drop the file to upload': 'Отпустите файл для загрузки',
  'Drag a video here': 'Перетащите видео сюда',
  'MP4, AVI, MOV, MKV, WebM (up to 10 GB)': 'MP4, AVI, MOV, MKV, WebM (до 10 ГБ)',
  'Or choose a file': 'Или выберите файл',
  'Uploading...': 'Загрузка...',
  'Upload': 'Загрузить',
  'Video uploaded successfully': 'Видео загружено успешно',
  'Frame rate to extract (FPS)': 'Частота кадров для извлечения (FPS)',
  'Recommended 2–5 FPS for annotation': 'Рекомендуется 2-5 FPS для аннотации',
  'Extracting frames...': 'Извлечение кадров...',
  'Extract frames': 'Извлечь кадры',
});

const FPS_OPTIONS = [0.5, 1, 2, 5, 10, 15, 30];

export default function VideoUploader({ projectId, onClose, onComplete }) {
  const { addToast, t } = useApp();
  const [file, setFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [videoId, setVideoId] = useState(null);
  const [selectedFps, setSelectedFps] = useState(5);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [extractStep, setExtractStep] = useState('');
  const [extractDone, setExtractDone] = useState(false);
  const [error, setError] = useState('');
  const wsUnsubRef = useRef(null);

  useEffect(() => {
    return () => {
      if (wsUnsubRef.current) wsUnsubRef.current();
    };
  }, []);

  const onDrop = useCallback((accepted) => {
    if (accepted.length > 0) {
      setFile(accepted[0]);
      setError('');
      setUploaded(false);
      setUploadProgress(0);
      setExtractDone(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'video/*': ['.mp4', '.avi', '.mov', '.mkv', '.webm'] },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024 * 1024,
  });

  const handleBrowse = async () => {
    if (!window.electronAPI) return;
    const path = await window.electronAPI.selectVideoFile();
    if (path) {
      const name = path.split(/[\\/]/).pop();
      setFile({ name, path, size: 0 });
      setError('');
      setUploaded(false);
      setExtractDone(false);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const fileObj = file.path
        ? await (async () => {
            // Windows paths use backslashes and a drive letter; a valid file URL
            // needs forward slashes, three leading slashes and percent-encoding
            // (spaces etc.). 'file://C:\...' would silently fail to load.
            const url = 'file:///' + encodeURI(file.path.replace(/\\/g, '/'));
            const res = await fetch(url);
            if (!res.ok) throw new Error(t('Failed to read the file ({status})', { status: res.status }));
            const blob = await res.blob();
            if (!blob.size) throw new Error(t('File is empty or unavailable'));
            return new File([blob], file.name, { type: blob.type || 'video/mp4' });
          })()
        : file;

      const res = await apiClient.uploadVideo(projectId, fileObj, (pct) => {
        setUploadProgress(pct);
      });

      setVideoId(res.data.video_id || res.data.id);
      setUploaded(true);
      addToast(t('Video uploaded'), 'success');
    } catch (err) {
      setError(err.message || t('Upload error'));
    } finally {
      setUploading(false);
    }
  };

  const handleExtract = async () => {
    if (!videoId) return;
    setExtracting(true);
    setExtractStep(t('Starting frame extraction...'));
    setError('');

    wsUnsubRef.current = apiClient.onWsMessage((data) => {
      if (data.type === 'progress' && data.task_id?.startsWith('extract')) {
        setExtractProgress(data.progress);
        setExtractStep(data.message);
      } else if (data.type === 'error') {
        setError(data.message);
      }
    });

    try {
      await apiClient.extractFrames(videoId, selectedFps);
      setExtractDone(true);
      addToast(t('Frames extracted'), 'success');
      setTimeout(() => {
        onComplete();
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.message || t('Frame extraction error'));
    } finally {
      setExtracting(false);
      if (wsUnsubRef.current) {
        wsUnsubRef.current();
        wsUnsubRef.current = null;
      }
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return t('Unknown');
    const units = [t('B'), t('KB'), t('MB'), t('GB')];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(1)} ${units[i]}`;
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center animate-fade-in">
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Film size={20} className="text-blue-400" />
            {t('Video upload')}
          </h2>
          <button className="p-1 hover:bg-slate-700 rounded-lg transition" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {!uploaded ? (
          <>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                isDragActive
                  ? 'border-blue-400 bg-blue-900/20'
                  : 'border-slate-600 hover:border-slate-500 bg-slate-900/50'
              }`}
            >
              <input {...getInputProps()} />
              <Upload size={40} className="mx-auto mb-3 text-slate-500" />
              {isDragActive ? (
                <p className="text-blue-400 font-medium">{t('Drop the file to upload')}</p>
              ) : (
                <>
                  <p className="text-slate-300 font-medium">{t('Drag a video here')}</p>
                  <p className="text-sm text-slate-500 mt-1">{t('MP4, AVI, MOV, MKV, WebM (up to 10 GB)')}</p>
                </>
              )}
              <button
                type="button"
                className="btn-secondary mt-4 text-xs"
                onClick={(e) => { e.stopPropagation(); handleBrowse(); }}
              >
                {t('Or choose a file')}
              </button>
            </div>

            {file && (
              <div className="mt-4 p-3 bg-slate-700/50 rounded-lg flex items-center gap-3">
                <FileVideo size={24} className="text-blue-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-slate-400">{formatSize(file.size)}</p>
                </div>
              </div>
            )}

            {uploading && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>{t('Uploading...')}</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full progress-bar"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="mt-3 flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle size={16} /> {error}
              </div>
            )}

            <div className="flex justify-end gap-3 mt-4">
              <button className="btn-secondary" onClick={onClose}>{t('Cancel')}</button>
              <button
                className="btn-primary flex items-center gap-2"
                onClick={handleUpload}
                disabled={!file || uploading}
              >
                {uploading ? (
                  <Loader2 size={16} className="loading-spinner" />
                ) : (
                  <Upload size={16} />
                )}
                {t('Upload')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-4 p-3 bg-green-900/20 border border-green-700/30 rounded-lg">
              <CheckCircle2 size={20} className="text-green-400" />
              <div>
                <p className="text-sm font-medium text-green-300">{t('Video uploaded successfully')}</p>
                <p className="text-xs text-green-400/70">{file?.name}</p>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm text-slate-400 mb-2">
                {t('Frame rate to extract (FPS)')}
              </label>
              <div className="flex gap-2 flex-wrap">
                {FPS_OPTIONS.map((fps) => (
                  <button
                    key={fps}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                      selectedFps === fps
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                    onClick={() => setSelectedFps(fps)}
                  >
                    {fps} FPS
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {t('Recommended 2–5 FPS for annotation')}
              </p>
            </div>

            {(extracting || extractDone) && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span className="flex items-center gap-1">
                    {extracting && <Zap size={12} className="text-yellow-400" />}
                    {extractStep || t('Extracting frames...')}
                  </span>
                  <span>{Math.round(extractProgress)}%</span>
                </div>
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full progress-bar ${extractDone ? 'bg-green-500' : 'bg-blue-500'}`}
                    style={{ width: `${extractProgress}%` }}
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
              <button className="btn-secondary" onClick={onClose}>{t('Close')}</button>
              <button
                className="btn-primary flex items-center gap-2"
                onClick={handleExtract}
                disabled={extracting || extractDone}
              >
                {extracting ? (
                  <Loader2 size={16} className="loading-spinner" />
                ) : (
                  <Play size={16} />
                )}
                {extractDone ? t('Done') : t('Extract frames')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
