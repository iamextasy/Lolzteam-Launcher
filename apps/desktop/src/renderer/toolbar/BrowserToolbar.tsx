import { ArrowLeft, ArrowRight, Copy, ExternalLink, RotateCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import logoUrl from '~/assets/logolzt.svg';
import s from './BrowserToolbar.module.scss';

interface NavState {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  title: string;
}

type RetestResult = { ok: true; ms: number; ip: string } | { ok: false; message: string };

interface BrowserNavBridge {
  back: () => Promise<unknown>;
  forward: () => Promise<unknown>;
  reload: () => Promise<unknown>;
  stop: () => Promise<unknown>;
  go: (url: string) => Promise<unknown>;
  copyUrl: () => Promise<unknown>;
  openExternal: () => Promise<unknown>;
  expand: () => Promise<unknown>;
  collapse: () => Promise<unknown>;
  proxyRetest: () => Promise<RetestResult>;
  onState: (cb: (state: NavState) => void) => () => void;
}

declare global {
  interface Window {
    browserNav: BrowserNavBridge;
  }
}

const isRu = navigator.language.toLowerCase().startsWith('ru');
const L = {
  back: isRu ? 'Назад' : 'Back',
  forward: isRu ? 'Вперёд' : 'Forward',
  reload: isRu ? 'Обновить' : 'Reload',
  stop: isRu ? 'Остановить' : 'Stop',
  copy: isRu ? 'Копировать ссылку' : 'Copy link',
  copied: isRu ? 'Скопировано' : 'Copied',
  external: isRu ? 'Открыть во внешнем браузере' : 'Open in external browser',
  placeholder: isRu ? 'Введите адрес или запрос' : 'Search or enter address',
  proxy: isRu ? 'Прокси' : 'Proxy',
  proxyTitle: isRu ? 'Активный прокси' : 'Active proxy',
  label: isRu ? 'Название' : 'Label',
  address: isRu ? 'Адрес' : 'Address',
  latency: isRu ? 'Задержка' : 'Latency',
  recheck: isRu ? 'Проверить заново' : 'Re-check',
  failed: isRu ? 'Ошибка' : 'Failed',
  close: isRu ? 'Закрыть' : 'Close',
};

const params = new URLSearchParams(location.search);
const proxy = {
  enabled: params.get('proxy') === '1',
  label: params.get('label') ?? '',
  host: params.get('host') ?? '',
  port: params.get('port') ?? '',
  ms: params.get('ms') ?? '',
};

export const BrowserToolbar = () => {
  const [state, setState] = useState<NavState>({
    url: '',
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    title: '',
  });
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [ms, setMs] = useState(proxy.ms);
  const [testing, setTesting] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => window.browserNav.onState(setState), []);

  const display = editing ? draft : state.url;

  const submit = (): void => {
    const value = draft.trim();
    if (value) void window.browserNav.go(value);
    inputRef.current?.blur();
  };

  const copy = (): void => {
    void window.browserNav.copyUrl();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const openMenu = (): void => {
    setMenuOpen(true);
    void window.browserNav.expand();
  };

  const closeMenu = (): void => {
    setMenuOpen(false);
    void window.browserNav.collapse();
  };

  const recheck = async (): Promise<void> => {
    if (testing) return;
    setTesting(true);
    setFailed(false);
    try {
      const res = await window.browserNav.proxyRetest();
      if (res.ok) {
        setMs(String(res.ms));
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      {menuOpen && (
        <div
          className={s.backdrop}
          role="presentation"
          onClick={closeMenu}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') closeMenu();
          }}
        />
      )}
      <div className={s.bar}>
        <button
          type="button"
          className={s.iconBtn}
          onClick={() => void window.browserNav.back()}
          disabled={!state.canGoBack}
          title={L.back}
          aria-label={L.back}
        >
          <ArrowLeft size={18} />
        </button>
        <button
          type="button"
          className={s.iconBtn}
          onClick={() => void window.browserNav.forward()}
          disabled={!state.canGoForward}
          title={L.forward}
          aria-label={L.forward}
        >
          <ArrowRight size={18} />
        </button>
        <button
          type="button"
          className={s.iconBtn}
          onClick={() =>
            state.isLoading ? void window.browserNav.stop() : void window.browserNav.reload()
          }
          title={state.isLoading ? L.stop : L.reload}
          aria-label={state.isLoading ? L.stop : L.reload}
        >
          {state.isLoading ? <X size={18} /> : <RotateCw size={18} />}
        </button>

        <div className={s.address}>
          <input
            ref={inputRef}
            className={s.input}
            value={display}
            spellCheck={false}
            placeholder={L.placeholder}
            onFocus={(e) => {
              setEditing(true);
              setDraft(state.url);
              e.target.select();
            }}
            onBlur={() => setEditing(false)}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') {
                setEditing(false);
                inputRef.current?.blur();
              }
            }}
          />
          {state.isLoading && <span className={s.progress} />}
        </div>

        <button
          type="button"
          className={s.iconBtn}
          onClick={copy}
          title={copied ? L.copied : L.copy}
          aria-label={L.copy}
        >
          <Copy size={16} className={copied ? s.copied : undefined} />
        </button>
        <button
          type="button"
          className={s.iconBtn}
          onClick={() => void window.browserNav.openExternal()}
          title={L.external}
          aria-label={L.external}
        >
          <ExternalLink size={16} />
        </button>

        {proxy.enabled && (
          <div className={s.proxyWrap}>
            <button
              type="button"
              className={menuOpen ? `${s.proxyBtn} ${s.proxyBtnActive}` : s.proxyBtn}
              onClick={() => (menuOpen ? closeMenu() : openMenu())}
              title={L.proxy}
              aria-label={L.proxy}
            >
              <img className={s.proxyLogo} src={logoUrl} alt="" />
              <span className={s.proxyDot} />
            </button>

            {menuOpen && (
              <dialog
                className={s.menu}
                open
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <header className={s.menuHead}>
                  <h2 className={s.menuTitle}>{L.proxyTitle}</h2>
                  <button
                    type="button"
                    className={s.menuClose}
                    onClick={closeMenu}
                    aria-label={L.close}
                  >
                    <X size={16} />
                  </button>
                </header>
                <dl className={s.rows}>
                  {proxy.label.trim() && (
                    <div className={s.row}>
                      <dt className={s.key}>{L.label}</dt>
                      <dd className={s.val}>{proxy.label}</dd>
                    </div>
                  )}
                  <div className={s.row}>
                    <dt className={s.key}>{L.address}</dt>
                    <dd className={s.val}>
                      {proxy.host}:{proxy.port}
                    </dd>
                  </div>
                  <div className={s.row}>
                    <dt className={s.key}>{L.latency}</dt>
                    <dd className={s.valGroup}>
                      <span className={s.val}>
                        {testing ? '…' : failed ? L.failed : ms ? `${ms} ms` : '—'}
                      </span>
                      <button
                        type="button"
                        className={s.recheck}
                        onClick={() => void recheck()}
                        disabled={testing}
                        aria-label={L.recheck}
                        title={L.recheck}
                      >
                        <RotateCw size={14} className={testing ? s.spin : undefined} />
                      </button>
                    </dd>
                  </div>
                </dl>
              </dialog>
            )}
          </div>
        )}
      </div>
    </>
  );
};
