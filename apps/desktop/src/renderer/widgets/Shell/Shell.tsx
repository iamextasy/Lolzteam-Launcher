import type { AuthSession } from '@shared-types';
import type { PropsWithChildren } from 'react';
import { useView } from '~/stores/view';
import { UpdateBanner } from '~/widgets/UpdateBanner/UpdateBanner';
import s from './Shell.module.scss';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

interface ShellProps {
  session: AuthSession | null;
}

export const Shell = ({ session, children }: PropsWithChildren<ShellProps>) => {
  const view = useView((st) => st.view);
  return (
    <div className={s.layout}>
      <Sidebar />
      <div className={s.main}>
        <TopBar session={session} />
        <UpdateBanner />
        <main className={s.content} data-scroll-root>
          <div key={view} className={s.viewTransition}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};
