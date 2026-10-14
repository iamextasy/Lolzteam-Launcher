import { LOLZ_CONFIG } from '@lolzteam/shared-ipc';
import ky, { HTTPError, type KyInstance } from 'ky';
import { type PageCursor, applyCursor } from './pagination';
import type {
  ApiCallRecord,
  CheckAccountResponse,
  EmailCodeResponse,
  ItemEditFields,
  RawAiPriceResponse,
  RawAutoBuyPriceResponse,
  RawEditMeResponse,
  RawGuardCodeResponse,
  RawLettersResponse,
  RawMarketItem,
  RawOrdersResponse,
  RawProfileResponse,
  RawStatusResponse,
  RawTagOpResponse,
  RawUserTagResponse,
  RawUserTagsResponse,
} from './types';

export interface MarketClientOptions {
  baseUrl?: string;
  getToken: () => Promise<string | null> | string | null;
  userAgent?: string;
  fetch?: typeof globalThis.fetch;
  /** Every finished request, handed to whoever is counting them. Must never throw. */
  onResponse?: (record: ApiCallRecord) => void;
}

/** Longest we will sit on a `429`. */
const MAX_RETRY_WAIT_MS = 70_000;

/** Enough that the window has demonstrably rolled over when we ask again. */
const RESET_SLACK_MS = 500;

const sleep = (ms: number, signal?: AbortSignal | null): Promise<void> =>
  new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** How long to hold off after a `429`, from the response that carried it. */
const waitAfterRateLimit = (response: Response, now: number): number => {
  const reset = Number(response.headers.get('X-RateLimit-Reset'));
  if (!Number.isFinite(reset) || reset <= 0) return MAX_RETRY_WAIT_MS;
  return Math.min(Math.max(reset * 1000 - now + RESET_SLACK_MS, 0), MAX_RETRY_WAIT_MS);
};

/** `X-RateLimit-*`, when the server sent them — the monitor's live numbers. */
const headerCount = (response: Response, name: string): number | undefined => {
  const value = Number(response.headers.get(name));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
};

/** When each in-flight request left, keyed by the request it belongs to. */
const startedAt = new WeakMap<Request, number>();

export class MarketClient {
  private readonly http: KyInstance;
  private readonly getToken: MarketClientOptions['getToken'];

  constructor(opts: MarketClientOptions) {
    this.getToken = opts.getToken;
    this.http = ky.create({
      prefixUrl: opts.baseUrl ?? LOLZ_CONFIG.marketApiUrl,
      timeout: 20_000,
      retry: { limit: 2, methods: ['get'], statusCodes: [429, 500, 502, 503, 504] },
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      hooks: {
        beforeRequest: [
          async (req) => {
            startedAt.set(req, Date.now());
            const token = await this.getToken();
            if (token) req.headers.set('Authorization', `Bearer ${token}`);
            if (opts.userAgent) req.headers.set('User-Agent', opts.userAgent);
            req.headers.set('Accept', 'application/json');
          },
        ],
        afterResponse: [
          (request, _options, response) => {
            if (!opts.onResponse) return response;
            try {
              const began = startedAt.get(request) ?? Date.now();
              let path = new URL(request.url).pathname;
              if (path.startsWith('/')) path = path.slice(1);
              opts.onResponse({
                at: Date.now(),
                method: request.method,
                path,
                status: response.status,
                durationMs: Math.max(0, Date.now() - began),
                limit: headerCount(response, 'X-RateLimit-Limit'),
                remaining: headerCount(response, 'X-RateLimit-Remaining'),
                reset: headerCount(response, 'X-RateLimit-Reset'),
              });
            } catch {}
            return response;
          },
        ],
        beforeRetry: [
          async ({ request, error }) => {
            if (!(error instanceof HTTPError) || error.response.status !== 429) return;
            await sleep(waitAfterRateLimit(error.response, Date.now()), request.signal);
          },
        ],
      },
    });
  }

  /** `List.Orders` — accounts the user has purchased. */
  async listOrders(
    params: { cursor?: PageCursor; categoryId?: number } = {},
    signal?: AbortSignal,
  ): Promise<RawOrdersResponse> {
    const search = new URLSearchParams();
    applyCursor(search, params.cursor);
    if (params.categoryId) search.set('category_id', String(params.categoryId));
    return this.http.get('user/orders', { searchParams: search, signal }).json<RawOrdersResponse>();
  }

  /** `Get Proxy` — the user's saved proxy list. */
  async listProxies(signal?: AbortSignal): Promise<unknown> {
    return this.http.get('proxy', { signal }).json<unknown>();
  }

  /** `List.User` — accounts the authenticated user owns (listings + purchases). */
  async listUser(
    params: { cursor?: PageCursor; categoryId?: number; show?: string } = {},
    signal?: AbortSignal,
  ): Promise<RawOrdersResponse> {
    const search = new URLSearchParams();
    applyCursor(search, params.cursor);
    if (params.categoryId) search.set('category_id', String(params.categoryId));
    if (params.show) search.set('show', params.show);
    return this.http.get('user/items', { searchParams: search, signal }).json<RawOrdersResponse>();
  }

  /** `Managing.Get` — full details for a single item (login/password/etc). */
  async getItem(itemId: number, signal?: AbortSignal): Promise<{ item?: RawMarketItem }> {
    return this.http.get(String(itemId), { signal }).json<{ item?: RawMarketItem }>();
  }

  /** `Managing.Steam.GetMafile` — Steam Guard mafile for the item. Cancels the item's active guarantee. */
  async getSteamMafile(itemId: number, signal?: AbortSignal): Promise<unknown> {
    return this.http.get(`${itemId}/mafile`, { signal }).json<unknown>();
  }

  /**
   * `Managing.Steam.GetGuardCode` — the current Steam Guard TOTP, straight from
   * the maFile the market holds. Unlike `getSteamMafile` this leaves the item's
   * active guarantee untouched.
   */
  async getSteamGuardCode(itemId: number, signal?: AbortSignal): Promise<RawGuardCodeResponse> {
    return this.http
      .get(`${itemId}/guard-code`, { signal, throwHttpErrors: false })
      .json<RawGuardCodeResponse>();
  }

  async checkAccount(itemId: number, signal?: AbortSignal): Promise<CheckAccountResponse> {
    return this.http
      .post(`${itemId}/check-account`, { throwHttpErrors: false, signal })
      .json<CheckAccountResponse>();
  }

  /** `Managing.EmailCode` — fetch parsed email confirmation code for the item. */
  async getEmailCode(itemId: number, signal?: AbortSignal): Promise<EmailCodeResponse> {
    return this.http
      .get(`${itemId}/email-code`, { throwHttpErrors: false, signal })
      .json<EmailCodeResponse>();
  }

  async getLetters(
    params: {
      emailPassword?: string;
      email?: string;
      password?: string;
      limit?: number;
    },
    signal?: AbortSignal,
  ): Promise<RawLettersResponse> {
    const search = new URLSearchParams();
    if (params.emailPassword) search.set('email_password', params.emailPassword);
    if (params.email) search.set('email', params.email);
    if (params.password) search.set('password', params.password);
    if (params.limit) search.set('limit', String(params.limit));
    return this.http
      .get('letters2', { searchParams: search, throwHttpErrors: false, signal })
      .json<RawLettersResponse>();
  }

  /** `Managing.Tag.Add` — attach one of the user's labels to the item. */
  async addItemTag(itemId: number, tagId: number): Promise<RawTagOpResponse> {
    return this.http
      .post(`${itemId}/tag`, { json: { tag_id: tagId }, throwHttpErrors: false })
      .json<RawTagOpResponse>();
  }

  /** `Managing.Tag.Delete` — detach a label from the item. */
  async removeItemTag(itemId: number, tagId: number): Promise<RawTagOpResponse> {
    return this.http
      .delete(`${itemId}/tag`, { json: { tag_id: tagId }, throwHttpErrors: false })
      .json<RawTagOpResponse>();
  }

  /** `EditMarketSettings` — change the account currency (PUT /me). */
  async updateCurrency(currency: string): Promise<RawEditMeResponse> {
    return this.http
      .put('me', { json: { user: { currency } }, throwHttpErrors: false })
      .json<RawEditMeResponse>();
  }

  /** `Managing.NoteEdit` — replace the private note on an item. */
  async setItemNote(itemId: number, text: string): Promise<RawStatusResponse> {
    return this.http
      .put(`${itemId}/note`, { json: { text }, throwHttpErrors: false })
      .json<RawStatusResponse>();
  }

  /** `Managing.NoteDelete` — remove it. */
  async deleteItemNote(itemId: number): Promise<RawStatusResponse> {
    return this.http.delete(`${itemId}/note`, { throwHttpErrors: false }).json<RawStatusResponse>();
  }

  /** `Managing.Bump` — push the listing back to the top of search. */
  async bumpItem(itemId: number): Promise<RawStatusResponse> {
    return this.http.post(`${itemId}/bump`, { throwHttpErrors: false }).json<RawStatusResponse>();
  }

  /**
   * `Managing.Edit` — the edit endpoint takes the fields themselves; every one
   * left out keeps its current value. `currency` is required whenever `price`
   * moves, and the market answers 403 when a price is cut by more than half.
   */
  async editItem(itemId: number, fields: ItemEditFields): Promise<RawStatusResponse> {
    return this.http
      .put(`${itemId}/edit`, { json: fields, throwHttpErrors: false })
      .json<RawStatusResponse>();
  }

  /** The one-field form of `editItem`, kept for the reprice path. */
  async setItemPrice(itemId: number, price: number, currency: string): Promise<RawStatusResponse> {
    return this.editItem(itemId, { price, currency });
  }

  /** `Managing.AutoBump` — bump the listing again every `hour` hours. */
  async setAutoBump(itemId: number, hour: number): Promise<RawStatusResponse> {
    return this.http
      .post(`${itemId}/auto-bump`, { json: { hour }, throwHttpErrors: false })
      .json<RawStatusResponse>();
  }

  /** `Managing.AutoBumpDelete` — stop bumping it on a timer. */
  async disableAutoBump(itemId: number): Promise<RawStatusResponse> {
    return this.http
      .delete(`${itemId}/auto-bump`, { throwHttpErrors: false })
      .json<RawStatusResponse>();
  }

  /** `Managing.Open` — put the listing back on sale. */
  async openItem(itemId: number): Promise<RawStatusResponse> {
    return this.http.post(`${itemId}/open`, { throwHttpErrors: false }).json<RawStatusResponse>();
  }

  /** `Managing.Close` — take the listing off sale without deleting it. */
  async closeItem(itemId: number): Promise<RawStatusResponse> {
    return this.http.post(`${itemId}/close`, { throwHttpErrors: false }).json<RawStatusResponse>();
  }

  /** `Managing.Delete` — a soft delete: the listing leaves public search and can be restored. */
  async deleteItem(itemId: number, reason: string): Promise<RawStatusResponse> {
    return this.http
      .delete(String(itemId), { json: { reason }, throwHttpErrors: false })
      .json<RawStatusResponse>();
  }

  /** `Managing.Stick` — pin the listing to the top of search. */
  async stickItem(itemId: number): Promise<RawStatusResponse> {
    return this.http.post(`${itemId}/stick`, { throwHttpErrors: false }).json<RawStatusResponse>();
  }

  /** `Managing.Unstick` — unpin it. */
  async unstickItem(itemId: number): Promise<RawStatusResponse> {
    return this.http
      .delete(`${itemId}/stick`, { throwHttpErrors: false })
      .json<RawStatusResponse>();
  }

  /** `Managing.AutoBuyPrice` — what the market would pay for the item itself. */
  async getAutoBuyPrice(itemId: number, signal?: AbortSignal): Promise<RawAutoBuyPriceResponse> {
    return this.http
      .get(`${itemId}/auto-buy-price`, { signal, throwHttpErrors: false })
      .json<RawAutoBuyPriceResponse>();
  }

  /** `Managing.PublicTag.Add` — a tag every visitor of the listing sees. */
  async addPublicTag(itemId: number, tagId: number): Promise<RawTagOpResponse> {
    return this.http
      .post(`${itemId}/public-tag`, { json: { tag_id: tagId }, throwHttpErrors: false })
      .json<RawTagOpResponse>();
  }

  /** `Managing.PublicTag.Delete` — take one off. */
  async removePublicTag(itemId: number, tagId: number): Promise<RawTagOpResponse> {
    return this.http
      .delete(`${itemId}/public-tag`, { json: { tag_id: tagId }, throwHttpErrors: false })
      .json<RawTagOpResponse>();
  }

  /** `Managing.UpdateInventory` — re-count the Steam inventory behind the listing. */
  async updateInventoryValue(
    itemId: number,
    params: { all?: boolean; appId?: number } = {},
  ): Promise<RawStatusResponse> {
    const json: Record<string, unknown> = {};
    if (params.all !== undefined) json.all = params.all;
    if (params.appId !== undefined) json.app_id = params.appId;
    return this.http
      .post(`${itemId}/update-inventory`, { json, throwHttpErrors: false })
      .json<RawStatusResponse>();
  }

  /** `Managing.AiPrice` — the market's own suggestion for the item, in the user's currency. */
  async getAiPrice(itemId: number, signal?: AbortSignal): Promise<RawAiPriceResponse> {
    return this.http
      .get(`${itemId}/ai-price`, { signal, throwHttpErrors: false })
      .json<RawAiPriceResponse>();
  }

  /** `Market.UserTags.Get` — the user's own tag palette. */
  async getUserTags(): Promise<RawUserTagsResponse> {
    return this.http.get('user/tags', { throwHttpErrors: false }).json<RawUserTagsResponse>();
  }

  /** `Market.UserTags.Create` — create a new tag (title ≤16 chars, bc colour). */
  async createUserTag(title: string, bc: string): Promise<RawUserTagResponse> {
    return this.http
      .post('user/tags', { json: { title, bc }, throwHttpErrors: false })
      .json<RawUserTagResponse>();
  }

  /** `Market.UserTags.Update` — edit a custom tag (tag_id ≥ 4). */
  async updateUserTag(tagId: number, title: string, bc: string): Promise<RawUserTagResponse> {
    return this.http
      .put('user/tags', { json: { tag_id: tagId, title, bc }, throwHttpErrors: false })
      .json<RawUserTagResponse>();
  }

  /** `Market.UserTags.Delete` — delete a custom tag (also detaches it everywhere). */
  async deleteUserTag(tagId: number): Promise<RawStatusResponse> {
    return this.http
      .delete('user/tags', { json: { tag_id: tagId }, throwHttpErrors: false })
      .json<RawStatusResponse>();
  }

  /** `Market.UserTags.Order` — set the tag order. */
  async reorderUserTags(tagOrder: number[]): Promise<RawStatusResponse> {
    return this.http
      .post('user/tags/order', { json: { tag_order: tagOrder }, throwHttpErrors: false })
      .json<RawStatusResponse>();
  }

  /** Current authenticated user (market API — no avatar URL, only `avatar_date`). */
  async me(): Promise<RawProfileResponse> {
    return this.http.get('me').json<RawProfileResponse>();
  }

  /** Current authenticated user from the forum API (`/users/me`). */
  async meForum(): Promise<RawProfileResponse> {
    return this.http
      .get('users/me', { prefixUrl: LOLZ_CONFIG.forumApiUrl })
      .json<RawProfileResponse>();
  }
}
