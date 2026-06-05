import type { AuthStatus } from '@shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { ConnectionScreen } from '~/features/auth/ConnectionScreen';
import { LoginScreen } from '~/features/auth/LoginScreen';
import { InventoryView } from '~/features/inventory/InventoryView';
import { LoginProgressModal } from '~/features/inventory/LoginProgressModal';
import { SettingsView } from '~/features/settings/SettingsView';
import { useLocaleSync } from '~/i18n/useLocaleSync';
import { useAccountsStream, useAccountsStreamController } from '~/stores/accountsStream';
import { useLoginSession } from '~/stores/loginSession';
import { initSettingsStore } from '~/stores/settings';
import { useView } from '~/stores/view';
import { Shell } from '~/widgets/Shell/Shell';
import { Splash } from '~/widgets/Splash/Splash';

initSettingsStore();

const AccountsStreamController = () => {
  useAccountsStreamController();
  return null;
};

export const App = () => {
  useLocaleSync();
  const qc = useQueryClient();
  const [splashDone, setSplashDone] = useState(false);

  const status = useQuery({
    queryKey: ['auth-status'],
    queryFn: () => window.launcher.auth.getStatus(),
  });

  const [live, setLive] = useState<AuthStatus | null>(null);

  useEffect(() => {
    const off = window.launcher.auth.onStatusChanged((next) => {
      setLive(next);
      qc.setQueryData(['auth-status'], next);
      // On logout, drop any in-flight stream state so the loading indicator
      // doesn't stay stuck (the aborted backend stream won't emit its `done`).
      if (!next.authenticated) {
        useAccountsStream.getState().reset();
        qc.setQueryData(['accounts'], []);
      }
      qc.invalidateQueries({ queryKey: ['accounts'] });
    });
    return off;
  }, [qc]);

  useEffect(() => {
    const off = window.launcher.accounts.onLoginProgress((evt) => {
      const sess = useLoginSession.getState();
      if (evt.itemId !== sess.itemId) return;
      if (sess.step === 'done' || sess.error !== null) return;
      sess.setStep(evt.step, evt.detail);
    });
    return off;
  }, []);

  const current = live ?? status.data ?? null;
  const view = useView((st) => st.view);

  const refetchStatus = useCallback(async () => {
    setLive(null);
    const res = await status.refetch();
    return res.data;
  }, [status.refetch]);

  const loading = status.isLoading && !current;

  const offline = Boolean(current?.authenticated && (current.offline || !current.session));

  let content: React.ReactNode = null;
  if (loading) {
    content = splashDone ? <ConnectionScreen onRetry={refetchStatus} /> : null;
  } else if (!current?.authenticated) {
    content = (
      <>
        <LoginScreen />
        <LoginProgressModal />
      </>
    );
  } else if (offline) {
    content = <ConnectionScreen onRetry={refetchStatus} />;
  } else {
    content = (
      <Shell session={current.session}>
        <AccountsStreamController />
        {view === 'settings' ? <SettingsView /> : <InventoryView />}
        <LoginProgressModal />
      </Shell>
    );
  }

  return (
    <>
      {content}
      {!splashDone && <Splash onDone={() => setSplashDone(true)} />}
    </>
  );
};
