import './styles/global.scss';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { i18n, initI18n } from './i18n';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

const boot = async () => {
  let initialLocale: 'ru' | 'en' = 'en';
  try {
    const resp = await window.launcher.settings.get();
    initialLocale = resp.effectiveLocale;
  } catch {
    // settings IPC may not be ready in some test/dev edge cases; keep 'en' fallback.
  }
  await initI18n(initialLocale);

  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <App />
          </QueryClientProvider>
        </I18nextProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
};

void boot();
