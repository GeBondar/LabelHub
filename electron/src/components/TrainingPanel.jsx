import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Play,
  Square as StopIcon,
  Trash2,
  Loader2,
  AlertCircle,
  Activity,
  BarChart3,
  Cpu,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useApp } from '../App';
import apiClient from '../api/client';
import { addTranslations } from '../i18n';

addTranslations({
  'Preparing': 'Подготовка',
  'Running': 'Обучается',
  'Completed': 'Завершено',
  'Failed': 'Ошибка',
  'Stopped': 'Остановлено',
  'YOLO-OBB training': 'Обучение YOLO-OBB',
  'YOLO Detect training': 'Обучение YOLO Detect',
  'YOLO Segment training': 'Обучение YOLO Segment',
  'YOLO training': 'Обучение YOLO',
  'Training started · train {train} / val {val} frames': 'Обучение запущено · train {train} / val {val} кадров',
  'Failed to start training: {msg}': 'Не удалось запустить обучение: {msg}',
  'Stopping training...': 'Останавливаю обучение...',
  'Stop error: {msg}': 'Ошибка остановки: {msg}',
  'Remove the training run from the list?': 'Удалить запуск обучения из списка?',
  'Delete error: {msg}': 'Ошибка удаления: {msg}',
  'TensorBoard opened, but there are no events yet — start training (old runs have no TB logs).':
    'TensorBoard открыт, но событий ещё нет — запустите обучение (старые прогоны логов TB не содержат).',
  'Opening TensorBoard...': 'Открываю TensorBoard...',
  'TensorBoard unavailable: {msg}': 'TensorBoard недоступен: {msg}',
  'Open TensorBoard for deep analysis': 'Открыть TensorBoard для глубокого анализа',
  'Parameters': 'Параметры',
  'Base model': 'Базовая модель',
  'Epochs': 'Эпохи',
  'Device': 'Устройство',
  'auto (empty), cpu, 0': 'авто (пусто), cpu, 0',
  '· empty = auto': '· пусто = авто',
  'GPU not detected — training will run on CPU': 'GPU не обнаружен — обучение пойдёт на CPU',
  'Start training': 'Запустить обучение',
  'Runs': 'Запуски',
  'Refresh': 'Обновить',
  'No runs yet': 'Пока нет запусков',
  'ep.': 'эп.',
  'Stop': 'Стоп',
  'auto': 'авто',
  'Select a run or start training': 'Выберите запуск или запустите обучение',
  'Dataset:': 'Датасет:',
  'frames (training uses train/val, no test)': 'кадров (обучение использует train/val, без test)',
  'Epoch {cur} / {total}': 'Эпоха {cur} / {total}',
  'Waiting for the first epoch...': 'Ожидание первой эпохи...',
  'No metrics': 'Нет метрик',
  'Loss': 'Потери (loss)',
  'Quality metrics': 'Метрики качества',
});

const STATUS_LABEL = {
  pending: { text: 'Preparing', color: 'text-yellow-400' },
  running: { text: 'Running', color: 'text-blue-400' },
  completed: { text: 'Completed', color: 'text-green-400' },
  failed: { text: 'Failed', color: 'text-red-400' },
  stopped: { text: 'Stopped', color: 'text-slate-400' },
};

// Build flat chart rows {epoch, <metric>...} from the history endpoint shape
// {epochs:[...], series:{key:[...]}}.
function historyToRows(history) {
  if (!history || !history.epochs) return [];
  const { epochs, series } = history;
  return epochs.map((ep, i) => {
    const row = { epoch: ep };
    for (const key of Object.keys(series || {})) {
      const v = series[key][i];
      if (v !== null && v !== undefined) row[key] = v;
    }
    return row;
  });
}

const TASK_TITLE = {
  obb: 'YOLO-OBB training',
  detect: 'YOLO Detect training',
  segment: 'YOLO Segment training',
};

export default function TrainingPanel({ projectId, taskType = 'obb', onClose }) {
  const { addToast, t } = useApp();

  const defaultModel = { obb: 'yolov8n-obb.pt', detect: 'yolov8n.pt', segment: 'yolov8n-seg.pt' }[taskType] || 'yolov8n-obb.pt';
  const [baseModels, setBaseModels] = useState([defaultModel]);
  const [baseModel, setBaseModel] = useState(defaultModel);
  const [epochs, setEpochs] = useState(100);
  const [imgsz, setImgsz] = useState(640);
  const [batch, setBatch] = useState(16);
  const [device, setDevice] = useState('');
  const [valRatio, setValRatio] = useState(0.2);

  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [starting, setStarting] = useState(false);
  const [tbLoading, setTbLoading] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState(null);

  const selectedRun = runs.find((r) => r.id === selectedRunId) || null;
  const selectedRunRef = useRef(selectedRunId);
  selectedRunRef.current = selectedRunId;

  const loadRuns = useCallback(async () => {
    try {
      const res = await apiClient.getTrainingRuns(projectId);
      setRuns(res.data || []);
      return res.data || [];
    } catch {
      return [];
    }
  }, [projectId]);

  const loadMetrics = useCallback(async (runId) => {
    if (!runId) return;
    try {
      const res = await apiClient.getTrainingMetrics(runId);
      setChartData(historyToRows(res.data));
    } catch {
      setChartData([]);
    }
  }, []);

  useEffect(() => {
    apiClient.getBaseModels(taskType).then((res) => {
      if (res.data?.models?.length) {
        setBaseModels(res.data.models);
        setBaseModel(res.data.models[0]);
      }
    }).catch(() => {});
    apiClient.getDeviceInfo().then((res) => setDeviceInfo(res.data)).catch(() => {});
    loadRuns().then((list) => {
      const active = list.find((r) => r.status === 'running' || r.status === 'pending');
      if (active) {
        setSelectedRunId(active.id);
        loadMetrics(active.id);
      } else if (list.length) {
        setSelectedRunId(list[0].id);
        loadMetrics(list[0].id);
      }
    });
  }, [loadRuns, loadMetrics]);

  // Live updates over the websocket.
  useEffect(() => {
    const unsub = apiClient.onWsMessage((msg) => {
      if (msg.type !== 'training') return;
      // Status/progress changes refresh the runs list.
      loadRuns();
      if (msg.run_id !== selectedRunRef.current) return;

      if (msg.metrics && typeof msg.epoch === 'number') {
        setChartData((prev) => {
          const next = prev.filter((r) => r.epoch !== msg.epoch);
          next.push({ epoch: msg.epoch, ...msg.metrics });
          next.sort((a, b) => a.epoch - b.epoch);
          return next;
        });
      }
      if (msg.status && msg.status !== 'running') {
        const label = t(STATUS_LABEL[msg.status]?.text || msg.status);
        addToast(`${label}${msg.message ? ': ' + msg.message : ''}`,
          msg.status === 'completed' ? 'success' : msg.status === 'failed' ? 'error' : 'info');
        // Reload final metrics from disk for completeness.
        loadMetrics(selectedRunRef.current);
      }
    });
    return unsub;
  }, [loadRuns, loadMetrics, addToast]);

  const handleStart = async () => {
    setStarting(true);
    try {
      const res = await apiClient.startTraining(projectId, {
        base_model: baseModel,
        epochs: Number(epochs),
        imgsz: Number(imgsz),
        batch: Number(batch),
        device,
        val_ratio: Number(valRatio),
      });
      const r = res.data || {};
      addToast(
        t('Training started · train {train} / val {val} frames', { train: r.train_count ?? '?', val: r.val_count ?? '?' }),
        'success', 4000,
      );
      await loadRuns();
      setSelectedRunId(res.data.id);
      setChartData([]);
    } catch (e) {
      addToast(t('Failed to start training: {msg}', { msg: e.message || '' }), 'error', 6000);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async (runId) => {
    try {
      await apiClient.stopTraining(runId);
      addToast(t('Stopping training...'), 'info');
      loadRuns();
    } catch (e) {
      addToast(t('Stop error: {msg}', { msg: e.message || '' }), 'error');
    }
  };

  const handleDelete = async (runId) => {
    if (!confirm(t('Remove the training run from the list?'))) return;
    try {
      await apiClient.deleteTrainingRun(runId);
      const list = await loadRuns();
      if (selectedRunId === runId) {
        setSelectedRunId(list[0]?.id || null);
        setChartData(list[0] ? [] : []);
        if (list[0]) loadMetrics(list[0].id);
      }
    } catch (e) {
      addToast(t('Delete error: {msg}', { msg: e.message || '' }), 'error');
    }
  };

  const handleSelectRun = (runId) => {
    setSelectedRunId(runId);
    loadMetrics(runId);
  };

  const openUrl = (url) => {
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const handleTensorboard = async () => {
    setTbLoading(true);
    try {
      const res = await apiClient.startTensorboard(projectId);
      const url = res.data?.url || 'http://localhost:6006';
      if (res.data?.has_data === false) {
        addToast(t('TensorBoard opened, but there are no events yet — start training (old runs have no TB logs).'), 'info', 7000);
      } else {
        addToast(t('Opening TensorBoard...'), 'success');
      }
      openUrl(url);
    } catch (e) {
      addToast(t('TensorBoard unavailable: {msg}', { msg: e.message || '' }), 'error', 8000);
    } finally {
      setTbLoading(false);
    }
  };

  const lossKeys = [
    { key: 'train_box_loss', name: 'train box', color: '#3b82f6' },
    { key: 'val_box_loss', name: 'val box', color: '#60a5fa' },
    { key: 'train_cls_loss', name: 'train cls', color: '#f97316' },
    { key: 'val_cls_loss', name: 'val cls', color: '#fb923c' },
    { key: 'train_dfl_loss', name: 'train dfl', color: '#a855f7' },
    { key: 'val_dfl_loss', name: 'val dfl', color: '#c084fc' },
    ...(taskType === 'segment' ? [
      { key: 'train_seg_loss', name: 'train seg', color: '#10b981' },
      { key: 'val_seg_loss', name: 'val seg', color: '#34d399' },
    ] : []),
  ];
  const mapKeys = [
    { key: 'map50', name: 'mAP50', color: '#22c55e' },
    { key: 'map5095', name: 'mAP50-95', color: '#14b8a6' },
    { key: 'precision', name: 'precision', color: '#eab308' },
    { key: 'recall', name: 'recall', color: '#ec4899' },
  ];

  const isActive = selectedRun && (selectedRun.status === 'running' || selectedRun.status === 'pending');
  const progressPct = selectedRun && selectedRun.epochs
    ? Math.min(100, Math.round((selectedRun.current_epoch / selectedRun.epochs) * 100))
    : 0;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center animate-fade-in">
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-5xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Activity size={20} className="text-blue-400" />
            {t(TASK_TITLE[taskType] || 'YOLO training')}
          </h2>
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary flex items-center gap-1.5 text-sm py-1.5"
              onClick={handleTensorboard}
              disabled={tbLoading}
              title={t('Open TensorBoard for deep analysis')}
            >
              {tbLoading ? <Loader2 size={14} className="loading-spinner" /> : <BarChart3 size={14} />}
              TensorBoard
              <ExternalLink size={12} />
            </button>
            <button className="p-1 hover:bg-slate-700 rounded-lg transition" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex">
          {/* Left: config + runs list */}
          <div className="w-72 flex-shrink-0 border-r border-slate-700 flex flex-col overflow-y-auto">
            <div className="p-4 space-y-3 border-b border-slate-700">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('Parameters')}</h3>

              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('Base model')}</label>
                <select
                  className="input-field w-full text-sm py-1.5"
                  value={baseModel}
                  onChange={(e) => setBaseModel(e.target.value)}
                >
                  {baseModels.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">{t('Epochs')}</label>
                  <input type="number" min="1" max="2000" className="input-field w-full text-sm py-1.5"
                    value={epochs} onChange={(e) => setEpochs(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">imgsz</label>
                  <input type="number" min="64" max="2048" step="32" className="input-field w-full text-sm py-1.5"
                    value={imgsz} onChange={(e) => setImgsz(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Batch</label>
                  <input type="number" min="1" max="128" className="input-field w-full text-sm py-1.5"
                    value={batch} onChange={(e) => setBatch(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Val %</label>
                  <input type="number" min="5" max="50" className="input-field w-full text-sm py-1.5"
                    value={Math.round(valRatio * 100)}
                    onChange={(e) => setValRatio(Math.max(5, Math.min(50, parseInt(e.target.value) || 20)) / 100)} />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1 flex items-center gap-1">
                  <Cpu size={12} /> {t('Device')}
                </label>
                <input className="input-field w-full text-sm py-1.5" placeholder={t('auto (empty), cpu, 0')}
                  value={device} onChange={(e) => setDevice(e.target.value)} />
                {deviceInfo && (
                  deviceInfo.cuda ? (
                    <p className="text-[10px] mt-1 flex items-center gap-1 text-green-400">
                      <CheckCircle2 size={11} />
                      GPU: {deviceInfo.gpus?.[0]?.name || 'CUDA'}{deviceInfo.device_count > 1 ? ` (+${deviceInfo.device_count - 1})` : ''} {t('· empty = auto')}
                    </p>
                  ) : (
                    <p className="text-[10px] mt-1 text-yellow-400">
                      {t('GPU not detected — training will run on CPU')}
                    </p>
                  )
                )}
              </div>

              <button
                className="btn-primary w-full flex items-center justify-center gap-2 text-sm py-2"
                onClick={handleStart}
                disabled={starting}
              >
                {starting ? <Loader2 size={16} className="loading-spinner" /> : <Play size={16} />}
                {t('Start training')}
              </button>
            </div>

            <div className="p-4 flex-1">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('Runs')}</h3>
                <button className="p-1 hover:bg-slate-700 rounded text-slate-400" onClick={loadRuns} title={t('Refresh')}>
                  <RefreshCw size={12} />
                </button>
              </div>
              <div className="space-y-1">
                {runs.length === 0 && <p className="text-xs text-slate-500">{t('No runs yet')}</p>}
                {runs.map((run) => {
                  const st = STATUS_LABEL[run.status] || { text: run.status, color: 'text-slate-400' };
                  return (
                    <div
                      key={run.id}
                      className={`p-2 rounded-lg cursor-pointer transition border ${
                        selectedRunId === run.id ? 'border-blue-500 bg-blue-900/20' : 'border-transparent bg-slate-700/40 hover:bg-slate-700'
                      }`}
                      onClick={() => handleSelectRun(run.id)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-200 truncate">{run.name}</span>
                        <span className={`text-[10px] ${st.color}`}>{t(st.text)}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-[10px] text-slate-500">
                        <span>{run.base_model.replace('.pt', '')}</span>
                        <span>{run.current_epoch}/{run.epochs} {t('ep.')}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {(run.status === 'running' || run.status === 'pending') ? (
                          <button
                            className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-0.5"
                            onClick={(e) => { e.stopPropagation(); handleStop(run.id); }}
                          >
                            <StopIcon size={10} /> {t('Stop')}
                          </button>
                        ) : (
                          <button
                            className="text-[10px] text-slate-500 hover:text-red-400 flex items-center gap-0.5"
                            onClick={(e) => { e.stopPropagation(); handleDelete(run.id); }}
                          >
                            <Trash2 size={10} /> {t('Delete')}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: charts */}
          <div className="flex-1 overflow-y-auto p-4">
            {!selectedRun ? (
              <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                {t('Select a run or start training')}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-200">{selectedRun.name}</h3>
                    <p className="text-xs text-slate-500">
                      {selectedRun.base_model} · imgsz {selectedRun.imgsz} · batch {selectedRun.batch}
                      {selectedRun.device ? ` · ${selectedRun.device}` : ` · ${t('auto')}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-medium ${(STATUS_LABEL[selectedRun.status] || {}).color}`}>
                      {t((STATUS_LABEL[selectedRun.status] || {}).text || '')}
                    </div>
                    <div className="text-xs text-slate-500">
                      best mAP50 {selectedRun.best_map50?.toFixed(3)} · mAP50-95 {selectedRun.best_map5095?.toFixed(3)}
                    </div>
                  </div>
                </div>

                {/* Dataset split actually used for this run (train/val, no test). */}
                {(selectedRun.train_count > 0 || selectedRun.val_count > 0) && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded bg-slate-700/60 border border-slate-600 text-slate-300">
                      {t('Dataset:')} <b className="text-blue-300">train {selectedRun.train_count}</b>
                      {' · '}<b className="text-emerald-300">val {selectedRun.val_count}</b>
                      {' · '}<span className="text-slate-500">test 0</span>
                    </span>
                    <span className="text-slate-500">
                      {t('frames (training uses train/val, no test)')}
                    </span>
                  </div>
                )}

                {/* progress */}
                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>{t('Epoch {cur} / {total}', { cur: selectedRun.current_epoch, total: selectedRun.epochs })}</span>
                    <span>{progressPct}%</span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${
                      selectedRun.status === 'failed' ? 'bg-red-500'
                        : selectedRun.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'}`}
                      style={{ width: `${progressPct}%` }} />
                  </div>
                </div>

                {selectedRun.status === 'failed' && selectedRun.error && (
                  <div className="flex items-start gap-2 text-red-400 text-xs bg-red-900/20 p-2 rounded">
                    <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                    <span className="break-all">{selectedRun.error}</span>
                  </div>
                )}

                {chartData.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
                    {isActive ? (
                      <span className="flex items-center gap-2">
                        <Loader2 size={16} className="loading-spinner" /> {t('Waiting for the first epoch...')}
                      </span>
                    ) : t('No metrics')}
                  </div>
                ) : (
                  <>
                    <ChartCard title={t('Loss')} data={chartData} keys={lossKeys} />
                    <ChartCard title={t('Quality metrics')} data={chartData} keys={mapKeys} domain={[0, 1]} />
                    <ChartCard title="Learning rate" data={chartData} keys={[{ key: 'lr', name: 'lr', color: '#38bdf8' }]} />
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChartCard({ title, data, keys, domain }) {
  return (
    <div className="bg-slate-900/40 rounded-lg p-3 border border-slate-700/50">
      <h4 className="text-xs font-semibold text-slate-400 mb-2">{title}</h4>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="epoch" stroke="#64748b" fontSize={10} />
          <YAxis stroke="#64748b" fontSize={10} domain={domain || ['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: '#94a3b8' }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {keys.map((k) => (
            <Line
              key={k.key}
              type="monotone"
              dataKey={k.key}
              name={k.name}
              stroke={k.color}
              dot={false}
              strokeWidth={1.5}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
