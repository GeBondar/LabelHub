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

const STATUS_LABEL = {
  pending: { text: 'Подготовка', color: 'text-yellow-400' },
  running: { text: 'Обучается', color: 'text-blue-400' },
  completed: { text: 'Завершено', color: 'text-green-400' },
  failed: { text: 'Ошибка', color: 'text-red-400' },
  stopped: { text: 'Остановлено', color: 'text-slate-400' },
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

export default function TrainingPanel({ projectId, onClose }) {
  const { addToast } = useApp();

  const [baseModels, setBaseModels] = useState(['yolov8n-obb.pt']);
  const [baseModel, setBaseModel] = useState('yolov8n-obb.pt');
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
    apiClient.getBaseModels().then((res) => {
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
        const label = STATUS_LABEL[msg.status]?.text || msg.status;
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
      addToast('Обучение запущено', 'success');
      await loadRuns();
      setSelectedRunId(res.data.id);
      setChartData([]);
    } catch (e) {
      addToast('Не удалось запустить обучение: ' + (e.message || ''), 'error', 6000);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async (runId) => {
    try {
      await apiClient.stopTraining(runId);
      addToast('Останавливаю обучение...', 'info');
      loadRuns();
    } catch (e) {
      addToast('Ошибка остановки: ' + (e.message || ''), 'error');
    }
  };

  const handleDelete = async (runId) => {
    if (!confirm('Удалить запуск обучения из списка?')) return;
    try {
      await apiClient.deleteTrainingRun(runId);
      const list = await loadRuns();
      if (selectedRunId === runId) {
        setSelectedRunId(list[0]?.id || null);
        setChartData(list[0] ? [] : []);
        if (list[0]) loadMetrics(list[0].id);
      }
    } catch (e) {
      addToast('Ошибка удаления: ' + (e.message || ''), 'error');
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
        addToast('TensorBoard открыт, но событий ещё нет — запустите обучение (старые прогоны логов TB не содержат).', 'info', 7000);
      } else {
        addToast('Открываю TensorBoard...', 'success');
      }
      openUrl(url);
    } catch (e) {
      addToast('TensorBoard недоступен: ' + (e.message || ''), 'error', 8000);
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
            Обучение YOLOv8-OBB
          </h2>
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary flex items-center gap-1.5 text-sm py-1.5"
              onClick={handleTensorboard}
              disabled={tbLoading}
              title="Открыть TensorBoard для глубокого анализа"
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
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Параметры</h3>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Базовая модель</label>
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
                  <label className="block text-xs text-slate-400 mb-1">Эпохи</label>
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
                  <Cpu size={12} /> Устройство
                </label>
                <input className="input-field w-full text-sm py-1.5" placeholder="авто (пусто), cpu, 0"
                  value={device} onChange={(e) => setDevice(e.target.value)} />
                {deviceInfo && (
                  deviceInfo.cuda ? (
                    <p className="text-[10px] mt-1 flex items-center gap-1 text-green-400">
                      <CheckCircle2 size={11} />
                      GPU: {deviceInfo.gpus?.[0]?.name || 'CUDA'}{deviceInfo.device_count > 1 ? ` (+${deviceInfo.device_count - 1})` : ''} · пусто = авто
                    </p>
                  ) : (
                    <p className="text-[10px] mt-1 text-yellow-400">
                      GPU не обнаружен — обучение пойдёт на CPU
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
                Запустить обучение
              </button>
            </div>

            <div className="p-4 flex-1">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Запуски</h3>
                <button className="p-1 hover:bg-slate-700 rounded text-slate-400" onClick={loadRuns} title="Обновить">
                  <RefreshCw size={12} />
                </button>
              </div>
              <div className="space-y-1">
                {runs.length === 0 && <p className="text-xs text-slate-500">Пока нет запусков</p>}
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
                        <span className={`text-[10px] ${st.color}`}>{st.text}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-[10px] text-slate-500">
                        <span>{run.base_model.replace('.pt', '')}</span>
                        <span>{run.current_epoch}/{run.epochs} эп.</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {(run.status === 'running' || run.status === 'pending') ? (
                          <button
                            className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-0.5"
                            onClick={(e) => { e.stopPropagation(); handleStop(run.id); }}
                          >
                            <StopIcon size={10} /> Стоп
                          </button>
                        ) : (
                          <button
                            className="text-[10px] text-slate-500 hover:text-red-400 flex items-center gap-0.5"
                            onClick={(e) => { e.stopPropagation(); handleDelete(run.id); }}
                          >
                            <Trash2 size={10} /> Удалить
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
                Выберите запуск или запустите обучение
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-200">{selectedRun.name}</h3>
                    <p className="text-xs text-slate-500">
                      {selectedRun.base_model} · imgsz {selectedRun.imgsz} · batch {selectedRun.batch}
                      {selectedRun.device ? ` · ${selectedRun.device}` : ' · авто'}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-medium ${(STATUS_LABEL[selectedRun.status] || {}).color}`}>
                      {(STATUS_LABEL[selectedRun.status] || {}).text}
                    </div>
                    <div className="text-xs text-slate-500">
                      best mAP50 {selectedRun.best_map50?.toFixed(3)} · mAP50-95 {selectedRun.best_map5095?.toFixed(3)}
                    </div>
                  </div>
                </div>

                {/* progress */}
                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Эпоха {selectedRun.current_epoch} / {selectedRun.epochs}</span>
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
                        <Loader2 size={16} className="loading-spinner" /> Ожидание первой эпохи...
                      </span>
                    ) : 'Нет метрик'}
                  </div>
                ) : (
                  <>
                    <ChartCard title="Потери (loss)" data={chartData} keys={lossKeys} />
                    <ChartCard title="Метрики качества" data={chartData} keys={mapKeys} domain={[0, 1]} />
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
