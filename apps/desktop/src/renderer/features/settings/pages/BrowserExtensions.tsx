import type {
  BrowserExtensionInfo,
  ExtensionInstallPreview,
  ExtensionInstallSource,
} from '@shared-types';
import { Download, FileArchive, FolderOpen, Loader2, Puzzle, RefreshCw } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import { ModalSpacer, ModalWarn } from '~/widgets/Modal/ModalKit';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import { ConfirmDialog } from '../ui/SettingsControls';
import { TrashIcon } from '../ui/SettingsIcons';
import s from './BrowserPage.module.scss';
import {
  type ErrorContext,
  errorKey,
  hostAccess,
  isReinstall,
  permissionKey,
  replacesStoreInstall,
} from './browserExtensions';

type SourceKind = ExtensionInstallSource['kind'];

/** Подпись права посреди фразы: «не будет работать: уведомления», а не «: Уведомления». */
const lowerFirst = (text: string): string => text.charAt(0).toLocaleLowerCase() + text.slice(1);

/** Строка под полем ввода: чем кончилось последнее действие. */
interface Notice {
  readonly tone: 'ok' | 'muted' | 'bad';
  readonly text: string;
}

const NOTICE_TONE: Record<Notice['tone'], string | undefined> = {
  ok: s.noticeOk,
  muted: s.noticeMuted,
  bad: s.noticeBad,
};

/** Своя иконка расширения (`data:` — CSP окна не пускает `file:`), а без неё — кусочек пазла. */
const ExtensionIcon = ({ icon, large }: { icon: string | null; large?: boolean }) =>
  icon ? (
    <img className={`${s.extIcon} ${large ? s.extIconLarge : ''}`} src={icon} alt="" />
  ) : (
    <span className={`${s.extIcon} ${s.extIconStub} ${large ? s.extIconLarge : ''}`} aria-hidden>
      <Puzzle size={large ? 20 : 15} />
    </span>
  );

/** Список расширений из main — и он же после каждого изменения, откуда бы оно ни пришло. */
const useExtensionList = (): readonly BrowserExtensionInfo[] | null => {
  const [list, setList] = useState<readonly BrowserExtensionInfo[] | null>(null);
  useEffect(() => {
    let alive = true;
    const off = window.launcher.extensions.onChanged((next) => setList(next));
    window.launcher.extensions.list().then(
      (next) => alive && setList(next ?? []),
      () => alive && setList([]),
    );
    return () => {
      alive = false;
      off();
    };
  }, []);
  return list;
};

/** Секция «Расширения» страницы «Браузер»: установка по ссылке, из файла и из папки, и список установленных. */
export const ExtensionsSection = () => {
  const { t } = useTranslation();
  const list = useExtensionList();
  const [input, setInput] = useState('');
  /** Откуда сейчас готовится установка: качается из магазина или распаковывается. */
  const [preparing, setPreparing] = useState<SourceKind | null>(null);
  /** Расширение, новую версию которого сейчас ищут и качают. */
  const [updating, setUpdating] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExtensionInstallPreview | null>(null);
  const [committing, setCommitting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** Расширения, над которыми идёт действие: включение, обновление, удаление. */
  const [working, setWorking] = useState<ReadonlySet<string>>(new Set());
  const [removing, setRemoving] = useState<BrowserExtensionInfo | null>(null);

  const alive = useRef(true);
  /** Подготовленный, но не установленный пакет: ушли со страницы — его папку в main надо убрать. */
  const pending = useRef<string | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (pending.current) void window.launcher.extensions.discard(pending.current);
      pending.current = null;
    };
  }, []);

  const installed = list ?? [];
  const locked = preparing !== null || updating !== null || committing;
  const fail = (code: unknown, context?: ErrorContext): Notice => ({
    tone: 'bad',
    text: t(errorKey(code, context)),
  });

  /** Подготовленный пакет — на суд пользователя; если страницы уже нет, спрашивать некого: распакованное — в корзину. */
  const review = (staged: ExtensionInstallPreview) => {
    if (!alive.current) {
      void window.launcher.extensions.discard(staged.stagingId);
      return;
    }
    pending.current = staged.stagingId;
    setPreview(staged);
  };

  const prepare = async (source: ExtensionInstallSource) => {
    if (locked) return;
    setPreparing(source.kind);
    setNotice(null);
    try {
      const res = await window.launcher.extensions.prepare(source);
      if (res.ok) review(res.value);
      else if (alive.current) setNotice(fail(res.error, source.kind));
    } catch {
      if (alive.current) setNotice(fail('io'));
    } finally {
      if (alive.current) setPreparing(null);
    }
  };

  const fromStore = (e: FormEvent) => {
    e.preventDefault();
    const value = input.trim();
    if (value) void prepare({ kind: 'webstore', input: value });
  };

  const fromFile = async () => {
    if (locked) return;
    const path = await window.launcher.settings.pickFile({
      title: t('settings.browser.extensions.pickFileTitle'),
      filters: [
        { name: t('settings.browser.extensions.pickFileFilter'), extensions: ['crx', 'zip'] },
      ],
    });
    if (path) await prepare({ kind: 'file', path });
  };

  const fromFolder = async () => {
    if (locked) return;
    const path = await window.launcher.settings.pickFile({
      title: t('settings.browser.extensions.pickFolderTitle'),
      directory: true,
    });
    if (path) await prepare({ kind: 'folder', path });
  };

  const cancelPreview = () => {
    if (committing) return;
    const stagingId = pending.current;
    pending.current = null;
    setPreview(null);
    if (stagingId) void window.launcher.extensions.discard(stagingId);
  };

  const install = async () => {
    if (!preview || committing) return;
    // Пакет main забирает сразу, удачно или нет: убирать за собой больше нечего.
    pending.current = null;
    setCommitting(true);
    try {
      const res = await window.launcher.extensions.commit(preview.stagingId);
      if (!alive.current) return;
      if (res.ok) {
        setInput('');
        const upgrade = preview.replaces !== null && !isReinstall(preview);
        setNotice({
          tone: 'ok',
          text: t(
            upgrade
              ? 'settings.browser.extensions.updated'
              : 'settings.browser.extensions.installed',
            { name: res.value.name, version: res.value.version },
          ),
        });
      } else setNotice(fail(res.error, 'commit'));
    } catch {
      if (alive.current) setNotice(fail('io'));
    } finally {
      if (alive.current) {
        setCommitting(false);
        setPreview(null);
      }
    }
  };

  /** Одно действие над одним расширением; список обновит сам main — событием изменения. */
  const act = async (id: string, work: () => Promise<Notice | null>) => {
    if (working.has(id)) return;
    setWorking((prev) => new Set(prev).add(id));
    setNotice(null);
    try {
      const next = await work();
      if (alive.current && next) setNotice(next);
    } catch {
      if (alive.current) setNotice(fail('io'));
    } finally {
      if (alive.current) {
        setWorking((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }
  };

  const toggle = (ext: BrowserExtensionInfo) =>
    act(ext.id, async () => {
      const res = await window.launcher.extensions.setEnabled(ext.id, !ext.enabled);
      return res.ok ? null : fail(res.error, 'manage');
    });

  /** Как установка: новая версия качается в сторону и ставится, только когда пользователь увидит, что она просит. */
  const update = async (ext: BrowserExtensionInfo) => {
    if (locked || working.has(ext.id)) return;
    setUpdating(ext.id);
    setNotice(null);
    try {
      const res = await window.launcher.extensions.update(ext.id);
      if (!res.ok) {
        if (alive.current) setNotice(fail(res.error, 'update'));
      } else if (res.value) review(res.value);
      else if (alive.current) {
        setNotice({
          tone: 'muted',
          text: t('settings.browser.extensions.upToDate', { name: ext.name }),
        });
      }
    } catch {
      if (alive.current) setNotice(fail('io'));
    } finally {
      if (alive.current) setUpdating(null);
    }
  };

  const remove = async (ext: BrowserExtensionInfo) => {
    await act(ext.id, async () => {
      const res = await window.launcher.extensions.remove(ext.id);
      return res.ok ? null : fail(res.error, 'manage');
    });
    if (alive.current) setRemoving(null);
  };

  return (
    <section className={s.listSection}>
      <h3 className={s.sectionLabel}>{t('settings.browser.extensions.section')}</h3>

      <div className={s.listCard}>
        <div className={s.toolbar}>
          <div className={s.toolbarInfo}>
            <span className={s.listCount}>
              {t('settings.browser.extensions.count', { count: installed.length })}
            </span>
          </div>
          <div className={s.toolbarActions}>
            <Tooltip label={t('settings.browser.extensions.fromFileHint')}>
              <Button
                size="sm"
                variant="neutral"
                icon={FileArchive}
                busy={preparing === 'file'}
                disabled={locked}
                onClick={() => void fromFile()}
              >
                {t('settings.browser.extensions.fromFile')}
              </Button>
            </Tooltip>
            <Tooltip label={t('settings.browser.extensions.fromFolderHint')}>
              <Button
                size="sm"
                variant="neutral"
                icon={FolderOpen}
                busy={preparing === 'folder'}
                disabled={locked}
                onClick={() => void fromFolder()}
              >
                {t('settings.browser.extensions.fromFolder')}
              </Button>
            </Tooltip>
          </div>
        </div>

        <form className={s.installPanel} onSubmit={fromStore}>
          <div className={s.installRow}>
            <input
              className={s.installInput}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('settings.browser.extensions.storePlaceholder')}
              aria-label={t('settings.browser.extensions.storeLabel')}
              spellCheck={false}
              autoComplete="off"
              disabled={locked}
            />
            <Button
              size="sm"
              variant="accent"
              type="submit"
              icon={Download}
              busy={preparing === 'webstore'}
              disabled={locked || input.trim() === ''}
            >
              {t('settings.browser.extensions.install')}
            </Button>
          </div>
          {preparing || updating ? (
            <p className={`${s.notice} ${s.noticeMuted}`} role="status">
              {preparing === 'file' || preparing === 'folder'
                ? t('settings.browser.extensions.preparingFile')
                : t('settings.browser.extensions.preparingStore')}
            </p>
          ) : (
            notice && (
              <p
                className={`${s.notice} ${NOTICE_TONE[notice.tone]}`}
                role={notice.tone === 'bad' ? 'alert' : 'status'}
              >
                {notice.text}
              </p>
            )
          )}
        </form>

        {list !== null &&
          (installed.length === 0 ? (
            <p className={s.empty}>{t('settings.browser.extensions.empty')}</p>
          ) : (
            <ul className={s.list}>
              {installed.map((ext) => {
                const busy = working.has(ext.id) || updating === ext.id;
                const source =
                  ext.source === 'webstore'
                    ? t('settings.browser.extensions.sourceWebstore')
                    : t('settings.browser.extensions.sourceFile');
                const switchLabel = ext.enabled
                  ? t('settings.browser.extensions.disable')
                  : t('settings.browser.extensions.enable');
                return (
                  <li key={ext.id} className={`${s.row} ${s.extRow}`}>
                    <span className={ext.enabled ? s.extFace : `${s.extFace} ${s.extFaceOff}`}>
                      <ExtensionIcon icon={ext.icon} />
                    </span>
                    <div className={ext.enabled ? s.rowInfo : `${s.rowInfo} ${s.extFaceOff}`}>
                      <span className={s.extTitleLine}>
                        <span className={s.rowTitle}>{ext.name}</span>
                        <span className={s.extVersion}>{ext.version}</span>
                        <span className={s.extTag}>{source}</span>
                        {!ext.enabled && (
                          <span className={s.extTag}>{t('settings.browser.extensions.off')}</span>
                        )}
                      </span>
                      {ext.description && <span className={s.rowSub}>{ext.description}</span>}
                    </div>

                    <div className={s.rowActions}>
                      {ext.source === 'webstore' && (
                        <Tooltip label={t('settings.browser.extensions.update')}>
                          <button
                            type="button"
                            className={s.iconBtn}
                            onClick={() => void update(ext)}
                            disabled={busy || locked}
                            aria-label={t('settings.browser.extensions.update')}
                          >
                            {busy ? (
                              <Loader2 size={15} className={s.spin} />
                            ) : (
                              <RefreshCw size={15} />
                            )}
                          </button>
                        </Tooltip>
                      )}
                      <Tooltip label={t('settings.browser.extensions.remove')}>
                        <button
                          type="button"
                          className={`${s.iconBtn} ${s.iconBtnDanger}`}
                          onClick={() => setRemoving(ext)}
                          disabled={busy}
                          aria-label={t('settings.browser.extensions.remove')}
                        >
                          <TrashIcon size={15} />
                        </button>
                      </Tooltip>
                    </div>

                    <Tooltip label={switchLabel}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={ext.enabled}
                        aria-label={`${switchLabel}: ${ext.name}`}
                        className={ext.enabled ? `${s.switch} ${s.switchOn}` : s.switch}
                        onClick={() => void toggle(ext)}
                        disabled={busy}
                      >
                        <span className={s.switchKnob} />
                      </button>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          ))}
      </div>

      <p className={s.listNote}>{t('settings.browser.extensions.note')}</p>

      {preview && (
        <PreviewModal
          preview={preview}
          installed={installed}
          committing={committing}
          onCancel={cancelPreview}
          onInstall={() => void install()}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={t('settings.browser.extensions.removeTitle')}
          body={t('settings.browser.extensions.removeBody', { name: removing.name })}
          cancelLabel={t('settings.browser.extensions.cancel')}
          onClose={() => setRemoving(null)}
          busy={working.has(removing.id)}
          actions={[
            {
              label: t('settings.browser.extensions.removeConfirm'),
              variant: 'danger',
              onClick: () => void remove(removing),
            },
          ]}
        />
      )}
    </section>
  );
};

/** Что пользователь разрешает, ставя расширение: права, сайты, чего здесь не будет, — и чем это грозит. */
const PreviewModal = ({
  preview,
  installed,
  committing,
  onCancel,
  onInstall,
}: {
  preview: ExtensionInstallPreview;
  installed: readonly BrowserExtensionInfo[];
  committing: boolean;
  onCancel: () => void;
  onInstall: () => void;
}) => {
  const { t } = useTranslation();
  const { extension: ext, replaces, unsupported } = preview;
  const access = hostAccess(ext.hostPermissions);
  const off = new Set(unsupported);
  const permission = (name: string): string => {
    const key = permissionKey(name);
    return key ? t(key) : name;
  };
  const source =
    ext.source === 'webstore'
      ? t('settings.browser.extensions.sourceWebstore')
      : t('settings.browser.extensions.sourceFile');

  return (
    <Modal
      title={
        replaces
          ? t('settings.browser.extensions.preview.titleReplace')
          : t('settings.browser.extensions.preview.title')
      }
      size="md"
      closable
      closeDisabled={committing}
      onClose={onCancel}
      footer={
        <>
          <ModalSpacer />
          <Button variant="ghost" size="sm" disabled={committing} onClick={onCancel}>
            {t('settings.browser.extensions.cancel')}
          </Button>
          <Button variant="accent" size="sm" busy={committing} onClick={onInstall}>
            {replaces
              ? t('settings.browser.extensions.preview.confirmReplace')
              : t('settings.browser.extensions.preview.confirm')}
          </Button>
        </>
      }
    >
      <div className={s.previewHead}>
        <ExtensionIcon icon={ext.icon} large />
        <div className={s.previewTitle}>
          <span className={s.previewName}>{ext.name}</span>
          <span className={s.previewMeta}>
            {t('settings.browser.extensions.preview.version', { version: ext.version })} · {source}
          </span>
          {replaces && (
            <span className={s.previewMeta}>
              {isReinstall(preview)
                ? t('settings.browser.extensions.preview.reinstall', { version: replaces })
                : t('settings.browser.extensions.preview.replaces', { version: replaces })}
            </span>
          )}
        </div>
      </div>

      {ext.description && <p className={s.previewDesc}>{ext.description}</p>}

      {/* Над списками, а не под ними: в невысоком окне до конца списка прав долистают не все. */}
      <ModalWarn>{t('settings.browser.extensions.preview.warning')}</ModalWarn>
      {replacesStoreInstall(preview, installed) && (
        <ModalWarn>{t('settings.browser.extensions.preview.fileOverStore')}</ModalWarn>
      )}

      <div className={s.previewBlock}>
        <h4 className={s.previewLabel}>{t('settings.browser.extensions.preview.permissions')}</h4>
        {ext.permissions.length === 0 ? (
          <p className={s.previewEmpty}>{t('settings.browser.extensions.preview.noPermissions')}</p>
        ) : (
          <ul className={s.permList}>
            {ext.permissions.map((name) => (
              <li key={name} className={off.has(name) ? s.permOff : undefined} title={name}>
                {permission(name)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={s.previewBlock}>
        <h4 className={s.previewLabel}>{t('settings.browser.extensions.preview.hosts')}</h4>
        {access.kind === 'all' && (
          <p className={s.permAll}>{t('settings.browser.extensions.preview.allSites')}</p>
        )}
        {access.kind === 'none' && (
          <p className={s.previewEmpty}>{t('settings.browser.extensions.preview.noHosts')}</p>
        )}
        {access.kind === 'some' && (
          <ul className={s.permList}>
            {access.hosts.map((host) => (
              <li key={host}>{host}</li>
            ))}
            {access.more > 0 && (
              <li className={s.permMore}>
                {t('settings.browser.extensions.preview.moreHosts', { count: access.more })}
              </li>
            )}
          </ul>
        )}
      </div>

      {unsupported.length > 0 && (
        <p className={s.previewEmpty}>
          {t('settings.browser.extensions.preview.unsupported', {
            list: unsupported.map((name) => lowerFirst(permission(name))).join(', '),
          })}
        </p>
      )}
    </Modal>
  );
};
