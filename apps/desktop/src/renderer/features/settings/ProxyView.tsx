import type { LauncherSettings, ProxyEntry, ProxyTestResult, ServiceId } from '@shared-types';
import { PROXY_CAPABLE_SERVICES } from '@shared-types';
import { ArrowLeft, Check, Loader2, Pencil, Plus, Trash2, Wifi } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAgo } from '~/lib/time';
import { Modal } from '~/widgets/Modal/Modal';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import s from './ProxyView.module.scss';

const SERVICE_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  discord: 'Discord',
};

interface ProxyViewProps {
  onBack: () => void;
}

const proxyKey = (p: Pick<ProxyEntry, 'host' | 'port' | 'username' | 'password'>): string =>
  `${p.host}:${p.port}:${p.username ?? ''}:${p.password ?? ''}`;

const parseProxyLine = (line: string): Omit<ProxyEntry, 'id'> | null => {
  const parts = line.trim().split(':');
  if (parts.length < 2) return null;
  const [host, portRaw, username, password] = parts;
  const port = Number(portRaw);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return {
    host,
    port,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  };
};

export const ProxyView = ({ onBack }: ProxyViewProps) => {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<LauncherSettings | null>(null);
  const [bulk, setBulk] = useState('');
  const [checkOnAdd, setCheckOnAdd] = useState(true);
  const [testing, setTesting] = useState<Set<string>>(new Set());
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [editing, setEditing] = useState<ProxyEntry | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  });

  const lineCount = Math.max(3, bulk.split('\n').length);

  useEffect(() => {
    let alive = true;
    window.launcher.settings.get().then((next) => {
      if (alive) setSettings(next.settings);
    });
    const off = window.launcher.settings.onChanged((next) => setSettings(next.settings));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const proxies = settings?.proxies ?? [];
  const proxyEnabled = settings?.proxyEnabled ?? false;
  const proxyServices = settings?.proxyServices ?? [];

  const proxiesRef = useRef<ProxyEntry[]>(proxies);
  proxiesRef.current = proxies;

  const persist = async (patch: Partial<LauncherSettings>) => {
    const next = await window.launcher.settings.set(patch);
    setSettings(next.settings);
  };

  const patchProxyTest = async (id: string, test: ProxyTestResult) => {
    const next = proxiesRef.current.map((p) => (p.id === id ? { ...p, test } : p));
    proxiesRef.current = next;
    await persist({ proxies: next });
  };

  const toggleEnabled = () => void persist({ proxyEnabled: !proxyEnabled });

  const toggleService = (id: ServiceId) => {
    const next = proxyServices.includes(id)
      ? proxyServices.filter((x) => x !== id)
      : [...proxyServices, id];
    void persist({ proxyServices: next });
  };

  const addProxies = async () => {
    const seen = new Set(proxiesRef.current.map(proxyKey));
    const parsed: ProxyEntry[] = [];
    for (const line of bulk.split('\n')) {
      const p = parseProxyLine(line);
      if (!p) continue;
      const key = proxyKey(p);
      if (seen.has(key)) continue;
      seen.add(key);
      parsed.push({ ...p, id: crypto.randomUUID() });
    }
    if (parsed.length === 0) return;
    await persist({ proxies: [...proxiesRef.current, ...parsed] });
    setBulk('');
    if (checkOnAdd) await Promise.all(parsed.map((p) => testProxy(p)));
  };

  const removeProxy = (id: string) => {
    void persist({ proxies: proxiesRef.current.filter((p) => p.id !== id) });
  };

  const deleteAll = () => {
    void persist({ proxies: [] });
    setDeleteAllOpen(false);
  };

  const saveEdit = (next: ProxyEntry) => {
    const { test: _drop, ...rest } = next;
    void persist({
      proxies: proxiesRef.current.map((p) => (p.id === next.id ? rest : p)),
    });
    setEditing(null);
  };

  const testProxy = async (entry: ProxyEntry) => {
    setTesting((prev) => new Set(prev).add(entry.id));
    try {
      const res = await window.launcher.proxy.test({
        host: entry.host,
        port: entry.port,
        username: entry.username,
        password: entry.password,
      });
      await patchProxyTest(entry.id, {
        ok: res.ok,
        checkedAt: Date.now(),
        ...(res.ok ? { ms: res.ms, ip: res.ip } : { message: res.message }),
      });
    } catch (err) {
      await patchProxyTest(entry.id, {
        ok: false,
        checkedAt: Date.now(),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }
  };

  return (
    <div className={s.container}>
      <div className={s.block}>
        <header className={s.header}>
          <button
            type="button"
            className={s.back}
            onClick={onBack}
            aria-label={t('settings.proxy.back')}
          >
            <ArrowLeft size={18} />
          </button>
          <span className={s.headerTitle}>{t('settings.proxy.menuLabel')}</span>
        </header>

        <div className={s.toggleMenu}>
          <div className={s.text}>
            <span className={s.title}>{t('settings.proxy.toggleLabel')}</span>
            <span className={s.description}>{t('settings.proxy.toggleHint')}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={proxyEnabled}
            className={s.toggleRow}
            onClick={toggleEnabled}
          >
            <span className={`${s.switch} ${proxyEnabled ? s.switchOn : ''}`}>
              <span className={s.switchKnob} />
            </span>
          </button>
        </div>

        {proxyEnabled && (
          <div className={s.servicesBlock}>
            <div className={s.text}>
              <span className={s.title}>{t('settings.proxy.servicesLabel')}</span>
              <span className={s.description}>{t('settings.proxy.servicesHint')}</span>
            </div>
            <div className={s.serviceChips}>
              {PROXY_CAPABLE_SERVICES.map((id) => {
                const on = proxyServices.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    className={`${s.serviceChip} ${on ? s.serviceChipOn : ''}`}
                    onClick={() => toggleService(id)}
                  >
                    {on && <Check size={14} />}
                    <span>{SERVICE_LABELS[id] ?? id}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className={s.addBlock}>
          <span className={s.addTitle}>{t('settings.proxy.addTitle')}</span>
          <div className={s.editorScroll}>
            <div className={s.editor}>
              <div className={s.gutter} aria-hidden>
                {Array.from({ length: lineCount }, (_, i) => (
                  <span key={String(i + 1)} className={s.lineNo}>
                    {i + 1}
                  </span>
                ))}
              </div>
              <textarea
                ref={textareaRef}
                className={s.textarea}
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                placeholder={t('settings.proxy.bulkPlaceholder')}
                rows={3}
                spellCheck={false}
                wrap="off"
              />
            </div>
          </div>
          <div className={s.addRow}>
            <button
              type="button"
              className={s.addBtn}
              onClick={() => void addProxies()}
              disabled={bulk.trim() === ''}
            >
              <Plus size={16} />
              <span>{t('settings.proxy.addLabel')}</span>
            </button>
            <button
              type="button"
              aria-pressed={checkOnAdd}
              className={s.checkOnAdd}
              onClick={() => setCheckOnAdd((v) => !v)}
            >
              <span className={`${s.checkbox} ${checkOnAdd ? s.checkboxOn : ''}`}>
                {checkOnAdd && <Check size={12} />}
              </span>
              <span>{t('settings.proxy.checkOnAdd')}</span>
            </button>
          </div>
        </div>

        <div className={s.proxyBlock}>
          {proxies.length > 0 && (
            <div className={s.listHeader}>
              <span className={s.listCount}>
                {t('settings.proxy.listCount', { count: proxies.length })}
              </span>
              <button
                type="button"
                className={s.deleteAllBtn}
                onClick={() => setDeleteAllOpen(true)}
              >
                <Trash2 size={14} />
                <span>{t('settings.proxy.deleteAll')}</span>
              </button>
            </div>
          )}

          {proxies.length === 0 ? (
            <p className={s.empty}>{t('settings.proxy.listEmpty')}</p>
          ) : (
            <ul className={s.list}>
              {proxies.map((entry) => {
                const isTesting = testing.has(entry.id);
                const res = entry.test;
                return (
                  <li key={entry.id} className={s.row}>
                    <div className={s.rowInfo}>
                      <span className={s.rowHost}>
                        {entry.host}:{entry.port}
                        {entry.username ? ` · ${entry.username}` : ''}
                      </span>
                      {isTesting ? (
                        <span className={s.description}>{t('settings.proxy.testing')}</span>
                      ) : res ? (
                        <span className={s.rowStatus}>
                          <span className={res.ok ? s.resultOk : s.resultFail}>
                            {res.ok
                              ? t('settings.proxy.statusValid')
                              : t('settings.proxy.statusInvalid')}{' '}
                            ({formatAgo(res.checkedAt, i18n.language)})
                          </span>
                          {res.ok && res.ms !== undefined && (
                            <span className={s.rowPing}>
                              {t('settings.proxy.ping', { ms: res.ms })}
                            </span>
                          )}
                        </span>
                      ) : null}
                    </div>
                    <div className={s.rowActions}>
                      <Tooltip label={t('settings.proxy.testLabel')}>
                        <button
                          type="button"
                          className={s.iconBtn}
                          onClick={() => void testProxy(entry)}
                          disabled={isTesting}
                        >
                          {isTesting ? (
                            <Loader2 size={16} className={s.spin} />
                          ) : (
                            <Wifi size={16} />
                          )}
                        </button>
                      </Tooltip>
                      <Tooltip label={t('settings.proxy.editLabel')}>
                        <button
                          type="button"
                          className={s.iconBtn}
                          onClick={() => setEditing(entry)}
                        >
                          <Pencil size={16} />
                        </button>
                      </Tooltip>
                      <Tooltip label={t('settings.proxy.deleteLabel')}>
                        <button
                          type="button"
                          className={`${s.iconBtn} ${s.iconBtnDanger}`}
                          onClick={() => removeProxy(entry.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </Tooltip>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {deleteAllOpen && (
        <Modal
          title={t('settings.proxy.deleteAllConfirmTitle')}
          closable
          onClose={() => setDeleteAllOpen(false)}
        >
          <div className={s.confirm}>
            <p className={s.confirmBody}>{t('settings.proxy.deleteAllConfirmBody')}</p>
            <div className={s.confirmActions}>
              <button
                type="button"
                className={s.confirmCancel}
                onClick={() => setDeleteAllOpen(false)}
              >
                {t('settings.proxy.cancel')}
              </button>
              <button type="button" className={s.confirmDanger} onClick={deleteAll}>
                {t('settings.proxy.deleteAll')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title={t('settings.proxy.editTitle')} closable onClose={() => setEditing(null)}>
          <ProxyEditForm entry={editing} onCancel={() => setEditing(null)} onSave={saveEdit} />
        </Modal>
      )}
    </div>
  );
};

interface ProxyEditFormProps {
  entry: ProxyEntry;
  onCancel: () => void;
  onSave: (next: ProxyEntry) => void;
}

const ProxyEditForm = ({ entry, onCancel, onSave }: ProxyEditFormProps) => {
  const { t } = useTranslation();
  const [host, setHost] = useState(entry.host);
  const [port, setPort] = useState(String(entry.port));
  const [username, setUsername] = useState(entry.username ?? '');
  const [password, setPassword] = useState(entry.password ?? '');

  const portNum = Number(port);
  const portValid = Number.isInteger(portNum) && portNum > 0 && portNum <= 65535;
  const valid = host.trim() !== '' && portValid;

  const submit = () => {
    if (!valid) return;
    onSave({
      id: entry.id,
      host: host.trim(),
      port: portNum,
      ...(username.trim() ? { username: username.trim() } : {}),
      ...(password ? { password } : {}),
    });
  };

  return (
    <form
      className={s.editForm}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className={s.field}>
        <span className={s.fieldLabel}>{t('settings.proxy.fieldHost')}</span>
        <input
          className={s.input}
          value={host}
          onChange={(e) => setHost(e.target.value)}
          spellCheck={false}
        />
      </label>
      <label className={s.field}>
        <span className={s.fieldLabel}>{t('settings.proxy.fieldPort')}</span>
        <input
          className={`${s.input} ${port !== '' && !portValid ? s.inputError : ''}`}
          value={port}
          onChange={(e) => setPort(e.target.value)}
          inputMode="numeric"
          spellCheck={false}
        />
      </label>
      <label className={s.field}>
        <span className={s.fieldLabel}>{t('settings.proxy.fieldUser')}</span>
        <input
          className={s.input}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          spellCheck={false}
        />
      </label>
      <label className={s.field}>
        <span className={s.fieldLabel}>{t('settings.proxy.fieldPass')}</span>
        <input
          className={s.input}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          spellCheck={false}
        />
      </label>
      <div className={s.confirmActions}>
        <button type="button" className={s.confirmCancel} onClick={onCancel}>
          {t('settings.proxy.cancel')}
        </button>
        <button type="submit" className={s.saveBtn} disabled={!valid}>
          {t('settings.proxy.save')}
        </button>
      </div>
    </form>
  );
};
