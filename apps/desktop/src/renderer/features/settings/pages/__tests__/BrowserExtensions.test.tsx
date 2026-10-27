import type { BrowserExtensionInfo, ExtensionInstallPreview, ExtensionResult } from '@shared-types';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { installLauncher } from '~/testing/launcher';
import { renderWithProviders, t } from '~/testing/render';
import { ExtensionsSection } from '../BrowserExtensions';

/** Synthetic ids: 32 letters a–p, as Chrome spells them. */
const ID_A = 'abcdefghijklmnopabcdefghijklmnop';
const ID_B = 'ponmlkjihgfedcbaponmlkjihgfedcba';

const info = (over: Partial<BrowserExtensionInfo> = {}): BrowserExtensionInfo => ({
  id: ID_A,
  name: 'Example Helper',
  version: '1.2.3',
  description: 'Synthetic extension for tests.',
  enabled: true,
  source: 'webstore',
  manifestVersion: 3,
  permissions: ['storage', 'cookies'],
  hostPermissions: ['<all_urls>'],
  hasPopup: true,
  hasOptions: true,
  icon: null,
  installedAt: 1,
  ...over,
});

const previewOf = (
  over: Partial<BrowserExtensionInfo> = {},
  replaces: string | null = null,
): ExtensionInstallPreview => {
  const { enabled: _e, installedAt: _i, ...extension } = info(over);
  return { stagingId: 'stg-1', extension, replaces, unsupported: ['cookies'] };
};

const ok = <T,>(value: T): ExtensionResult<T> => ({ ok: true, value });

/** The preload's `extensions` namespace, with every call a spy. */
const setup = (installed: BrowserExtensionInfo[] = [], preview = previewOf()) => {
  const api = {
    list: vi.fn(async () => installed),
    onChanged: vi.fn(() => () => undefined),
    prepare: vi.fn(async () => ok(preview)),
    commit: vi.fn(async () => ok(info())),
    discard: vi.fn(async () => undefined),
    setEnabled: vi.fn(async (id: string, enabled: boolean) => ok(info({ id, enabled }))),
    update: vi.fn(async () => ok(null)),
    remove: vi.fn(async () => ok(null)),
  };
  installLauncher({ extensions: api });
  return api;
};

const typeLink = async (user: ReturnType<typeof userEvent.setup>, link: string) => {
  await user.type(
    screen.getByRole('textbox', { name: t('settings.browser.extensions.storeLabel') }),
    `${link}{Enter}`,
  );
};

describe('ExtensionsSection', () => {
  it('lists what is installed, each with its own switch', async () => {
    const api = setup([info(), info({ id: ID_B, name: 'Second', enabled: false })]);
    const user = userEvent.setup();
    renderWithProviders(<ExtensionsSection />);

    expect(await screen.findByText('Example Helper')).toBeInTheDocument();
    const switches = screen.getAllByRole('switch');
    expect(switches.map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'false']);

    await user.click(switches[1] as HTMLElement);
    expect(api.setEnabled).toHaveBeenCalledWith(ID_B, true);
  });

  it('shows what an install asks for before anything is installed, and cleans up on cancel', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderWithProviders(<ExtensionsSection />);

    await typeLink(user, `https://chromewebstore.google.com/detail/example/${ID_A}`);
    expect(api.prepare).toHaveBeenCalledWith({
      kind: 'webstore',
      input: `https://chromewebstore.google.com/detail/example/${ID_A}`,
    });

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Example Helper');
    expect(dialog).toHaveTextContent(t('settings.browser.extensions.preview.warning'));
    expect(dialog).toHaveTextContent(t('settings.browser.extensions.perm.storage'));
    expect(dialog).toHaveTextContent(t('settings.browser.extensions.preview.allSites'));
    expect(api.commit).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole('button', { name: t('settings.browser.extensions.cancel') }),
    );
    expect(api.discard).toHaveBeenCalledWith('stg-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('installs on «Установить», and leaves nothing to discard after', async () => {
    const api = setup();
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<ExtensionsSection />);

    await typeLink(user, ID_A);
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', {
        name: t('settings.browser.extensions.preview.confirm'),
      }),
    );

    expect(api.commit).toHaveBeenCalledWith('stg-1');
    expect(
      await screen.findByText(
        t('settings.browser.extensions.installed', { name: 'Example Helper', version: '1.2.3' }),
      ),
    ).toBeInTheDocument();
    unmount();
    expect(api.discard).not.toHaveBeenCalled();
  });

  it('discards a preview the user walked away from', async () => {
    const api = setup();
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<ExtensionsSection />);

    await typeLink(user, ID_A);
    await screen.findByRole('dialog');
    unmount();
    expect(api.discard).toHaveBeenCalledWith('stg-1');
  });

  it('says what went wrong, in the words for where it came from', async () => {
    const api = setup();
    api.prepare.mockResolvedValueOnce({ ok: false, error: 'bad_input' } as never);
    const user = userEvent.setup();
    renderWithProviders(<ExtensionsSection />);

    await typeLink(user, 'not a link');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t('settings.browser.extensions.errors.bad_input'),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('warns when a file takes over an extension installed from the store', async () => {
    setup([info()], previewOf({ source: 'file' }, '1.2.3'));
    const user = userEvent.setup();
    renderWithProviders(<ExtensionsSection />);
    await screen.findByText('Example Helper');

    await typeLink(user, ID_A);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(t('settings.browser.extensions.preview.fileOverStore'));
    expect(
      within(dialog).getByRole('button', {
        name: t('settings.browser.extensions.preview.confirmReplace'),
      }),
    ).toBeInTheDocument();
  });

  it('shows what a store update asks for, and installs it only once the user agrees', async () => {
    const api = setup([info()]);
    api.update.mockResolvedValueOnce(
      ok(previewOf({ version: '1.3.0', permissions: ['storage', 'cookies'] }, '1.2.3')) as never,
    );
    api.commit.mockResolvedValueOnce(ok(info({ version: '1.3.0' })));
    const user = userEvent.setup();
    renderWithProviders(<ExtensionsSection />);
    await screen.findByText('Example Helper');

    await user.click(screen.getByRole('button', { name: t('settings.browser.extensions.update') }));
    expect(api.update).toHaveBeenCalledWith(ID_A);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      t('settings.browser.extensions.preview.replaces', { version: '1.2.3' }),
    );
    expect(dialog).toHaveTextContent(t('settings.browser.extensions.preview.warning'));
    expect(api.commit).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole('button', {
        name: t('settings.browser.extensions.preview.confirmReplace'),
      }),
    );
    expect(api.commit).toHaveBeenCalledWith('stg-1');
    expect(
      await screen.findByText(
        t('settings.browser.extensions.updated', { name: 'Example Helper', version: '1.3.0' }),
      ),
    ).toBeInTheDocument();
  });

  it('says so when the store has nothing newer, with nothing to confirm', async () => {
    const api = setup([info()]);
    const user = userEvent.setup();
    renderWithProviders(<ExtensionsSection />);
    await screen.findByText('Example Helper');

    await user.click(screen.getByRole('button', { name: t('settings.browser.extensions.update') }));
    expect(
      await screen.findByText(
        t('settings.browser.extensions.upToDate', { name: 'Example Helper' }),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.commit).not.toHaveBeenCalled();
  });

  it('asks before removing, then removes', async () => {
    const api = setup([info()]);
    const user = userEvent.setup();
    renderWithProviders(<ExtensionsSection />);
    await screen.findByText('Example Helper');

    await user.click(screen.getByRole('button', { name: t('settings.browser.extensions.remove') }));
    expect(api.remove).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: t('settings.browser.extensions.removeConfirm'),
      }),
    );
    expect(api.remove).toHaveBeenCalledWith(ID_A);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
