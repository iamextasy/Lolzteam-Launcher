import type { ProxyEntry } from '@shared-types';
import { AlertTriangle, Check, CheckCircle2, Gift, Loader2, Mail, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '~/stores/settings';
import { Modal } from '~/widgets/Modal/Modal';
import { ProxyChoiceModal, type ProxyTest } from '../../../../ProxyChoiceModal';
import { useAccountCard } from '../../../AccountCardContext';
import type { AccountActionOverlayProps } from '../../types';
import s from './TransferGiftsModal.module.scss';
import { buildTrashSet, isTrashListed } from './trash';
import {
  type DestKind,
  type GiftItem,
  type GiftPair,
  type SelectMode,
  type TransferResult,
  type WizardStep,
  isLikelyEmail,
  isLikelyInviteLink,
  nonEmptyLines,
} from './types';

const PREVIEW_LIMIT = 10;
const EMPTY_PROXIES: ProxyEntry[] = [];

const titleFor = (step: WizardStep, t: (key: string) => string): string => {
  if (step === 'proxy') return t('inventory.card.gifts.title');
  if (step === 'destination') return t('inventory.card.gifts.destTitle');
  if (step === 'confirm') return t('inventory.card.gifts.confirmTitle');
  return t('inventory.card.gifts.title');
};

const needsProxyChoice = (): boolean => {
  const settings = useSettings.getState().settings;
  return Boolean(
    settings?.proxyEnabled &&
      (settings.proxies.length ?? 0) > 0 &&
      (settings.proxyServices ?? []).includes('steam'),
  );
};

export const TransferGiftsOverlay = ({ onClose }: AccountActionOverlayProps) => {
  const { t } = useTranslation();
  const { item } = useAccountCard();
  const proxies = useSettings((st) => st.settings?.proxies ?? EMPTY_PROXIES);

  const [step, setStep] = useState<WizardStep>(() => (needsProxyChoice() ? 'proxy' : 'loading'));
  const [gifts, setGifts] = useState<GiftItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const proxyIdRef = useRef<string | null>(null);
  const proxyTestRef = useRef<ProxyTest | null>(null);

  const [selectMode, setSelectMode] = useState<SelectMode>('tiles');
  const [showTimed, setShowTimed] = useState(true);
  const [showRegional, setShowRegional] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const [excludeTimed, setExcludeTimed] = useState(false);
  const [excludeRegional, setExcludeRegional] = useState(false);
  const [excludeNamesText, setExcludeNamesText] = useState('');

  const [destKind, setDestKind] = useState<DestKind>('email');
  const [destText, setDestText] = useState('');
  const [pairs, setPairs] = useState<GiftPair[]>([]);

  const [progressDone, setProgressDone] = useState(0);
  const [progressPair, setProgressPair] = useState<GiftPair | null>(null);
  const [result, setResult] = useState<TransferResult | null>(null);

  const load = (proxyId: string | null, proxyTest: ProxyTest | null) => {
    proxyIdRef.current = proxyId;
    proxyTestRef.current = proxyTest;
    setStep('loading');
    setLoadError(null);
    void window.launcher.accounts.gifts
      .list(item.itemId, proxyId, proxyTest)
      .then((res) => {
        if (!res.ok) {
          setLoadError(res.message);
          setStep('error');
          return;
        }
        const list: GiftItem[] = res.gifts.map((g) => ({
          id: g.id,
          name: g.name,
          marketHashName: g.marketHashName,
          iconUrl: g.iconUrl,
          timed: g.timed,
          regional: g.regional,
          restrictionCountries: g.restrictionCountries,
        }));
        setGifts(list);
        if (list.length === 0) setStep('empty');
        else setStep('select');
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : null);
        setStep('error');
      });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only initial load
  useEffect(() => {
    if (needsProxyChoice()) return;
    load(null, null);
  }, []);

  useEffect(() => {
    return window.launcher.accounts.gifts.onTransferProgress((p) => {
      if (p.itemId !== item.itemId) return;
      setProgressDone(p.done);
      setProgressPair({
        gift: {
          id: p.assetId,
          name: p.giftName,
          marketHashName: p.giftName,
          iconUrl: null,
          timed: false,
          regional: false,
          restrictionCountries: null,
        },
        recipient: p.recipient,
      });
    });
  }, [item.itemId]);

  const excludeNames = useMemo(() => nonEmptyLines(excludeNamesText), [excludeNamesText]);
  const trashSet = useMemo(() => buildTrashSet(excludeNames), [excludeNames]);

  const visibleTiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return gifts.filter((g) => {
      if (!showTimed && g.timed) return false;
      if (!showRegional && g.regional) return false;
      if (q && !g.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [gifts, showTimed, showRegional, search]);

  const filterOutgoing = useMemo(() => {
    return gifts.filter((g) => {
      if (excludeTimed && g.timed) return false;
      if (excludeRegional && g.regional) return false;
      if (isTrashListed(g.marketHashName, trashSet)) return false;
      return true;
    });
  }, [gifts, excludeTimed, excludeRegional, trashSet]);

  const outgoingGifts = useMemo(() => {
    if (selectMode === 'tiles') {
      return gifts.filter((g) => selectedIds.has(g.id));
    }
    return filterOutgoing;
  }, [selectMode, gifts, selectedIds, filterOutgoing]);

  const destinations = useMemo(() => nonEmptyLines(destText), [destText]);

  const destReady =
    outgoingGifts.length > 0 &&
    destinations.length === outgoingGifts.length &&
    (destKind === 'email'
      ? destinations.every(isLikelyEmail)
      : destinations.every(isLikelyInviteLink));

  const destHint = (() => {
    if (outgoingGifts.length === 0) return null;
    if (destinations.length !== outgoingGifts.length) {
      return t('inventory.card.gifts.destCountMismatch', { count: outgoingGifts.length });
    }
    if (destKind === 'email' && destinations.some((line) => !isLikelyEmail(line))) {
      return t('inventory.card.gifts.destInvalidEmail');
    }
    if (destKind === 'invite' && destinations.some((line) => !isLikelyInviteLink(line))) {
      return t('inventory.card.gifts.destInvalidInvite');
    }
    return null;
  })();

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const g of visibleTiles) next.add(g.id);
      return next;
    });
  };

  const clearVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const g of visibleTiles) next.delete(g.id);
      return next;
    });
  };

  const resetTileFilters = () => {
    setShowTimed(true);
    setShowRegional(true);
    setSearch('');
  };

  const goDestination = () => {
    if (outgoingGifts.length === 0) return;
    setStep('destination');
  };

  const goConfirm = () => {
    if (!destReady) return;
    setPairs(
      outgoingGifts.map((gift, i) => ({
        gift,
        recipient: destinations[i]!,
      })),
    );
    setStep('confirm');
  };

  const startTransfer = () => {
    setStep('progress');
    setProgressDone(0);
    setProgressPair(null);
    setResult(null);

    const giftNames: Record<string, string> = {};
    for (const pair of pairs) giftNames[pair.gift.id] = pair.gift.name;

    void window.launcher.accounts.gifts
      .transfer({
        itemId: item.itemId,
        destKind,
        pairs: pairs.map((p) => ({ assetId: p.gift.id, recipient: p.recipient })),
        giftNames,
        proxyId: proxyIdRef.current,
        proxyTest: proxyTestRef.current,
      })
      .then((res) => {
        setResult({
          okCount: res.okCount,
          failCount: res.failCount,
          errors: res.errors.map((e) => ({
            giftName: e.giftName,
            recipient: e.recipient,
            message: e.message,
          })),
        });
        setStep('done');
      })
      .catch((err: unknown) => {
        setResult({
          okCount: 0,
          failCount: pairs.length,
          errors: [
            {
              giftName: '—',
              recipient: '—',
              message: err instanceof Error ? err.message : t('inventory.card.gifts.loadError'),
            },
          ],
        });
        setStep('done');
      });
  };

  const handleClose = () => {
    void window.launcher.accounts.gifts.cancelTransfer(item.itemId);
    onClose();
  };

  if (step === 'proxy') {
    return (
      <ProxyChoiceModal
        proxies={proxies}
        confirmTone="danger"
        onChoose={(proxyId: string | null, proxyTest: ProxyTest | null) => {
          load(proxyId, proxyTest);
        }}
        onCancel={handleClose}
      />
    );
  }

  const closable = step !== 'progress';
  const footerMeta =
    selectMode === 'tiles'
      ? t('inventory.card.gifts.selectedCount', { count: outgoingGifts.length })
      : t('inventory.card.gifts.matchingCount', { count: outgoingGifts.length });

  return (
    <Modal
      title={titleFor(step, t)}
      size="lg"
      closable={closable}
      onClose={closable ? handleClose : undefined}
    >
      <div className={s.wizard}>
        {step === 'loading' ? (
          <div className={s.centered}>
            <Loader2 size={32} className={s.spin} />
            <p className={s.text}>{t('inventory.card.gifts.loading')}</p>
          </div>
        ) : null}

        {step === 'empty' ? (
          <div className={s.centered}>
            <Gift size={32} className={s.warnIcon} />
            <p className={s.text}>{t('inventory.card.gifts.empty')}</p>
            <div className={s.footerActions}>
              <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={handleClose}>
                {t('inventory.card.gifts.exit')}
              </button>
            </div>
          </div>
        ) : null}

        {step === 'error' ? (
          <div className={s.centered}>
            <AlertTriangle size={32} className={s.warnIcon} />
            <p className={s.text}>{t('inventory.card.gifts.loadError')}</p>
            {loadError ? <p className={s.sub}>{loadError}</p> : null}
            <div className={s.footerActions}>
              <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={handleClose}>
                {t('inventory.card.gifts.exit')}
              </button>
              <button
                type="button"
                className={`${s.btn} ${s.btnPrimary}`}
                onClick={() => load(proxyIdRef.current, proxyTestRef.current)}
              >
                {t('inventory.card.gifts.retry')}
              </button>
            </div>
          </div>
        ) : null}

        {step === 'select' ? (
          <>
            <p className={s.found}>{t('inventory.card.gifts.found', { count: gifts.length })}</p>
            <div className={s.segmented} role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={selectMode === 'tiles'}
                className={`${s.segBtn} ${selectMode === 'tiles' ? s.segBtnOn : ''}`}
                onClick={() => setSelectMode('tiles')}
              >
                {t('inventory.card.gifts.modeSelect')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={selectMode === 'filters'}
                className={`${s.segBtn} ${selectMode === 'filters' ? s.segBtnOn : ''}`}
                onClick={() => setSelectMode('filters')}
              >
                {t('inventory.card.gifts.modeFilters')}
              </button>
            </div>

            {selectMode === 'tiles' ? (
              <>
                <div className={s.toolbar}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={showTimed}
                    className={s.toggle}
                    onClick={() => setShowTimed((v) => !v)}
                  >
                    <span className={`${s.checkbox} ${showTimed ? s.checkboxOn : ''}`}>
                      {showTimed ? <Check size={12} /> : null}
                    </span>
                    <span>{t('inventory.card.gifts.showTimed')}</span>
                  </button>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={showRegional}
                    className={s.toggle}
                    onClick={() => setShowRegional((v) => !v)}
                  >
                    <span className={`${s.checkbox} ${showRegional ? s.checkboxOn : ''}`}>
                      {showRegional ? <Check size={12} /> : null}
                    </span>
                    <span>{t('inventory.card.gifts.showRegional')}</span>
                  </button>
                  <input
                    className={s.search}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('inventory.card.gifts.searchPlaceholder')}
                  />
                  <button type="button" className={s.linkBtn} onClick={selectVisible}>
                    {t('inventory.card.gifts.selectAll')}
                  </button>
                  <button type="button" className={s.linkBtn} onClick={clearVisible}>
                    {t('inventory.card.gifts.clearAll')}
                  </button>
                </div>

                {visibleTiles.length === 0 ? (
                  <div className={s.centered}>
                    <p className={s.text}>{t('inventory.card.gifts.nothingFound')}</p>
                    <button type="button" className={s.linkBtn} onClick={resetTileFilters}>
                      {t('inventory.card.gifts.resetFilters')}
                    </button>
                  </div>
                ) : (
                  <div className={s.grid}>
                    {visibleTiles.map((g) => {
                      const on = selectedIds.has(g.id);
                      const countries = g.restrictionCountries;
                      return (
                        <button
                          key={g.id}
                          type="button"
                          className={`${s.tile} ${on ? s.tileOn : ''}`}
                          onClick={() => toggleSelected(g.id)}
                          aria-pressed={on}
                        >
                          {g.iconUrl ? (
                            <img className={s.tileBg} src={g.iconUrl} alt="" draggable={false} />
                          ) : (
                            <span className={s.tileBgFallback} aria-hidden>
                              <Gift size={28} />
                            </span>
                          )}
                          <span className={s.tileShade} aria-hidden />
                          <span className={s.tileName}>{g.name}</span>
                          <span className={s.badges}>
                            {g.timed ? (
                              <span className={s.badge}>
                                {t('inventory.card.gifts.badgeTimed')}
                              </span>
                            ) : null}
                            {g.regional ? (
                              <span
                                className={s.badge}
                                title={countries ?? t('inventory.card.gifts.badgeRegional')}
                              >
                                <span>{t('inventory.card.gifts.badgeRegional')}</span>
                                {countries ? (
                                  <span className={s.badgeCountries}>{countries}</span>
                                ) : null}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div className={s.bulkForm}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={excludeTimed}
                  className={s.toggle}
                  onClick={() => setExcludeTimed((v) => !v)}
                >
                  <span className={`${s.checkbox} ${excludeTimed ? s.checkboxOn : ''}`}>
                    {excludeTimed ? <Check size={12} /> : null}
                  </span>
                  <span>{t('inventory.card.gifts.excludeTimed')}</span>
                </button>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={excludeRegional}
                  className={s.toggle}
                  onClick={() => setExcludeRegional((v) => !v)}
                >
                  <span className={`${s.checkbox} ${excludeRegional ? s.checkboxOn : ''}`}>
                    {excludeRegional ? <Check size={12} /> : null}
                  </span>
                  <span>{t('inventory.card.gifts.excludeRegional')}</span>
                </button>
                <label className={s.label}>
                  {t('inventory.card.gifts.excludeNames')}
                  <p className={s.hint}>{t('inventory.card.gifts.excludeNamesHint')}</p>
                  <textarea
                    className={s.textarea}
                    value={excludeNamesText}
                    onChange={(e) => setExcludeNamesText(e.target.value)}
                    placeholder={t('inventory.card.gifts.excludeNamesPlaceholder')}
                  />
                </label>
                <p className={s.sub}>
                  {t('inventory.card.gifts.willSend', {
                    count: filterOutgoing.length,
                    total: gifts.length,
                  })}
                </p>
                {filterOutgoing.length > 0 ? (
                  <ul className={s.previewList}>
                    {filterOutgoing.slice(0, PREVIEW_LIMIT).map((g) => (
                      <li key={g.id} className={s.previewItem}>
                        {g.name}
                      </li>
                    ))}
                    {filterOutgoing.length > PREVIEW_LIMIT ? (
                      <li className={s.previewItem}>
                        {t('inventory.card.gifts.andMore', {
                          count: filterOutgoing.length - PREVIEW_LIMIT,
                        })}
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
            )}

            <div className={s.footer}>
              <span className={s.footerMeta}>{footerMeta}</span>
              <div className={s.footerActions}>
                <button
                  type="button"
                  className={`${s.btn} ${s.btnPrimary}`}
                  disabled={outgoingGifts.length === 0}
                  onClick={goDestination}
                >
                  {t('inventory.card.gifts.next')}
                </button>
              </div>
            </div>
          </>
        ) : null}

        {step === 'destination' ? (
          <>
            <div className={s.destOptions}>
              <button
                type="button"
                className={`${s.destOption} ${destKind === 'email' ? s.destOptionOn : ''}`}
                onClick={() => setDestKind('email')}
              >
                <Mail size={18} />
                <span>{t('inventory.card.gifts.destEmail')}</span>
              </button>
              <button
                type="button"
                className={`${s.destOption} ${destKind === 'invite' ? s.destOptionOn : ''}`}
                onClick={() => setDestKind('invite')}
              >
                <UserPlus size={18} />
                <span>{t('inventory.card.gifts.destInvite')}</span>
              </button>
            </div>

            <label className={s.label}>
              <textarea
                className={`${s.textarea} ${s.textareaLg}`}
                value={destText}
                onChange={(e) => setDestText(e.target.value)}
                placeholder={
                  destKind === 'email'
                    ? t('inventory.card.gifts.destEmailPlaceholder')
                    : t('inventory.card.gifts.destInvitePlaceholder')
                }
              />
            </label>

            <p className={s.sub}>
              {t('inventory.card.gifts.destCount', {
                gifts: outgoingGifts.length,
                recipients: destinations.length,
              })}
            </p>
            {destHint ? <p className={s.mismatch}>{destHint}</p> : null}

            {destinations.length > 0 && outgoingGifts.length > 0 ? (
              <ul className={s.pairList}>
                {outgoingGifts.slice(0, PREVIEW_LIMIT).map((gift, i) => (
                  <li key={gift.id} className={s.pairRow}>
                    <span className={s.pairGift}>{gift.name}</span>
                    <span className={s.pairDest}>{destinations[i] ?? '—'}</span>
                  </li>
                ))}
                {outgoingGifts.length > PREVIEW_LIMIT ? (
                  <li className={s.previewItem}>
                    {t('inventory.card.gifts.andMore', {
                      count: outgoingGifts.length - PREVIEW_LIMIT,
                    })}
                  </li>
                ) : null}
              </ul>
            ) : null}

            <div className={s.footer}>
              <div className={s.footerActions}>
                <button
                  type="button"
                  className={`${s.btn} ${s.btnGhost}`}
                  onClick={() => setStep('select')}
                >
                  {t('inventory.card.gifts.back')}
                </button>
                <button
                  type="button"
                  className={`${s.btn} ${s.btnPrimary}`}
                  disabled={!destReady}
                  onClick={goConfirm}
                >
                  {t('inventory.card.gifts.next')}
                </button>
              </div>
            </div>
          </>
        ) : null}

        {step === 'confirm' ? (
          <>
            <p className={s.sub}>
              {t('inventory.card.gifts.confirmSummary', {
                count: pairs.length,
                mode:
                  selectMode === 'tiles'
                    ? t('inventory.card.gifts.confirmModeTiles')
                    : t('inventory.card.gifts.confirmModeFilters'),
                kind:
                  destKind === 'email'
                    ? t('inventory.card.gifts.destEmail')
                    : t('inventory.card.gifts.destInvite'),
              })}
            </p>
            <ul className={s.pairList}>
              {pairs.map((pair) => (
                <li key={`${pair.gift.id}-${pair.recipient}`} className={s.pairRow}>
                  <span className={s.pairGift}>{pair.gift.name}</span>
                  <span className={s.pairDest}>{pair.recipient}</span>
                </li>
              ))}
            </ul>
            <div className={s.footer}>
              <div className={s.footerActions}>
                <button
                  type="button"
                  className={`${s.btn} ${s.btnGhost}`}
                  onClick={() => setStep('destination')}
                >
                  {t('inventory.card.gifts.back')}
                </button>
                <button type="button" className={`${s.btn} ${s.btnDanger}`} onClick={startTransfer}>
                  {t('inventory.card.gifts.confirmSend')}
                </button>
              </div>
            </div>
          </>
        ) : null}

        {step === 'progress' ? (
          <div className={s.centered}>
            <Loader2 size={32} className={s.spin} />
            <p className={s.text}>
              {t('inventory.card.gifts.progress', {
                done: progressDone,
                total: pairs.length,
              })}
            </p>
            {progressPair ? (
              <p className={s.sub}>
                {t('inventory.card.gifts.progressPair', {
                  gift: progressPair.gift.name,
                  recipient: progressPair.recipient,
                })}
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 'done' && result ? (
          <div className={s.centered}>
            {result.failCount === 0 ? (
              <CheckCircle2 size={32} className={s.okIcon} />
            ) : result.okCount === 0 ? (
              <AlertTriangle size={32} className={s.badIcon} />
            ) : (
              <AlertTriangle size={32} className={s.warnIcon} />
            )}
            <p className={s.text}>
              {result.failCount === 0
                ? t('inventory.card.gifts.done')
                : result.okCount === 0
                  ? t('inventory.card.gifts.fullFail')
                  : t('inventory.card.gifts.partialFail', {
                      done: result.okCount,
                      total: result.okCount + result.failCount,
                    })}
            </p>
            {result.failCount === 0 ? (
              <p className={s.sub}>
                {t('inventory.card.gifts.doneBody', {
                  count: result.okCount,
                  total: result.okCount + result.failCount,
                })}
              </p>
            ) : null}
            {result.errors.length > 0 ? (
              <ul className={s.errorList}>
                {result.errors.map((err) => (
                  <li key={`${err.giftName}-${err.recipient}`} className={s.errorItem}>
                    {err.giftName} → {err.recipient}: {err.message}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={s.footerActions}>
              {result.okCount === 0 ? (
                <button
                  type="button"
                  className={`${s.btn} ${s.btnGhost}`}
                  onClick={() => setStep('confirm')}
                >
                  {t('inventory.card.gifts.retry')}
                </button>
              ) : null}
              <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={handleClose}>
                {t('inventory.card.gifts.close')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
};
