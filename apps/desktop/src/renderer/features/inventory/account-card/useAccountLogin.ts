import type { AccountSummary } from '@shared-types';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loginMethodFor, loginMethodsFor } from '~/lib/loginService';
import { type LoginMethod, type LoginService, useLoginSession } from '~/stores/loginSession';
import { useSettings } from '~/stores/settings';
import type { ProxyTest } from '../ProxyChoiceModal';

const RATE_LIMIT_COOLDOWN_MS = 60_000;
const isRateLimitMessage = (msg: string): boolean => /\b429\b|rate.?limit/i.test(msg);

const EMPTY_METHODS: LoginMethod[] = [];

/** Which step of the login flow currently needs the user. */
export type LoginStage = 'idle' | 'method' | 'warranty' | 'proxy';

export interface AccountLoginFlow {
  /** False when the category has no adapter, or the LLM provider is unsupported. */
  canLogin: boolean;
  /** A login for this exact account is running right now. */
  busy: boolean;
  /** Unix ms until which the market refuses further logins (429); null when clear. */
  cooldownUntil: number | null;
  stage: LoginStage;
  /** Methods offered for this account, for the method picker. */
  methods: LoginMethod[];
  /** Entry point for the main button: resolves the method, then runs the flow. */
  start: () => void;
  /** Entry point for menu actions that pin a method (e.g. "log in via browser"). */
  startWithMethod: (method: LoginMethod) => void;
  chooseMethod: (method: LoginMethod, remember: boolean) => void;
  chooseProxy: (proxyId: string | null, proxyTest: ProxyTest | null) => void;
  confirmWarranty: () => void;
  cancel: () => void;
}

interface Options {
  item: AccountSummary;
  service: LoginService | null;
  canLogin: boolean;
  /** Formatted remaining warranty, or null when none is active. */
  warranty: string | null;
}

/**
 * Owns the whole "user pressed log in" sequence: method choice, the warranty
 * warning, proxy selection and the rate-limit cooldown. Settings are read on
 * demand instead of subscribed to, so a settings change doesn't re-render cards.
 */
export const useAccountLogin = ({
  item,
  service,
  canLogin,
  warranty,
}: Options): AccountLoginFlow => {
  const { t } = useTranslation();
  const [stage, setStage] = useState<LoginStage>('idle');
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const methodRef = useRef<LoginMethod>('native');

  // One derived boolean: other cards' login progress must not re-render this one.
  const busy = useLoginSession(
    (s) => s.itemId === item.itemId && s.step !== null && s.step !== 'done' && s.error === null,
  );

  const runLogin = async (proxyId: string | null, proxyTest: ProxyTest | null) => {
    if (!service) return;
    const method = methodRef.current;
    const sess = useLoginSession.getState();
    sess.start(item.itemId, item.title, service, method);
    try {
      const res = await window.launcher.accounts.login(item.itemId, method, proxyId, proxyTest);
      if (!res.ok) {
        const msg = res.message ?? t('inventory.card.loginFailedFallback');
        if (isRateLimitMessage(msg)) setCooldownUntil(Date.now() + RATE_LIMIT_COOLDOWN_MS);
        sess.fail(msg);
      }
    } catch (err) {
      sess.fail(err instanceof Error ? err.message : t('inventory.card.callError'));
    }
  };

  const proceed = () => {
    // The native Steam client does its own networking, so a proxy can't apply.
    const nativeNoProxy = service === 'steam' && methodRef.current === 'native';
    const settings = useSettings.getState().settings;
    const canProxy =
      !nativeNoProxy &&
      (settings?.proxyEnabled ?? false) &&
      (settings?.proxies.length ?? 0) > 0 &&
      item.category !== null &&
      (settings?.proxyServices ?? []).includes(item.category);
    if (canProxy) {
      setStage('proxy');
      return;
    }
    setStage('idle');
    void runLogin(null, null);
  };

  const startWithMethod = (method: LoginMethod) => {
    methodRef.current = method;
    // Steam sign-in may need to fetch the mafile (for a Steam Guard code), which
    // cancels the account's active warranty. Warn first when a warranty is live.
    if (service === 'steam' && warranty) {
      setStage('warranty');
      return;
    }
    proceed();
  };

  const start = () => {
    if (!service) return;
    const methods = loginMethodsFor(service);
    if (methods.length <= 1) {
      startWithMethod(methods[0] ?? loginMethodFor(service));
      return;
    }
    const saved = item.category
      ? useSettings.getState().settings?.preferredLoginMethod[item.category]
      : undefined;
    if (saved && methods.includes(saved)) {
      startWithMethod(saved);
      return;
    }
    setStage('method');
  };

  const chooseMethod = (method: LoginMethod, remember: boolean) => {
    setStage('idle');
    if (remember && item.category) {
      const prefs = useSettings.getState().settings?.preferredLoginMethod ?? {};
      void window.launcher.settings
        .set({ preferredLoginMethod: { ...prefs, [item.category]: method } })
        .then((next) => useSettings.getState().set(next.settings));
    }
    startWithMethod(method);
  };

  return {
    canLogin,
    busy,
    cooldownUntil,
    stage,
    methods: service ? loginMethodsFor(service) : EMPTY_METHODS,
    start,
    startWithMethod,
    chooseMethod,
    chooseProxy: (proxyId, proxyTest) => {
      setStage('idle');
      void runLogin(proxyId, proxyTest);
    },
    confirmWarranty: proceed,
    cancel: () => setStage('idle'),
  };
};
