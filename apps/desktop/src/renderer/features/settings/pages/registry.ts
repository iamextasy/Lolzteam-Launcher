import type { ComponentType } from 'react';
import { IS_DEV } from '~/lib/dev';
import {
  AccountsIcon,
  ApiIcon,
  BellIcon,
  DatabaseIcon,
  DebugIcon,
  GlobeIcon,
  HomeIcon,
  LogIcon,
  LoginIcon,
  LolzteamIcon,
  MetricsIcon,
  type SettingsIcon,
  TagIcon,
  serviceIcon,
} from '../ui/SettingsIcons';
import { AboutPage } from './AboutPage';
import { AccountsListPage } from './AccountsListPage';
import { ActionLogPage } from './ActionLogPage';
import { ApiMonitorPage } from './ApiMonitorPage';
import { BrowserIcon, BrowserPage } from './BrowserPage';
import { DebugPage } from './DebugPage';
import { GeneralPage } from './GeneralPage';
import { LabelsPage } from './LabelsPage';
import { LocalDbPage } from './LocalDbPage';
import { LoginMethodsPage } from './LoginMethodsPage';
import { NotificationsPage } from './NotificationsPage';
import { PrivacyPage } from './PrivacyPage';
import { ProxyPage } from './ProxyPage';
import { SteamPage } from './SteamPage';
import { TelegramPage } from './TelegramPage';

/** Every settings page, keyed by the id that also names its i18n block. */
const PAGES = {
  general: { icon: HomeIcon, Component: GeneralPage },
  notifications: { icon: BellIcon, Component: NotificationsPage },
  accountsList: { icon: AccountsIcon, Component: AccountsListPage },
  localDb: { icon: DatabaseIcon, Component: LocalDbPage },
  labels: { icon: TagIcon, Component: LabelsPage },
  login: { icon: LoginIcon, Component: LoginMethodsPage },
  proxy: { icon: GlobeIcon, Component: ProxyPage },
  browser: { icon: BrowserIcon, Component: BrowserPage },
  telegram: { icon: serviceIcon('telegram'), Component: TelegramPage },
  steam: { icon: serviceIcon('steam'), Component: SteamPage },
  actionLog: { icon: LogIcon, Component: ActionLogPage },
  apiMonitor: { icon: ApiIcon, Component: ApiMonitorPage },
  privacy: { icon: MetricsIcon, Component: PrivacyPage },
  about: { icon: LolzteamIcon, Component: AboutPage },
  debug: { icon: DebugIcon, Component: DebugPage },
} satisfies Record<string, { icon: SettingsIcon; Component: ComponentType }>;

export type SettingsPageId = keyof typeof PAGES;

/** Rail sections, in the order they are drawn. */
export const SETTINGS_NAV: readonly { id: string; pages: readonly SettingsPageId[] }[] = [
  { id: 'app', pages: ['general', 'notifications'] },
  { id: 'accounts', pages: ['accountsList', 'localDb', 'labels', 'login'] },
  { id: 'network', pages: ['proxy', 'browser'] },
  { id: 'services', pages: ['telegram', 'steam'] },
  { id: 'system', pages: ['actionLog', 'apiMonitor', 'privacy', 'about'] },
  /* «Разработка» есть только под `pnpm dev`. */
  ...(IS_DEV ? [{ id: 'dev', pages: ['debug'] as const }] : []),
];

export const getSettingsPage = (id: SettingsPageId) => PAGES[id];

export const DEFAULT_SETTINGS_PAGE: SettingsPageId = 'general';
