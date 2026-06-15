import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Play,
  Pause,
  Square as StopIcon,
  FileVideo,
  Film,
  Webcam,
  Loader2,
  Circle,
  Download,
  Cpu,
  Gauge,
  Crosshair,
  RotateCcw,
} from 'lucide-react';
import { useApp } from '../App';
import apiClient from '../api/client';
import { addTranslations } from '../i18n';

addTranslations({
  'File from disk': 'Файл с диска',
  'Project video': 'Видео проекта',
  'Webcam': 'Веб-камера',
  'File selection is only available in the desktop app': 'Выбор файла доступен только в десктоп-приложении',
  'Select a video file': 'Выберите видео файл',
  'Select a project video': 'Выберите видео проекта',
  'Inference: {msg}': 'Инференс: {msg}',
  'Failed to start the test: {msg}': 'Не удалось запустить тест: {msg}',
  'Model test: {name}': 'Тест модели: {name}',
  'Source': 'Источник',
  'Choose video…': 'Выбрать видео…',
  'Project': 'Проект',
  '— select —': '— выберите —',
  'Video': 'Видео',
  'no videos': 'нет видео',
  'Camera index': 'Индекс камеры',
  'Usually 0 — the built-in camera': 'Обычно 0 — встроенная камера',
  'Confidence threshold': 'Порог уверенности',
  'Start': 'Запустить',
  'Stop inference': 'Остановить',
  'Select a source and click "Start"': 'Выберите источник и нажмите «Запустить»',
  'Play': 'Воспроизвести',
  'Pause': 'Пауза',
  'Run again': 'Запустить заново',
  'Record annotated video': 'Запись размеченного видео',
  'Recording…': 'Запись…',
  'Record': 'Запись',
  'Download the annotated video': 'Скачать размеченное видео',
  'frame {n}': 'кадр {n}',
  'detections: {n}': 'детекций: {n}',
  'finished': 'завершено',
});

const SOURCES = [
  { id: 'file', label: 'File from disk', icon: FileVideo },
  { id: 'project_video', label: 'Project video', icon: Film },
  { id: 'webcam', label: 'Webcam', icon: Webcam },
];

export default function ModelTester({ model, onClose }) {
  const { addToast, t } = useApp();

  const [sourceMode, setSourceMode] = useState('file');
  const [filePath, setFilePath] = useState(null);
  const [webcamIndex, setWebcamIndex] = useState(0);

  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [videos, setVideos] = useState([]);
  const [videoId, setVideoId] = useState('');

  const [sessionId, setSessionId] = useState(null);
  const [status, setStatus] = useState(null);
  const [starting, setStarting] = useState(false);
  const [conf, setConf] = useState(0.25);
  const [seekValue, setSeekValue] = useState(0);
  const [seeking, setSeeking] = useState(false);

  const sessionRef = useRef(null);
  const confTimer = useRef(null);
  const pollTimer = useRef(null);

  // Keep a ref so the unmount cleanup always sees the live session id.
  useEffect(() => { sessionRef.current = sessionId; }, [sessionId]);

  const stopSession = useCallback(async (sid) => {
    const id = sid || sessionRef.current;
    if (!id) return;
    try { await apiClient.stopInference(id); } catch { /* already gone */ }
  }, []);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      stopSession();
    };
  }, [stopSession]);

  // Load projects when switching to the project-video source.
  useEffect(() => {
    if (sourceMode === 'project_video' && projects.length === 0) {
      apiClient.getProjects().then((res) => setProjects(res.data || [])).catch(() => {});
    }
  }, [sourceMode, projects.length]);

  useEffect(() => {
    if (!projectId) { setVideos([]); setVideoId(''); return; }
    apiClient.getProjectVideos(projectId)
      .then((res) => { setVideos(res.data || []); setVideoId(res.data?.[0]?.id || ''); })
      .catch(() => setVideos([]));
  }, [projectId]);

  const pickFile = async () => {
    if (!window.electronAPI?.selectVideoFile) {
      addToast(t('File selection is only available in the desktop app'), 'error');
      return;
    }
    const p = await window.electronAPI.selectVideoFile();
    if (p) setFilePath(p);
  };

  const buildSource = () => {
    if (sourceMode === 'file') {
      if (!filePath) { addToast(t('Select a video file'), 'error'); return null; }
      return { type: 'file', path: filePath };
    }
    if (sourceMode === 'project_video') {
      if (!videoId) { addToast(t('Select a project video'), 'error'); return null; }
      return { type: 'project_video', video_id: Number(videoId) };
    }
    return { type: 'webcam', index: Number(webcamIndex) || 0 };
  };

  const startPolling = useCallback((sid) => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      try {
        const res = await apiClient.inferenceStatus(sid);
        setStatus(res.data);
        if (!seeking) setSeekValue(res.data.frame || 0);
        if (res.data.error) {
          addToast(t('Inference: {msg}', { msg: res.data.error }), 'error', 7000);
          clearInterval(pollTimer.current);
        }
      } catch {
        clearInterval(pollTimer.current);
      }
    }, 700);
  }, [addToast, seeking]);

  const handleStart = async () => {
    const source = buildSource();
    if (!source) return;
    setStarting(true);
    try {
      // Stop any previous session this tester started.
      await stopSession();
      const res = await apiClient.startInference({ model_id: model.id, source });
      const sid = res.data.session_id;
      setSessionId(sid);
      setStatus(res.data);
      setSeekValue(0);
      // Apply the current conf to the fresh session.
      apiClient.inferenceControl(sid, 'conf', conf).catch(() => {});
      startPolling(sid);
    } catch (e) {
      addToast(t('Failed to start the test: {msg}', { msg: e.message || '' }), 'error', 7000);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    await stopSession();
    setSessionId(null);
    setStatus(null);
  };

  const togglePause = () => {
    if (!sessionId || !status) return;
    apiClient.inferenceControl(sessionId, status.paused ? 'play' : 'pause')
      .then((res) => setStatus(res.data)).catch(() => {});
  };

  const onConfChange = (v) => {
    setConf(v);
    if (!sessionId) return;
    if (confTimer.current) clearTimeout(confTimer.current);
    confTimer.current = setTimeout(() => {
      apiClient.inferenceControl(sessionId, 'conf', v).catch(() => {});
    }, 200);
  };

  const onSeekCommit = (v) => {
    setSeeking(false);
    if (sessionId) apiClient.inferenceControl(sessionId, 'seek', v).catch(() => {});
  };

  const toggleRecord = () => {
    if (!sessionId || !status) return;
    apiClient.inferenceControl(sessionId, 'record', status.recording ? 0 : 1)
      .then((res) => setStatus(res.data)).catch(() => {});
  };

  const downloadRecording = () => {
    if (!sessionId) return;
    const url = apiClient.inferenceDownloadUrl(sessionId);
    if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
    else window.open(url, '_blank');
  };

  const isStream = status?.is_stream;
  const streamUrl = sessionId ? apiClient.inferenceStreamUrl(sessionId) : null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center animate-fade-in">
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-5xl shadow-2xl max-h-[94vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-lg font-bold flex items-center gap-2 min-w-0">
            <Play size={18} className="text-blue-400 flex-shrink-0" />
            <span className="truncate">{t('Model test: {name}', { name: model.name })}</span>
          </h2>
          <button className="p-1 hover:bg-slate-700 rounded-lg transition" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex">
          {/* Left: source config */}
          <div className="w-72 flex-shrink-0 border-r border-slate-700 p-4 space-y-4 overflow-y-auto">
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{t('Source')}</h3>
              <div className="grid grid-cols-3 gap-1">
                {SOURCES.map((s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.id}
                      className={`flex flex-col items-center gap-1 p-2 rounded-lg text-[11px] border transition ${
                        sourceMode === s.id ? 'border-blue-500 bg-blue-900/20 text-blue-300' : 'border-slate-700 text-slate-400 hover:bg-slate-700'
                      }`}
                      onClick={() => setSourceMode(s.id)}
                    >
                      <Icon size={18} />
                      {t(s.label).split(' ')[0]}
                    </button>
                  );
                })}
              </div>
            </div>

            {sourceMode === 'file' && (
              <div>
                <button className="btn-secondary w-full text-sm py-2" onClick={pickFile}>
                  {t('Choose video…')}
                </button>
                {filePath && (
                  <p className="text-[11px] text-slate-400 mt-2 break-all" title={filePath}>
                    {filePath.split(/[\\/]/).pop()}
                  </p>
                )}
              </div>
            )}

            {sourceMode === 'project_video' && (
              <div className="space-y-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">{t('Project')}</label>
                  <select className="input-field w-full text-sm py-1.5" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                    <option value="">{t('— select —')}</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">{t('Video')}</label>
                  <select className="input-field w-full text-sm py-1.5" value={videoId} onChange={(e) => setVideoId(e.target.value)} disabled={!videos.length}>
                    {!videos.length && <option value="">{t('no videos')}</option>}
                    {videos.map((v) => <option key={v.id} value={v.id}>{v.original_filename}</option>)}
                  </select>
                </div>
              </div>
            )}

            {sourceMode === 'webcam' && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('Camera index')}</label>
                <input type="number" min="0" max="10" className="input-field w-full text-sm py-1.5"
                  value={webcamIndex} onChange={(e) => setWebcamIndex(e.target.value)} />
                <p className="text-[10px] text-slate-500 mt-1">{t('Usually 0 — the built-in camera')}</p>
              </div>
            )}

            <div>
              <label className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span className="flex items-center gap-1"><Gauge size={12} /> {t('Confidence threshold')}</span>
                <span className="text-slate-200">{conf.toFixed(2)}</span>
              </label>
              <input type="range" min="0.05" max="0.95" step="0.05" className="w-full accent-blue-500"
                value={conf} onChange={(e) => onConfChange(parseFloat(e.target.value))} />
            </div>

            {!sessionId ? (
              <button className="btn-primary w-full flex items-center justify-center gap-2 text-sm py-2"
                onClick={handleStart} disabled={starting}>
                {starting ? <Loader2 size={16} className="loading-spinner" /> : <Play size={16} />}
                {t('Start')}
              </button>
            ) : (
              <button className="btn-danger w-full flex items-center justify-center gap-2 text-sm py-2" onClick={handleStop}>
                <StopIcon size={16} /> {t('Stop inference')}
              </button>
            )}
          </div>

          {/* Right: video + controls */}
          <div className="flex-1 flex flex-col overflow-hidden p-4">
            <div className="flex-1 bg-black rounded-lg overflow-hidden flex items-center justify-center min-h-0">
              {streamUrl ? (
                <img key={sessionId} src={streamUrl} alt="inference" className="max-w-full max-h-full object-contain" />
              ) : (
                <div className="text-slate-600 text-sm flex flex-col items-center gap-2">
                  <Film size={48} strokeWidth={1} />
                  {t('Select a source and click "Start"')}
                </div>
              )}
            </div>

            {/* Controls */}
            {sessionId && (
              <div className="mt-3 space-y-2">
                {!isStream && (
                  <input
                    type="range" min="0" max={status?.total || 0} step="1"
                    className="w-full accent-blue-500"
                    value={seekValue}
                    onMouseDown={() => setSeeking(true)}
                    onChange={(e) => setSeekValue(Number(e.target.value))}
                    onMouseUp={(e) => onSeekCommit(Number(e.target.value))}
                    disabled={!status?.total}
                  />
                )}
                <div className="flex items-center gap-3">
                  <button className="btn-secondary p-2" onClick={togglePause} title={status?.paused ? t('Play') : t('Pause')}>
                    {status?.paused ? <Play size={16} /> : <Pause size={16} />}
                  </button>
                  {status?.finished && !isStream && (
                    <button className="btn-secondary p-2" onClick={handleStart} title={t('Run again')}>
                      <RotateCcw size={16} />
                    </button>
                  )}
                  <button
                    className={`p-2 rounded-lg font-medium transition flex items-center gap-1.5 text-sm ${
                      status?.recording ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                    }`}
                    onClick={toggleRecord}
                    title={t('Record annotated video')}
                  >
                    <Circle size={14} className={status?.recording ? 'fill-current' : ''} />
                    {status?.recording ? t('Recording…') : t('Record')}
                  </button>
                  {status?.has_output && (
                    <button className="btn-secondary p-2 flex items-center gap-1.5 text-sm" onClick={downloadRecording} title={t('Download the annotated video')}>
                      <Download size={14} /> {t('Download')}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Status bar */}
            <div className="mt-3 flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 border-t border-slate-700/60 pt-2">
              <span className="flex items-center gap-1"><Cpu size={12} /> {status?.device || '—'}</span>
              <span className="flex items-center gap-1">
                <Film size={12} /> {t('frame {n}', { n: status?.frame ?? 0 })}{status?.total ? ` / ${status.total}` : ''}
              </span>
              <span>{status?.fps != null ? `${status.fps} FPS` : '—'}</span>
              <span className="flex items-center gap-1"><Crosshair size={12} /> {t('detections: {n}', { n: status?.detections ?? 0 })}</span>
              {status?.finished && <span className="text-green-400">{t('finished')}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
