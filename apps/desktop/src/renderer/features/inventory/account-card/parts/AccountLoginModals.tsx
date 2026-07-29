import type { ProxyEntry } from '@shared-types';
import { useTranslation } from 'react-i18next';
import { useSettings } from '~/stores/settings';
import { Modal } from '~/widgets/Modal/Modal';
import { LoginMethodModal } from '../../LoginMethodModal';
import { ProxyChoiceModal, type ProxyTest } from '../../ProxyChoiceModal';
import s from '../AccountCard.module.scss';
import { useAccountCard } from '../AccountCardContext';

const EMPTY_PROXIES: ProxyEntry[] = [];

interface ProxyStepProps {
  onChoose: (proxyId: string | null, proxyTest: ProxyTest | null) => void;
  onCancel: () => void;
}

// Mounted only while the picker is open, so idle cards never subscribe to settings.
const ProxyStep = ({ onChoose, onCancel }: ProxyStepProps) => {
  const proxies = useSettings((st) => st.settings?.proxies ?? EMPTY_PROXIES);
  return (
    <ProxyChoiceModal
      proxies={proxies}
      confirmTone="danger"
      onChoose={onChoose}
      onCancel={onCancel}
    />
  );
};

/** The dialogs the login flow puts in front of the user, one at a time. */
export const AccountLoginModals = () => {
  const { t } = useTranslation();
  const { warranty, login } = useAccountCard();

  if (login.stage === 'method') {
    return (
      <LoginMethodModal
        methods={login.methods}
        onChoose={login.chooseMethod}
        onCancel={login.cancel}
      />
    );
  }

  if (login.stage === 'proxy') {
    return <ProxyStep onChoose={login.chooseProxy} onCancel={login.cancel} />;
  }

  if (login.stage === 'warranty') {
    return (
      <Modal title={t('inventory.card.warrantyWarnTitle')} onClose={login.cancel}>
        <p className={s.warnBody}>{t('inventory.card.warrantyWarnBody', { warranty })}</p>
        <div className={s.warnActions}>
          <button type="button" className={s.warnCancel} onClick={login.cancel}>
            {t('inventory.card.warrantyWarnCancel')}
          </button>
          <button type="button" className={s.warnConfirm} onClick={login.confirmWarranty}>
            {t('inventory.card.warrantyWarnConfirm')}
          </button>
        </div>
      </Modal>
    );
  }

  return null;
};
