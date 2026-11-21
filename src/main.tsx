import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
// @ts-ignore -- plain JS module
import { installSessionInterceptors } from './lib/session.js';

installSessionInterceptors();
createRoot(document.getElementById('root')!).render(<App />);

// Prevent accidental Vite full-reloads triggered by dynamic user uploads
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeFullReload', (payload: any) => {
    const filePath = payload?.path || '';
    if (filePath.includes('upload') || filePath.includes('data') || filePath.endsWith('.json')) {
      console.warn('[HMR] Suppressed page reload for uploaded/data file:', filePath);
    }
  });
}
