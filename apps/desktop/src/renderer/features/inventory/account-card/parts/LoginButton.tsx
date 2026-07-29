import { Loader2, LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import s from '../AccountCard.module.scss';
import { useAccountCard } from '../AccountCardContext';
import { useCooldownSeconds } from '../lib/useCooldownSeconds';

export const LoginButton = () => {
  const { t } = useTranslation();
  const { isInvalid, login } = useAccountCard();
  // Ticking lives here so the countdown doesn't re-render the rest of the card.
  const cooldown = useCooldownSeconds(login.cooldownUntil);

  return (
    <Tooltip
      label={
        login.canLogin
          ? isInvalid
            ? t('inventory.card.loginInvalidTooltip')
            : t('inventory.card.loginTooltip')
          : t('inventory.card.unsupportedTooltip')
      }
    >
      <button
        type="button"
        className={`${s.login} ${isInvalid ? s.loginInvalid : ''}`}
        disabled={!login.canLogin || login.busy || cooldown > 0}
        onClick={login.start}
      >
        {login.busy ? <Loader2 size={16} className={s.spin} /> : <LogIn size={16} />}
        <span>
          {login.busy
            ? t('inventory.card.busy')
            : cooldown > 0
              ? t('inventory.card.rateLimited', { sec: cooldown })
              : t('inventory.card.login')}
        </span>
      </button>
    </Tooltip>
  );
};
