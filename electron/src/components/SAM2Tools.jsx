import React, { useState, useEffect } from 'react';
import {
  Crosshair,
  Square,
  Brain,
  Clock,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Info,
  Zap,
} from 'lucide-react';
import apiClient from '../api/client';
import { useApp } from '../App';
import { addTranslations } from '../i18n';

addTranslations({
  'SAM2 Tools': 'SAM2 Инструменты',
  'SAM2 loaded': 'SAM2 загружен',
  'Loading SAM2...': 'Загрузка SAM2...',
  'SAM2 not loaded': 'SAM2 не загружен',
  'Failed to load SAM2': 'Ошибка загрузки SAM2',
  'Checking SAM2...': 'Проверка SAM2...',
  'Load': 'Загрузить',
  'Retry': 'Повторить',
  'Click Mode': 'Режим клика',
  'Click an object to segment it': 'Кликните на объект для сегментации',
  'Box Mode': 'Режим рамки',
  'Draw a box around the object': 'Обведите объект рамкой',
  'Left-click on the object in the image': 'Кликните левой кнопкой мыши на объекте на изображении',
  'Hold the left button and draw a box around the object': 'Зажмите левую кнопку и обведите объект рамкой',
  'Processing time: {ms}ms': 'Время обработки: {ms}мс',
  'Cancel': 'Отменить',
  'SAM2 (Segment Anything Model 2) automatically segments objects from a click or box. The result is converted into an annotation for the current task.':
    'SAM2 (Segment Anything Model 2) автоматически сегментирует объекты по клику или рамке. Результат преобразуется в аннотацию для текущей задачи.',
});

export default function SAM2Tools({ mode, onModeChange, onCancel }) {
  const { t } = useApp();
  const [samStatus, setSamStatus] = useState('unknown');
  const [loading, setLoading] = useState(false);
  const [latency, setLatency] = useState(null);

  useEffect(() => {
    checkSAMStatus();
  }, []);

  const checkSAMStatus = async () => {
    try {
      const res = await apiClient.samStatus();
      setSamStatus(res.data?.loaded ? 'loaded' : 'not_loaded');
    } catch {
      setSamStatus('error');
    }
  };

  const handleLoadModel = async () => {
    setLoading(true);
    try {
      await apiClient.samLoad();
      setSamStatus('loaded');
    } catch {
      setSamStatus('error');
    } finally {
      setLoading(false);
    }
  };

  const statusConfig = {
    loaded: { icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-900/20', text: t('SAM2 loaded') },
    loading: { icon: Loader2, color: 'text-yellow-400', bg: 'bg-yellow-900/20', text: t('Loading SAM2...') },
    not_loaded: { icon: Info, color: 'text-slate-400', bg: 'bg-slate-700/50', text: t('SAM2 not loaded') },
    error: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-900/20', text: t('Failed to load SAM2') },
    unknown: { icon: Info, color: 'text-slate-400', bg: 'bg-slate-700/50', text: t('Checking SAM2...') },
  };

  const currentStatus = statusConfig[samStatus] || statusConfig.unknown;
  const StatusIcon = currentStatus.icon;

  return (
    <div className="bg-slate-800/95 backdrop-blur border border-slate-700 rounded-xl p-4 shadow-xl">
      <div className="flex items-center gap-2 mb-3">
        <Brain size={18} className="text-purple-400" />
        <h3 className="text-sm font-bold text-slate-200">{t('SAM2 Tools')}</h3>
      </div>

      {/* Status */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-3 ${currentStatus.bg}`}>
        <StatusIcon size={14} className={`${currentStatus.color} ${samStatus === 'loading' ? 'loading-spinner' : ''}`} />
        <span className={`text-xs ${currentStatus.color}`}>{currentStatus.text}</span>
        {samStatus === 'not_loaded' && (
          <button
            className="ml-auto text-xs bg-purple-600 hover:bg-purple-700 text-white px-2 py-0.5 rounded transition"
            onClick={handleLoadModel}
            disabled={loading}
          >
            {loading ? t('Loading SAM2...') : t('Load')}
          </button>
        )}
        {samStatus === 'error' && (
          <button
            className="ml-auto text-xs bg-slate-600 hover:bg-slate-500 text-white px-2 py-0.5 rounded transition"
            onClick={checkSAMStatus}
          >
            {t('Retry')}
          </button>
        )}
      </div>

      <div className="space-y-2 mb-3">
        <button
          className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all ${
            mode === 'sam_click'
              ? 'border-purple-500 bg-purple-900/20 text-purple-200'
              : 'border-slate-600 bg-slate-700/50 text-slate-300 hover:border-slate-500'
          }`}
          onClick={() => onModeChange('sam_click')}
          disabled={samStatus !== 'loaded'}
        >
          <Crosshair size={18} />
          <div className="text-left">
            <div className="text-sm font-medium">{t('Click Mode')}</div>
            <div className="text-xs text-slate-400">{t('Click an object to segment it')}</div>
          </div>
        </button>

        <button
          className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all ${
            mode === 'sam_box'
              ? 'border-purple-500 bg-purple-900/20 text-purple-200'
              : 'border-slate-600 bg-slate-700/50 text-slate-300 hover:border-slate-500'
          }`}
          onClick={() => onModeChange('sam_box')}
          disabled={samStatus !== 'loaded'}
        >
          <Square size={18} />
          <div className="text-left">
            <div className="text-sm font-medium">{t('Box Mode')}</div>
            <div className="text-xs text-slate-400">{t('Draw a box around the object')}</div>
          </div>
        </button>
      </div>

      {(mode === 'sam_click' || mode === 'sam_box') && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-purple-300 bg-purple-900/20 px-3 py-2 rounded-lg">
            <Zap size={14} />
            {mode === 'sam_click'
              ? t('Left-click on the object in the image')
              : t('Hold the left button and draw a box around the object')}
          </div>

          {latency && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Clock size={12} />
              <span>{t('Processing time: {ms}ms', { ms: latency })}</span>
            </div>
          )}

          <button
            className="w-full btn-secondary text-xs py-1.5 flex items-center justify-center gap-1"
            onClick={onCancel}
          >
            {t('Cancel')}
          </button>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-slate-700">
        <p className="text-[10px] text-slate-500 leading-relaxed">
          {t('SAM2 (Segment Anything Model 2) automatically segments objects from a click or box. The result is converted into an annotation for the current task.')}
        </p>
      </div>
    </div>
  );
}
