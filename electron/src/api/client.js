import axios from 'axios';

const BASE_URL = 'http://localhost:8787';
const WS_URL = 'ws://localhost:8787/ws';

const api = axios.create({
  baseURL: BASE_URL + '/api',
  timeout: 300000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.detail || error.message || 'Неизвестная ошибка';
    const status = error.response?.status;
    const enriched = new Error(message);
    enriched.status = status;
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

  // Health
  healthCheck: () => axios.get(`${BASE_URL}/api/health`),
};

export default apiClient;
export { BASE_URL };
