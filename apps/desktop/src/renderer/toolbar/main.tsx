import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserToolbar } from './BrowserToolbar';
import { LANG } from './strings';

// The page ships as `lang="ru"`; screen readers should hear the app's language.
document.documentElement.lang = LANG;

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <BrowserToolbar />
  </StrictMode>,
);
