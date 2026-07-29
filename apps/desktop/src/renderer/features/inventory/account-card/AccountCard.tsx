import type { AccountSummary } from '@shared-types';
import { isLlmServiceSupported } from '@shared-types';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatWarranty, toLoginService } from '~/lib/loginService';
import s from './AccountCard.module.scss';
import { type AccountCardApi, AccountCardProvider } from './AccountCardContext';
import { isInvalidTags, tagsOf } from './lib/tags';
import { AccountActions } from './parts/AccountActions';
import { AccountLoginModals } from './parts/AccountLoginModals';
import { CardAbout } from './parts/CardAbout';
import { CardDetails } from './parts/CardDetails';
import { CardHead } from './parts/CardHead';
import { CardMeta } from './parts/CardMeta';
import { CardTags } from './parts/CardTags';
import { LoginButton } from './parts/LoginButton';
import { useAccountLogin } from './useAccountLogin';
import { useAccountTags } from './useAccountTags';

interface AccountCardProps {
  item: AccountSummary;
}

/**
 * Layout and shared state of one inventory card. Everything service-specific
 * lives behind two registries — `menu/registry` for actions and
 * `details/registry` for the parsed-info panel — so this file stays a shell.
 */
const AccountCardImpl = ({ item }: AccountCardProps) => {
  const { t } = useTranslation();
  const service = toLoginService(item.category);
  const warranty = formatWarranty(item.warrantyEndsAt, t);
  const tags = tagsOf(item);
  const isInvalid = isInvalidTags(tags);
  // An LLM listing can name a provider the launcher has no adapter for yet.
  const canLogin =
    service !== null && (item.category !== 'llm' || isLlmServiceSupported(item.llmService));

  const login = useAccountLogin({ item, service, canLogin, warranty });
  const updateTags = useAccountTags(item.itemId);
  const api: AccountCardApi = { item, service, isInvalid, warranty, login, updateTags };

  return (
    <AccountCardProvider value={api}>
      <article className={s.card}>
        <div className={s.topSection}>
          <CardHead item={item} isInvalid={isInvalid} />
          <h3 className={s.titleAccount}>{item.title}</h3>
          <CardAbout item={item} />
          <CardDetails item={item} />
          <CardTags tags={tags} />
        </div>

        <div className={s.bottomBlock}>
          <span className={s.divider} />
          <CardMeta item={item} warranty={warranty} />
          <div className={s.buttonGroup}>
            <LoginButton />
            <AccountActions />
          </div>
        </div>

        <AccountLoginModals />
      </article>
    </AccountCardProvider>
  );
};

export const AccountCard = memo(AccountCardImpl);
