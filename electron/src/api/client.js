import axios from 'axios';

const BASE_URL = 'http://localhost:8787';
const WS_URL = 'ws://localhost:8787/ws';

// Note: no default Content-Type header. axios auto-sets application/json for
// plain-object bodies and multipart/form-data (with boundary) for FormData.
// Forcing application/json here makes axios 1.x serialize FormData to JSON,
// which strips the file and triggers a 422 "Field required" on uploads.
const api = axios.create({
  baseURL: BASE_URL + '/api',
  timeout: 300000,
});

// FastAPI returns `detail` as a string for HTTPException, but as an array of
// {loc,msg,type} objects for 422 validation errors. Stringifying the latter
// naively yields "[object Object]", so flatten it to a readable message.
function extractErrorMessage(error) {
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (d && typeof d === 'object' ? (d.msg || JSON.stringify(d)) : String(d)))
      .join('; ');
  }
  if (detail && typeof detail === 'object') {
    return detail.msg || JSON.stringify(detail);
  }
  return error.message || 'Неизвестная ошибка';
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const enriched = new Error(extractErrorMessage(error));
    enriched.status = error.response?.status;
    enriched.originalError = error;
    return Promise.reject(enriched);
  }
);

let ws = null;
let wsReconnectTimer = null;
let wsListeners = new Map();
let wsConnected = false;

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      wsConnected = true;
      if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
      }
      notifyListeners({ type: 'connected' });
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        notifyListeners(data);
      } catch (e) {
        console.warn('WebSocket parse error:', e);
      }
    };

    ws.onclose = () => {
      wsConnected = false;
      notifyListeners({ type: 'disconnected' });
      wsReconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => {
      if (ws) {
        ws.close();
      }
    };
  } catch (e) {
    wsReconnectTimer = setTimeout(connectWebSocket, 5000);
  }
}

function notifyListeners(data) {
  wsListeners.forEach((callback) => {
    try {
      callback(data);
    } catch (e) {
      console.warn('WS listener error:', e);
    }
  });
}

function addWsListener(id, callback) {
  wsListeners.set(id, callback);
  if (!wsConnected) {
    connectWebSocket();
  }
}

function removeWsListener(id) {
  wsListeners.delete(id);
}

const apiClient = {
  isConnected: () => wsConnected,

  connectWs: connectWebSocket,

  onWsMessage: (callback) => {
    const id = Symbol('ws-listener');
    addWsListener(id, callback);
    return () => removeWsListener(id);
  },

  uploadWithProgress: (url, formData, onProgress) =>
    api.post(url, formData, {
      onUploadProgress: (e) => {
        if (onProgress && e.total) {
          onProgress(Math.round((e.loaded * 100) / e.total));
        }
      },
    }),

  // Projects
  getProjects: () => api.get('/projects/'),
  getProject: (id) => api.get(`/projects/${id}`),
  createProject: (data) => api.post('/projects/', data),
  deleteProject: (id) => api.delete(`/projects/${id}`),
  getProjectStats: (id) => api.get(`/projects/${id}`),

  // Classes
  getClasses: (projectId) => api.get(`/projects/${projectId}/classes`),
  createClass: (projectId, data) => api.put(`/projects/${projectId}/classes`, data),
  updateClass: (projectId, classId, data) => api.put(`/projects/${projectId}/classes/${classId}`, data),
  deleteClass: (projectId, classId) => api.delete(`/projects/${projectId}/classes/${classId}`),

  // Videos
  uploadVideo: (projectId, file, onProgress) => {
    const form = new FormData();
    form.append('file', file);
    return apiClient.uploadWithProgress(`/videos/upload/${projectId}`, form, onProgress);
  },
  extractFrames: (videoId, fps) =>
    api.post(`/videos/extract/${videoId}?fps=${fps}`),
  getProjectVideos: (projectId) => api.get(`/videos/${projectId}/list`),

  // Frames
  getVideoFrames: (videoId, params = {}) =>
    api.get(`/videos/by-video/${videoId}/frames`, { params }),
  getProjectFrames: (projectId, params = {}) =>
    api.get(`/videos/${projectId}/frames`, { params }),

  getFrameImageUrl: (projectId, frameImagePath) => {
    if (!frameImagePath) return '';
    const normalized = frameImagePath.replace(/\\/g, '/');
    const idx = normalized.indexOf('projects/');
    if (idx >= 0) {
      return `${BASE_URL}/static/frames/${normalized.substring(idx)}`;
    }
    return `${BASE_URL}/api/files/image/${projectId}/${normalized.split('/').pop()}`;
  },
  getFrameThumbUrl: (projectId, frameImagePath) => {
    if (!frameImagePath) return '';
    const normalized = frameImagePath.replace(/\\/g, '/');
    const idx = normalized.indexOf('projects/');
    if (idx >= 0) {
      return `${BASE_URL}/static/frames/${normalized.substring(idx)}`;
    }
    return `${BASE_URL}/api/files/image/${projectId}/${normalized.split('/').pop()}`;
  },

  // Annotations
  getAnnotations: (frameId) => api.get(`/annotations/frame/${frameId}`),
  createAnnotation: (frameId, data) => api.post(`/annotations/frame/${frameId}`, data),
  updateAnnotation: (annotationId, data) => api.put(`/annotations/${annotationId}`, data),
  deleteAnnotation: (annotationId) => api.delete(`/annotations/${annotationId}`),
  updateFrameStatus: (frameId, isLabeled) =>
    api.put(`/annotations/frame/${frameId}/status`, { is_labeled: isLabeled }),
  batchCreateAnnotations: (frameId, annotations) =>
    api.post(`/annotations/frame/${frameId}`, annotations),

  // SAM2
  samPoint: (frameId, x, y) =>
    api.post(`/annotations/frame/${frameId}/sam2-click`, { x, y }),
  samBox: (frameId, x1, y1, x2, y2) =>
    api.post(`/annotations/frame/${frameId}/sam2-box`, { x1, y1, x2, y2 }),
  samStatus: () => api.get('/annotations/sam2/status'),
  samLoad: () => api.post('/annotations/sam2/load'),

  // Export
  exportDataset: (projectId, data) =>
    api.post(`/export/${projectId}`, data),
  getExports: (projectId) => api.get(`/export/${projectId}/list`),
  downloadExport: (projectId, exportName) =>
    `${BASE_URL}/api/files/export/${projectId}/${exportName}/download`,

  // Import
  importDataset: (projectId, formData, onProgress) =>
    apiClient.uploadWithProgress(`/export/import/${projectId}`, formData, onProgress),
  previewImport: (projectId, data) =>
    api.post(`/export/import/${projectId}/preview`, data),
  importFromDir: (projectId, data) =>
    api.post(`/export/import/${projectId}/dir`, data),

  // Training
  getBaseModels: () => api.get('/training/models'),
  getDeviceInfo: () => api.get('/training/device-info'),
  startTraining: (projectId, data) => api.post(`/training/${projectId}/start`, data),
  getTrainingRuns: (projectId) => api.get(`/training/${projectId}/runs`),
  getTrainingRun: (runId) => api.get(`/training/run/${runId}`),
  getTrainingMetrics: (runId) => api.get(`/training/run/${runId}/metrics`),
  stopTraining: (runId) => api.post(`/training/run/${runId}/stop`),
  deleteTrainingRun: (runId) => api.delete(`/training/run/${runId}`),
  startTensorboard: (projectId) => api.post(`/training/${projectId}/tensorboard`),
  tensorboardStatus: () => api.get('/training/tensorboard/status'),

  // Models registry
  getModels: () => api.get('/models/'),
  importModel: (data) => api.post('/models/import', data),
  renameModel: (modelId, name) => api.patch(`/models/${modelId}`, { name }),
  deleteModel: (modelId) => api.delete(`/models/${modelId}`),
  exportModelUrl: (modelId) => `${BASE_URL}/api/models/${modelId}/export`,

  // Inference sessions
  startInference: (data) => api.post('/inference/start', data),
  inferenceControl: (sid, action, value) =>
    api.post(`/inference/${sid}/control`, { action, value }),
  inferenceStatus: (sid) => api.get(`/inference/${sid}/status`),
  stopInference: (sid) => api.post(`/inference/${sid}/stop`),
  inferenceStreamUrl: (sid) => `${BASE_URL}/api/inference/${sid}/stream`,
  inferenceDownloadUrl: (sid) => `${BASE_URL}/api/inference/${sid}/download`,

  // Health
  healthCheck: () => axios.get(`${BASE_URL}/api/health`),
};

export default apiClient;
export { BASE_URL };
