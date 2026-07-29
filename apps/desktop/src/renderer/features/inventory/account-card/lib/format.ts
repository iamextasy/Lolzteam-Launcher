type TFunc = (key: string, opts?: Record<string, unknown>) => string;

const intlLocale = (locale: string): string => (locale === 'ru' ? 'ru-RU' : 'en-US');

// Intl constructors are expensive and the inventory renders dozens of cards,
// each formatting a price and a row of game hours on every render.
const numberFormatters = new Map<string, Intl.NumberFormat>();

const numberFormatter = (key: string, create: () => Intl.NumberFormat): Intl.NumberFormat => {
  let cached = numberFormatters.get(key);
  if (!cached) {
    cached = create();
    numberFormatters.set(key, cached);
  }
  return cached;
};

export const formatHours = (hours: number, locale: string): string => {
  const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
  const format = numberFormatter(
    `hours|${locale}`,
    () => new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 1 }),
  );
  return format.format(rounded);
};

export const formatPrice = (value: number, currency: string, locale: string): string => {
  // Show cents only when the amount actually has a fractional part (e.g. USD
  // "$0.49"); whole amounts stay clean ("150 ₽") instead of forcing ".00".
  const fractionDigits = Number.isInteger(value) ? 0 : 2;
  try {
    const format = numberFormatter(
      `price|${locale}|${currency}|${fractionDigits}`,
      () =>
        new Intl.NumberFormat(intlLocale(locale), {
          style: 'currency',
          currency,
          minimumFractionDigits: fractionDigits,
          maximumFractionDigits: fractionDigits,
        }),
    );
    return format.format(value);
  } catch {
    return `${value} ${currency}`;
  }
};

export const formatLastSeen = (unixSeconds: number, t: TFunc): string => {
  const days = Math.floor((Date.now() - unixSeconds * 1000) / (24 * 60 * 60 * 1000));
  if (days <= 0) return t('inventory.card.steam.lastSeenToday');
  return t('inventory.card.steam.lastSeenDays', { count: days });
};

/** "Куплен N дн./ч. назад". Falls back to an absolute date for older purchases. */
export const formatPurchasedAgo = (unixSeconds: number, t: TFunc, locale: string): string => {
  const ms = Date.now() - unixSeconds * 1000;
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 30) {
    return new Intl.DateTimeFormat(intlLocale(locale), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(unixSeconds * 1000);
  }
  if (days >= 1) return t('inventory.card.purchasedDays', { count: days });
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return t('inventory.card.purchasedHours', { count: hours });
  return t('inventory.card.purchasedRecently');
};

export const formatShortDate = (unixSeconds: number, locale: string): string =>
  new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'short' }).format(
    unixSeconds * 1000,
  );

const REGION_NAMES_RU = new Intl.DisplayNames(['ru'], { type: 'region' });
const REGION_NAMES_EN = new Intl.DisplayNames(['en'], { type: 'region' });

export const countryName = (code: string, locale: string): string => {
  try {
    const names = locale === 'ru' ? REGION_NAMES_RU : REGION_NAMES_EN;
    return names.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
};
