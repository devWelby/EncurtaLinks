import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/ui/styles.css';
import { AdminApp } from './AdminApp.tsx';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <AdminApp />
    </StrictMode>,
  );
}
