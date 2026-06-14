import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  FileArchive,
  Sliders,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Info,
  ExternalLink,
} from 'lucide-react';
import { useApp } from '../App';
import apiClient from '../api/client';

const YOLO_FORMAT = {
  obb: {
    id: 'yolov8-obb',
    name: 'YOLOv8-OBB',
    desc: 'YOLO с ориентированными bbox (class x1 y1 … x4 y4)',
    ext: '.txt',
    structure: 'images/train/, images/val/, labels/train/, labels/val/',
  },
  detect: {
    id: 'yolov8-detect',
    name: 'YOLOv8 Detect',
    desc: 'YOLO детекция (class cx cy w h)',
    ext: '.txt',
    structure: 'images/train/, images/val/, labels/train/, labels/val/',
  },
  segment: {
    id: 'yolov8-seg',
    name: 'YOLOv8 Segment',
    desc: 'YOLO instance-сегментация (class x1 y1 … xn yn)',
    ext: '.txt',
    structure: 'images/train/, images/val/, labels/train/, labels/val/',
  },
};

const COCO_FORMAT = {
  id: 'coco',
  name: 'COCO',
  desc: 'COCO JSON (bbox + segmentation)',
  ext: '.json',
  structure: 'annotations/instances_train.json, annotations/instances_val.json',
};

const VOC_FORMAT = {
  id: 'pascal-voc',
  name: 'Pascal VOC',
  desc: 'Pascal VOC XML (ротация как robndbox)',
  ext: '.xml',
  structure: 'Annotations/, ImageSets/Main/, JPEGImages/',
};

function formatsForTask(taskType) {
  const yolo = YOLO_FORMAT[taskType] || YOLO_FORMAT.obb;
  // COCO/VOC label geometry is OBB-derived; offer them for box-based tasks only.
  if (taskType === 'segment') return [yolo];
  return [yolo, COCO_FORMAT, VOC_FORMAT];
}

export default function ExportPanel({ projectId, taskType = 'obb', onClose }) {
  const { addToast } = useApp();
  const EXPORT_FORMATS = formatsForTask(taskType);
  const [format, setFormat] = useState(EXPORT_FORMATS[0].id);
  const [trainSplit, setTrainSplit] = useState(70);
  const [valSplit, setValSplit] = useState(20);
  const [testSplit, setTestSplit] = useState(10);
  const [augmentation, setAugmentation] = useState(false);
  const [augCount, setAugCount] = useState(3);
  const [outputName, setOutputName] = useState('dataset_export');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportDone, setExportDone] = useState(false);
  const [error, setError] = useState('');
  const [previousExports, setPreviousExports] = useState([]);
  const [loadingExports, setLoadingExports] = useState(false);

  useEffect(() => {
    loadExports();
  }, []);

  const loadExports = async () => {
    setLoadingExports(true);
    try {
      const res = await apiClient.getExports(projectId);
      setPreviousExports(res.data || []);
    } catch {
      // fail silently
    } finally {
      setLoadingExports(false);
    }
  };

  useEffect(() => {
    setTestSplit(100 - trainSplit - valSplit);
  }, [trainSplit, valSplit]);

  const handleTrainChange = (val) => {
    const tv = parseInt(val);
    const remaining = 100 - tv;
    const newVal = Math.min(valSplit, remaining);
    setTrainSplit(tv);
    setValSplit(newVal);
    setTestSplit(remaining - newVal);
  };

  const handleValChange = (val) => {
    const vv = parseInt(val);
    const maxVal = 100 - trainSplit;
    const newVal = Math.min(vv, maxVal);
    setValSplit(newVal);
    setTestSplit(100 - trainSplit - newVal);
  };

  const handleExport = async () => {
    setExporting(true);
    setExportProgress(0);
    setError('');
    setExportDone(false);

    try {
      const res = await apiClient.exportDataset(projectId, {
        format,
        train_split: trainSplit / 100,
        val_split: valSplit / 100,
        test_split: testSplit / 100,
        apply_augmentation: augmentation,
        augmentation_count: augCount,
        output_name: outputName,
      });

      const exportData = res.data;
      const downloadUrl = apiClient.downloadExport(projectId, outputName);
      window.open(downloadUrl, '_blank');

      setExportDone(true);
      setExportProgress(100);
      addToast(`Экспорт завершён: train=${exportData.train_count} val=${exportData.val_count} test=${exportData.test_count}`, 'success');
      loadExports();
    } catch (err) {
      setError(err.message || 'Ошибка экспорта');
      addToast('Ошибка экспорта', 'error');
    } finally {
      setExporting(false);
    }
  };

  const selectedFormat = EXPORT_FORMATS.find((f) => f.id === format);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center animate-fade-in">
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Download size={20} className="text-blue-400" />
            Экспорт датасета
          </h2>
          <button className="p-1 hover:bg-slate-700 rounded-lg transition" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Format Selection */}
        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-2 font-medium">Формат экспорта</label>
          <div className="space-y-2">
            {EXPORT_FORMATS.map((f) => (
              <label
                key={f.id}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  format === f.id
                    ? 'border-blue-500 bg-blue-900/20'
                    : 'border-slate-600 bg-slate-700/30 hover:border-slate-500'
                }`}
              >
                <input
                  type="radio"
                  name="format"
                  value={f.id}
                  checked={format === f.id}
                  onChange={() => setFormat(f.id)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm text-slate-200">{f.name}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{f.desc}</div>
                  <div className="text-[10px] text-slate-500 mt-1 font-mono">{f.structure}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Split */}
        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-2 font-medium">
            Разделение Train / Val / Test
          </label>
          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Train</span>
                <span>{trainSplit}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={trainSplit}
                onChange={(e) => handleTrainChange(e.target.value)}
                className="w-full"
              />
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Val</span>
                <span>{valSplit}%</span>
              </div>
              <input
                type="range"
                min="0"
                max={100 - trainSplit}
                value={valSplit}
                onChange={(e) => handleValChange(e.target.value)}
                className="w-full"
              />
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Test</span>
                <span>{testSplit}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={testSplit}
                disabled
                className="w-full opacity-50"
              />
            </div>
          </div>
          {trainSplit + valSplit + testSplit !== 100 && (
            <p className="text-xs text-red-400 mt-1">Сумма должна быть 100%</p>
          )}
        </div>

        {/* Augmentation — not supported for segmentation polygons. */}
        {taskType !== 'segment' && (
        <div className="mb-4">
          <label className="flex items-center gap-2 text-sm text-slate-400 mb-2 font-medium">
            <input
              type="checkbox"
              checked={augmentation}
              onChange={(e) => setAugmentation(e.target.checked)}
            />
            Аугментация данных
          </label>
          {augmentation && (
            <div className="flex items-center gap-2 ml-6">
              <span className="text-xs text-slate-400">Изображений на кадр:</span>
              <input
                type="number"
                min="1"
                max="20"
                value={augCount}
                onChange={(e) => setAugCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                className="input-field w-20 text-xs py-1"
              />
            </div>
          )}
        </div>
        )}

        {/* Output Name */}
        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-1 font-medium">Имя выходного файла</label>
          <input
            className="input-field"
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
            placeholder="dataset_export"
          />
        </div>

        {/* Progress */}
        {(exporting || exportDone) && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>{exporting ? 'Экспорт...' : 'Экспорт завершён'}</span>
              <span>{exportProgress}%</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full progress-bar ${exportDone ? 'bg-green-500' : 'bg-blue-500'}`}
                style={{ width: `${exportProgress}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* Previous Exports */}
        {previousExports.length > 0 && (
          <div className="mb-4 border-t border-slate-700 pt-4">
            <h3 className="text-sm font-medium text-slate-400 mb-2">Предыдущие экспорты</h3>
            <div className="space-y-1">
              {previousExports.map((exp) => (
                <div key={exp.id} className="flex items-center justify-between p-2 rounded bg-slate-700/30 text-xs">
                  <div className="flex items-center gap-2">
                    <FileArchive size={14} className="text-slate-400" />
                    <span className="text-slate-300">{exp.filename || `export_${exp.id}`}</span>
                    <span className="text-slate-500">{exp.format}</span>
                  </div>
                  <a
                    href={apiClient.downloadExport(projectId, exp.id)}
                    className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
                    download
                  >
                    <Download size={12} />
                    Скачать
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={onClose} disabled={exporting}>
            Закрыть
          </button>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={handleExport}
            disabled={exporting || exportDone || trainSplit + valSplit + testSplit !== 100}
          >
            {exporting ? (
              <Loader2 size={16} className="loading-spinner" />
            ) : (
              <Download size={16} />
            )}
            {exportDone ? 'Готово' : 'Экспортировать'}
          </button>
        </div>
      </div>
    </div>
  );
}
