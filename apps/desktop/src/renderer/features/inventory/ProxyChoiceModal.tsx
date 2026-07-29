import type { ProxyEntry } from '@shared-types';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAgo } from '~/lib/time';
import { Modal } from '~/widgets/Modal/Modal';
import s from './ProxyChoiceModal.module.scss';

export type ProxyTest = { ip: string; ms: number };

interface ProxyChoiceModalProps {
  proxies: ProxyEntry[];
  /** "Continue without proxy" reads as a warning in some flows, as a plain confirm in others. */
  confirmTone?: 'accent' | 'danger';
  onChoose: (proxyId: string | null, proxyTest: ProxyTest | null) => void;
  onCancel: () => void;
}

export const ProxyChoiceModal = ({
  proxies,
  confirmTone = 'accent',
  onChoose,
  onCancel,
}: ProxyChoiceModalProps) => {
  const { t, i18n } = useTranslation();
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState<{ entry: ProxyEntry; message: string } | null>(null);

  const select = async (entry: ProxyEntry) => {
    setChecking(true);
    try {
      const res = await window.launcher.proxy.test({
        host: entry.host,
        port: entry.port,
        username: entry.username,
        password: entry.password,
        protocol: entry.protocol,
      });
      setChecking(false);
      if (res.ok) onChoose(entry.id, { ip: res.ip, ms: res.ms });
      else setFailed({ entry, message: res.message });
    } catch (err) {
      setChecking(false);
      setFailed({ entry, message: err instanceof Error ? err.message : String(err) });
    }
  };

  if (checking) {
    return (
      <Modal title={t('inventory.card.proxy.checking')} closable={false}>
        <div className={s.pending}>
          <Loader2 size={32} className={s.spin} />
          <p className={s.text}>{t('inventory.card.proxy.checking')}</p>
        </div>
      </Modal>
    );
  }

  if (failed) {
    return (
      <Modal title={t('inventory.card.proxy.failTitle')} closable onClose={() => setFailed(null)}>
        <div className={s.body}>
          <div className={s.fail}>
            <AlertTriangle size={32} />
            <p className={s.text}>{t('inventory.card.proxy.failBody')}</p>
            <p className={s.sub}>{failed.message}</p>
          </div>
        </div>
        <div className={s.failActions}>
          <button type="button" className={s.cancel} onClick={onCancel}>
            {t('inventory.card.proxy.exit')}
          </button>
          <button type="button" className={s.cancel} onClick={() => setFailed(null)}>
            {t('inventory.card.proxy.change')}
          </button>
          <button
            type="button"
            className={`${s.confirm} ${confirmTone === 'danger' ? s.confirmDanger : ''}`}
            onClick={() => onChoose(null, null)}
          >
            {t('inventory.card.proxy.continueNoProxy')}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t('inventory.card.proxy.selectTitle')} closable onClose={onCancel}>
      <div className={s.list} role="radiogroup">
        <button type="button" className={s.option} onClick={() => onChoose(null, null)}>
          {t('inventory.card.proxy.none')}
        </button>
        <div className={s.scroll}>
          {proxies.map((p) => {
            const res = p.test;
            return (
              <button key={p.id} type="button" className={s.option} onClick={() => void select(p)}>
                <span className={s.name}>{p.label?.trim() ? p.label : `${p.host}:${p.port}`}</span>
                <span className={s.meta}>
                  {res ? (
                    <>
                      <span className={res.ok ? s.ok : s.bad}>
                        {res.ok
                          ? t('inventory.card.proxy.statusValid')
                          : t('inventory.card.proxy.statusInvalid')}{' '}
                        ({formatAgo(res.checkedAt, i18n.language)})
                      </span>
                      {res.ok && res.ms !== undefined && (
                        <span className={s.ping}>
                          {t('inventory.card.proxy.ping', { ms: res.ms })}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className={s.unchecked}>{t('inventory.card.proxy.statusUnchecked')}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};
