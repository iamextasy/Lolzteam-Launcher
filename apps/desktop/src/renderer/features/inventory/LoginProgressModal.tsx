import type { LoginStep } from '@adapter-contract';
import type { TFunction } from 'i18next';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { type LoginService, useLoginSession } from '~/stores/loginSession';
import { Modal } from '~/widgets/Modal/Modal';
import s from './LoginProgressModal.module.scss';

interface StepDef {
  step: LoginStep;
  label: string;
}

const buildSteps = (t: TFunction): Record<LoginService, readonly StepDef[]> => ({
  steam: [
    { step: 'fetching-credentials', label: t('loginSteps.fetchingCredentials') },
    { step: 'acquiring-token', label: t('loginSteps.acquiringToken') },
    { step: 'fetching-email-code', label: t('loginSteps.fetchingEmailCode') },
    { step: 'killing-steam', label: t('loginSteps.killingSteam') },
    { step: 'writing-vdf', label: t('loginSteps.writingVdf') },
    { step: 'encrypting-token', label: t('loginSteps.encryptingToken') },
    { step: 'launching-steam', label: t('loginSteps.launchingSteam') },
  ],
  telegram: [
    { step: 'fetching-credentials', label: t('loginSteps.fetchingCredentials') },
    { step: 'building-tdata', label: t('loginSteps.buildingTdata') },
    { step: 'killing-telegram', label: t('loginSteps.killingTelegram') },
    { step: 'writing-tdata', label: t('loginSteps.writingTdata') },
    { step: 'launching-telegram', label: t('loginSteps.launchingTelegram') },
  ],
  browser: [
    { step: 'fetching-credentials', label: t('loginSteps.fetchingCredentials') },
    { step: 'injecting-cookies', label: t('loginSteps.injectingCookies') },
    { step: 'launching-browser', label: t('loginSteps.launchingBrowser') },
  ],
  discord: [
    { step: 'fetching-credentials', label: t('loginSteps.fetchingCredentials') },
    { step: 'injecting-token', label: t('loginSteps.injectingToken') },
    { step: 'launching-browser', label: t('loginSteps.launchingBrowser') },
  ],
});

const visibleSteps = (
  stepsByService: Record<LoginService, readonly StepDef[]>,
  service: LoginService,
  currentStep: LoginStep | null,
  awaitingEmail: boolean,
): StepDef[] => {
  if (service !== 'steam') return [...stepsByService[service]];
  const skipEmail = !awaitingEmail && currentStep !== 'fetching-email-code';
  return stepsByService.steam.filter((s) => (s.step === 'fetching-email-code' ? !skipEmail : true));
};

type Status = 'done' | 'active' | 'pending' | 'failed';

const statusFor = (
  stepIdx: number,
  currentIdx: number,
  isDone: boolean,
  hasError: boolean,
): Status => {
  if (isDone) return 'done';
  if (hasError && stepIdx === currentIdx) return 'failed';
  if (stepIdx < currentIdx) return 'done';
  if (stepIdx === currentIdx) return 'active';
  return 'pending';
};

export const LoginProgressModal = () => {
  const { t } = useTranslation();
  const { isOpen, itemId, accountTitle, service, step, detail, error, close } = useLoginSession();

  // Auto-dismiss shortly after a successful sign-in so the modal doesn't linger
  // on screen (and can't be revived by a stray event or re-opened by accident).
  const succeeded = isOpen && step === 'done' && !error;
  useEffect(() => {
    if (!succeeded) return;
    const id = setTimeout(() => useLoginSession.getState().close(), 1500);
    return () => clearTimeout(id);
  }, [succeeded]);

  if (!isOpen) return null;

  const cancel = () => {
    if (itemId !== null) void window.launcher.accounts.cancelLogin(itemId);
    close();
  };

  const svc: LoginService = service ?? 'steam';
  const isDone = step === 'done' && !error;
  const isFinished = isDone || Boolean(error);
  const awaitingEmail = step === 'awaiting-email-code' || step === 'fetching-email-code';

  const stepsByService = buildSteps(t);
  const steps = visibleSteps(stepsByService, svc, step, awaitingEmail);
  const currentIdx = step ? steps.findIndex((x) => x.step === step) : -1;
  // collapse the "awaiting code" steps onto their "fetching code" line
  const effectiveIdx =
    currentIdx !== -1
      ? currentIdx
      : step === 'awaiting-email-code'
        ? steps.findIndex((x) => x.step === 'fetching-email-code')
        : currentIdx;

  return (
    <Modal
      title={t('loginModal.title', { title: accountTitle })}
      closable
      onClose={isFinished ? close : cancel}
    >
      <ol className={s.steps}>
        {steps.map((stepDef, idx) => {
          const status = statusFor(idx, effectiveIdx, isDone, Boolean(error));
          return (
            <li key={stepDef.step} className={`${s.step} ${s[status]}`}>
              <span className={s.icon}>
                {status === 'done' ? (
                  <Check size={14} />
                ) : status === 'failed' ? (
                  <AlertCircle size={14} />
                ) : status === 'active' ? (
                  <Loader2 size={14} className={s.spin} />
                ) : (
                  <span className={s.dot} />
                )}
              </span>
              <span className={s.label}>
                {stepDef.label}
                {status === 'active' && detail && <span className={s.detail}> · {detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>

      {error && (
        <div className={s.error}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {isDone && (
        <div className={s.success}>
          {t('loginModal.success', {
            service:
              svc === 'telegram'
                ? 'Telegram'
                : svc === 'discord'
                  ? 'Discord'
                  : svc === 'browser'
                    ? t('loginModal.browserService')
                    : 'Steam',
          })}
        </div>
      )}

      {isFinished ? (
        <button type="button" className={s.close} onClick={close}>
          {t('common.close')}
        </button>
      ) : (
        <button type="button" className={s.cancel} onClick={cancel}>
          {t('loginModal.cancel')}
        </button>
      )}
    </Modal>
  );
};
