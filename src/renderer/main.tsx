import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AppErrorBoundary } from './app/AppErrorBoundary';
import { startAgentBridge } from './model/agentBridge';
import { startWorldPersistence } from './model/persistence';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

// Started once, outside React. They used to live in an App effect, so when App crashed into the
// error screen the cleanup cancelled the pending autosave and the save-on-close hook: closing
// the window then lost everything since the last save. They run for the life of the page now.
startWorldPersistence();
startAgentBridge();

createRoot(rootEl).render(
  <StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </StrictMode>,
);
