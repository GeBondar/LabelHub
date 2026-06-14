import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import {
  Home,
  FolderOpen,
  Settings,
  HardDrive,
  Wifi,
  WifiOff,
  ChevronLeft,
} from 'lucide-react';
import ProjectList from './components/ProjectList';
import ProjectWorkspace from './components/ProjectWorkspace';
import apiClient from './api/client';

export const AppContext = createContext(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

function AppProvider({ children }) {
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [currentProject, setCurrentProject] = useState(null);
  const [frames, setFrames] = useState([]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [annotations, setAnnotations] = useState({});
  const [classes, setClasses] = useState([]);
  const [backendStatus, setBackendStatus] = useState('checking');
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const checkBackend = useCallback(async () => {
    try {
      await apiClient.healthCheck();
      setBackendStatus('connected');
    } catch {
      setBackendStatus('disconnected');
    }
  }, []);

  useEffect(() => {
    checkBackend();
    const interval = setInterval(checkBackend, 15000);
    apiClient.connectWs();
    const unsub = apiClient.onWsMessage((data) => {
      if (data.type === 'error') {
        addToast(data.message, 'error');
      }
    });
    return () => {
      clearInterval(interval);
      unsub();
    };
  }, [checkBackend, addToast]);

  useEffect(() => {
    const handleBackendError = (msg) => addToast(`Ошибка сервера: ${msg}`, 'error');
    if (window.electronAPI) {
      window.electronAPI.onBackendError(handleBackendError);
      return () => window.electronAPI.removeBackendErrorListener();
    }
  }, [addToast]);

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const res = await apiClient.getProjects();
      setProjects(res.data || []);
    } catch (e) {
      addToast('Не удалось загрузить проекты', 'error');
    } finally {
      setProjectsLoading(false);
    }
  }, [addToast]);

  const loadClasses = useCallback(async (projectId) => {
    try {
      const res = await apiClient.getClasses(projectId);
      setClasses(res.data || []);
    } catch {
      addToast('Не удалось загрузить классы', 'error');
    }
  }, [addToast]);

  const loadFrames = useCallback(async (projectId) => {
    try {
      const res = await apiClient.getProjectFrames(projectId, { page_size: 500 });
      const frameList = res.data?.items || res.data || [];
      setFrames(frameList);
      setCurrentFrameIndex(0);
      return frameList;
    } catch (e) {
      addToast('Не удалось загрузить кадры', 'error');
      return [];
    }
  }, [addToast]);

  const loadAnnotations = useCallback(async (frameId) => {
    try {
      const res = await apiClient.getAnnotations(frameId);
      const anns = res.data || [];
      setAnnotations((prev) => ({ ...prev, [frameId]: anns }));
      return anns;
    } catch {
      return [];
    }
  }, []);

  const updateAnnotationLocal = useCallback((frameId, annotation) => {
    setAnnotations((prev) => {
      const current = prev[frameId] || [];
      const idx = current.findIndex((a) => a.id === annotation.id);
      if (idx >= 0) {
        const updated = [...current];
        updated[idx] = annotation;
        return { ...prev, [frameId]: updated };
      }
      return { ...prev, [frameId]: [...current, annotation] };
    });
  }, []);

  const removeAnnotationLocal = useCallback((frameId, annotationId) => {
    setAnnotations((prev) => {
      const current = prev[frameId] || [];
      return {
        ...prev,
        [frameId]: current.filter((a) => a.id !== annotationId),
      };
    });
  }, []);

  const setAnnotationsForFrame = useCallback((frameId, anns) => {
    setAnnotations((prev) => ({ ...prev, [frameId]: anns }));
  }, []);

  const value = {
    projects,
    projectsLoading,
    setProjects,
    currentProject,
    setCurrentProject,
    frames,
    setFrames,
    currentFrameIndex,
    setCurrentFrameIndex,
    annotations,
    setAnnotations,
    classes,
    setClasses,
    backendStatus,
    toasts,
    addToast,
    removeToast,
    loadProjects,
    loadClasses,
    loadFrames,
    loadAnnotations,
    updateAnnotationLocal,
    removeAnnotationLocal,
    setAnnotationsForFrame,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function StatusIndicator() {
  const { backendStatus } = useApp();
  const statusConfig = {
    connected: { icon: Wifi, color: 'text-green-400', text: 'Сервер подключён' },
    disconnected: { icon: WifiOff, color: 'text-red-400', text: 'Сервер отключён' },
    checking: { icon: WifiOff, color: 'text-yellow-400', text: 'Проверка...' },
  };
  const config = statusConfig[backendStatus] || statusConfig.checking;
  const Icon = config.icon;
  return (
    <div className={`flex items-center gap-1.5 text-xs ${config.color}`}>
      <Icon size={14} className={backendStatus === 'checking' ? 'loading-spinner' : ''} />
      <span className="hidden sm:inline">{config.text}</span>
    </div>
  );
}

function ToastContainer() {
  const { toasts, removeToast } = useApp();
  if (!toasts.length) return null;
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.type} toast-enter cursor-pointer`}
          onClick={() => removeToast(toast.id)}
        >
          <span className="flex-1">{toast.message}</span>
          <button className="text-current opacity-60 hover:opacity-100 ml-2">&times;</button>
        </div>
      ))}
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    this.setState({ info });
    console.error('React Error Boundary:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{background:'#0f172a',color:'#ef4444',padding:'40px',fontFamily:'monospace',minHeight:'100vh'}}>
          <h2 style={{color:'#f87171',marginBottom:'12px'}}>React Error</h2>
          <pre style={{whiteSpace:'pre-wrap',fontSize:'13px',lineHeight:1.6,color:'#fca5a5'}}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
          {this.state.info?.componentStack && (
            <pre style={{marginTop:'16px',fontSize:'11px',color:'#94a3b8',whiteSpace:'pre-wrap',lineHeight:1.4}}>
              {this.state.info.componentStack}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <Router>
          <div className="h-full flex flex-col">
            <header className="h-12 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-4 flex-shrink-0 z-30">
              <div className="flex items-center gap-3">
                <HardDrive size={20} className="text-blue-400" />
                <h1 className="text-sm font-bold tracking-wide text-slate-200">
                  LabelHub
                </h1>
                <span className="text-xs text-slate-500 hidden sm:inline">
                  Инструмент аннотации YOLOv8-OBB
                </span>
              </div>
              <div className="flex items-center gap-4">
                <StatusIndicator />
              </div>
            </header>
            <main className="flex-1 overflow-hidden">
              <Routes>
                <Route path="/" element={<ProjectList />} />
                <Route path="/project/:id" element={<ProjectWorkspace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
          </div>
          <ToastContainer />
        </Router>
      </AppProvider>
    </ErrorBoundary>
  );
}
