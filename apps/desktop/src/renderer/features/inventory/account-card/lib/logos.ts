import type { AccountSummary, LlmServiceId, ServiceId } from '@shared-types';
import { LLM_SERVICE_LABELS } from '@shared-types';
import chatgptLogo from '~/assets/category/chatgpt.svg';
import claudeLogo from '~/assets/category/claude.svg';
import cursorLogo from '~/assets/category/cursor.svg';
import discordLogo from '~/assets/category/discord.svg';
import grokLogo from '~/assets/category/grok.svg';
import instagramLogo from '~/assets/category/instagram.svg';
import llmLogo from '~/assets/category/llm.svg';
import steamLogo from '~/assets/category/steam.svg';
import telegramLogo from '~/assets/category/telegram.svg';
import tiktokLogo from '~/assets/category/tiktok.svg';

const CATEGORY_LOGOS: Partial<Record<ServiceId, string>> = {
  steam: steamLogo,
  telegram: telegramLogo,
  tiktok: tiktokLogo,
  instagram: instagramLogo,
  discord: discordLogo,
  llm: llmLogo,
};

const LLM_SERVICE_LOGOS: Record<LlmServiceId, string> = {
  claude: claudeLogo,
  chatgpt: chatgptLogo,
  cursor: cursorLogo,
  grok: grokLogo,
};

/** The LLM sub-service logo wins over the listing image, then the category icon. */
export const thumbFor = (item: AccountSummary): string | undefined => {
  const llmServiceLogo =
    item.category === 'llm' && item.llmService ? LLM_SERVICE_LOGOS[item.llmService] : undefined;
  const categoryLogo = item.category ? CATEGORY_LOGOS[item.category] : undefined;
  return llmServiceLogo ?? item.imageUrl ?? categoryLogo;
};

export const categoryTextFor = (item: AccountSummary): string =>
  item.category === 'llm' && item.llmService
    ? LLM_SERVICE_LABELS[item.llmService]
    : item.categoryTitle;
