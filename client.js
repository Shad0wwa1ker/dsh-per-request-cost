window.__ModuleLoader__.load({
  id: 'dsh-per-request-cost',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'per-request-cost';

    /** DeepSeek bills Beijing time: peak = Mon–Fri 09:00–12:00 and 14:00–18:00. */
    const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
    const PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]];

    /**
     * Built-in official holiday dates, used offline and before a new year's
     * arrangement is published. The browser refreshes unlisted years from the
     * same public dataset the Host uses.
     */
    const FALLBACK_HOLIDAYS = [
      '2026-01-01', '2026-01-02', '2026-01-03',
      '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
      '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
      '2026-04-04', '2026-04-05', '2026-04-06',
      '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
      '2026-06-19', '2026-06-20', '2026-06-21',
      '2026-09-25', '2026-09-26', '2026-09-27',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
      '2026-10-06', '2026-10-07',
      '2027-01-01',
    ];

    const holidayDays = new Set(FALLBACK_HOLIDAYS);
    const knownYears = new Set([2026]);
    const holidayListeners = new Set();
    const HOLIDAY_TIMEOUT_MS = 6000;

    function parseHolidayCn(payload, year) {
      if (payload === null || typeof payload !== 'object' || payload.year !== year) return [];
      const days = Array.isArray(payload.days) ? payload.days : [];
      return days
        .filter((day) => day !== null && typeof day === 'object' && day.isOffDay === true
          && typeof day.date === 'string' && day.date.startsWith(`${year}-`))
        .map((day) => day.date);
    }

    function parseTimor(payload, year) {
      if (payload === null || typeof payload !== 'object' || payload.code !== 0
        || payload.holiday === null || typeof payload.holiday !== 'object') return [];
      return Object.values(payload.holiday)
        .filter((day) => day !== null && typeof day === 'object' && day.holiday === true
          && typeof day.date === 'string' && day.date.startsWith(`${year}-`))
        .map((day) => day.date);
    }

    /** GitHub first, then a global CDN, a mainland API, and a GitHub proxy. */
    const holidayChannels = [
      {
        id: 'github',
        url: (year) => `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${String(year)}.json`,
        parse: parseHolidayCn,
      },
      {
        id: 'jsdelivr',
        url: (year) => `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${String(year)}.json`,
        parse: parseHolidayCn,
      },
      {
        id: 'timor',
        url: (year) => `https://timor.tech/api/holiday/year/${String(year)}`,
        parse: parseTimor,
      },
      {
        id: 'ghproxy',
        url: (year) => `https://ghproxy.net/https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${String(year)}.json`,
        parse: parseHolidayCn,
      },
    ];

    async function fetchHoliday(url) {
      if (typeof AbortController !== 'function') return fetch(url);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HOLIDAY_TIMEOUT_MS);
      try {
        return await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    }

    function publishHolidayDays(dates) {
      let changed = false;
      for (const date of dates) {
        if (!holidayDays.has(date)) {
          holidayDays.add(date);
          changed = true;
        }
      }
      if (changed) for (const listener of holidayListeners) listener();
    }

    /** Load only the current Beijing year, once, from the first channel that answers. */
    let holidayPending = false;
    async function refreshHolidayDays(now) {
      if (holidayPending || typeof fetch !== 'function') return;
      const year = bjDate(now).getUTCFullYear();
      if (knownYears.has(year)) return;
      holidayPending = true;
      try {
        for (const channel of holidayChannels) {
          try {
            const response = await fetchHoliday(channel.url(year));
            if (!response.ok) continue;
            const offDays = channel.parse(await response.json(), year);
            if (offDays.length === 0) continue;
            knownYears.add(year);
            publishHolidayDays(offDays);
            return;
          } catch {
            // Unreachable or blocked: try the next channel.
          }
        }
      } finally {
        holidayPending = false;
      }
    }

    /** Re-render the pill whenever a newer holiday list lands. */
    function useHolidayDays() {
      const [, bump] = React.useState(0);
      React.useEffect(() => {
        const listener = () => bump((value) => value + 1);
        holidayListeners.add(listener);
        return () => holidayListeners.delete(listener);
      }, []);
      return holidayDays;
    }

    /* ── balance refresh interval, edited on the plugin's details page ───── */

    const REFRESH_STORAGE_KEY = 'dsh-per-request-cost.refreshSeconds';
    const REFRESH_DEFAULT = 60;
    const REFRESH_MIN = 10;
    const REFRESH_MAX = 3600;

    /** Keep the interval inside the supported range; unusable input falls back. */
    function clampRefresh(value) {
      const seconds = Math.round(Number(value));
      if (!Number.isFinite(seconds)) return REFRESH_DEFAULT;
      return Math.min(REFRESH_MAX, Math.max(REFRESH_MIN, seconds));
    }

    function readStoredRefresh() {
      try {
        const raw = globalThis.localStorage?.getItem(REFRESH_STORAGE_KEY);
        return raw === null || raw === undefined ? REFRESH_DEFAULT : clampRefresh(raw);
      } catch {
        return REFRESH_DEFAULT;
      }
    }

    let refreshSeconds = readStoredRefresh();
    const refreshListeners = new Set();

    function setRefreshSeconds(value) {
      const next = clampRefresh(value);
      refreshSeconds = next;
      try {
        globalThis.localStorage?.setItem(REFRESH_STORAGE_KEY, String(next));
      } catch {
        // Private mode or a blocked store: the value still applies this session.
      }
      for (const listener of refreshListeners) listener(next);
    }

    /** Subscribe a component to interval changes made on the plugin page. */
    function useRefreshSeconds() {
      const [seconds, setSeconds] = React.useState(refreshSeconds);
      React.useEffect(() => {
        const listener = (value) => setSeconds(value);
        refreshListeners.add(listener);
        return () => refreshListeners.delete(listener);
      }, []);
      return seconds;
    }

    /**
     * List prices in CNY per million tokens, indexed [off-peak, peak]. Cache
     * writes have no separate DeepSeek price, so they price as cache misses.
     */
    const PRICING = {
      flash: { hit: [0.02, 0.04], miss: [1, 2], output: [4, 8] },
      pro: { hit: [0.15, 0.3], miss: [4.5, 9], output: [13.5, 27] },
    };

    /** Search/Fetch bill per successful request from Beijing 2026-11-01 00:00. */
    const SERVICE_PRICE = 5 / 1000;
    const SERVICE_BILLING_START = Date.parse('2026-10-31T16:00:00Z');

    /** Exact total: token cost plus the Search/Fetch part once billing starts. */
    function totalCostOf(exact) {
      if (exact === undefined || exact === null || !Number.isFinite(exact.cost)) return undefined;
      return exact.cost + (Number.isFinite(exact.serviceCost) ? exact.serviceCost : 0);
    }

    /**
     * Sum the `sessionCost` projections of a session's direct subagent children.
     * A child whose projection has not loaded yet is reported as pending rather
     * than counted as zero.
     *
     * @param catalog - the parent's `subagentCatalog` value.
     * @param snapshots - the client's `projectionsBySession` map.
     */
    function childCostSummary(catalog, snapshots) {
      let amount = 0;
      let counted = 0;
      let pending = 0;
      if (!Array.isArray(catalog)) return { amount, counted, pending };
      for (const entry of catalog) {
        if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') continue;
        const value = snapshots?.[entry.id]?.values?.sessionCost;
        const total = totalCostOf(value);
        if (total === undefined) {
          pending += 1;
        } else {
          amount += total;
          counted += 1;
        }
      }
      return { amount, counted, pending };
    }

    const DICTIONARIES = {
      zh: {
        'phase.peak': '峰时',
        'phase.offPeak': '谷时',
        'balance.amount': '{amount}',
        'balance.unknown': '余额 --',
        'title.peak': '高峰时段（北京时间 9:00–12:00、14:00–18:00）· 下次转入空闲：{next}',
        'title.offPeak': '空闲时段，价格为高峰的 5 折 · 下次转入高峰：{next}',
        'title.unknown': '余额读取失败，点击重试',
        'title.refresh': '点击刷新余额',
        'title.grantedDetail': '充值 {topped} ＋ 赠送 {granted}',
        'cost.inline': '本次 {amount}',
        'cost.title': '本会话估算：命中 {hit} tok／未命中 {miss} tok／输出 {out} tok，按 deepseek-flash {phase}价。跨峰谷的历史请求按当前时段统一计价。',
        'cost.exact.title': '本会话逐请求计价：命中 {hit} tok／未命中 {miss} tok／输出 {out} tok，每条请求按其发生时的峰谷价计。',
        'cost.services.search': 'DeepSeek Search {search} 次',
        'cost.services.fetch': 'DeepSeek Fetch {fetch} 次',
        'cost.services.billed': '{parts}，另计 {amount}',
        'cost.services.free': '{parts}，11 月 1 日前免费',
        'cost.services.thirdParty': '另有 {free} 次未走 DeepSeek 的搜索，不计费',
        'cost.children': '含 {count} 个子会话 {amount}',
        'cost.children.pending': '另有 {count} 个子会话尚未加载',
        'settings.title': '刷新频率',
        'settings.label': '余额刷新间隔（秒）',
        'settings.hint': '范围 10–3600 秒，默认 60。每轮对话结束仍会额外刷新一次，这是上限之外的补充。',
        'settings.save': '保存',
        'settings.saved': '已保存',
        'settings.invalid': '请输入 10–3600 之间的整数',
        'settings.summary': '余额每 {seconds} 秒刷新一次',
      },
      en: {
        'phase.peak': 'Peak',
        'phase.offPeak': 'Off-peak',
        'balance.amount': '{amount}',
        'balance.unknown': '--',
        'title.peak': 'Peak hours (09:00–12:00, 14:00–18:00 Beijing time) · off-peak at {next}',
        'title.offPeak': 'Off-peak, half the peak price · peak starts {next}',
        'title.unknown': 'Balance unavailable, click to retry',
        'title.refresh': 'Click to refresh the balance',
        'title.grantedDetail': 'Topped up {topped} + granted {granted}',
        'cost.inline': 'Session {amount}',
        'cost.title': 'Session estimate: {hit} hit / {miss} miss / {out} output tokens at deepseek-flash {phase} rates. Requests spanning both windows are priced uniformly at the current one.',
        'cost.exact.title': 'Session priced per request: {hit} hit / {miss} miss / {out} output tokens, each at the phase in effect when it was sent.',
        'cost.services.search': 'DeepSeek Search {search}',
        'cost.services.fetch': 'DeepSeek Fetch {fetch}',
        'cost.services.billed': '{parts}, {amount} extra',
        'cost.services.free': '{parts}, free until Nov 1',
        'cost.services.thirdParty': '{free} more searches not served by DeepSeek, not billed',
        'cost.children': 'Includes {count} subagent sessions: {amount}',
        'cost.children.pending': '{count} more subagent sessions not loaded yet',
        'settings.title': 'Refresh rate',
        'settings.label': 'Balance refresh interval (seconds)',
        'settings.hint': '10–3600 seconds, default 60. Each finished turn still triggers one extra refresh on top of it.',
        'settings.save': 'Save',
        'settings.saved': 'Saved',
        'settings.invalid': 'Enter a whole number between 10 and 3600.',
        'settings.summary': 'Balance refreshes every {seconds} seconds',
      },
    };

    const bjDate = (ms) => new Date(ms + BEIJING_OFFSET_MS);
    const bjDay = (ms) => bjDate(ms).toISOString().slice(0, 10);

    /** @param ms - epoch milliseconds @param days - off-day set @returns whether Beijing wall time is peak. */
    function isPeak(ms, days = holidayDays) {
      const d = bjDate(ms);
      const weekday = d.getUTCDay();
      if (weekday === 0 || weekday === 6) return false;
      if (days.has(bjDay(ms))) return false;
      const minute = d.getUTCHours() * 60 + d.getUTCMinutes();
      for (const [from, to] of PEAK_WINDOWS) {
        if (minute >= from && minute < to) return true;
      }
      return false;
    }

    /** The next epoch millisecond at which the peak flag flips, or null within eight days. */
    function nextSwitch(ms, days = holidayDays) {
      const current = isPeak(ms, days);
      for (let step = 1; step <= 8 * 24 * 60; step += 1) {
        const at = ms + step * 60 * 1000;
        if (isPeak(at, days) !== current) return at;
      }
      return null;
    }

    function formatBeijingTime(ms) {
      const d = bjDate(ms);
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    }

    /** Format one amount in the wallet currency; tiny non-zero amounts keep four decimals. */
    function formatAmount(amount, currency) {
      const symbol = currency === 'USD' ? '$' : '¥';
      const value = Number(amount);
      if (!Number.isFinite(value)) return `${symbol}${amount}`;
      const fixed = Math.abs(value) >= 0.01 || value === 0 ? value.toFixed(2) : value.toFixed(4);
      return `${symbol}${fixed}`;
    }

    /**
     * Combine recharge and granted wallets per currency, keeping the two parts
     * visible for the tooltip. Platform reports both lists separately and bills
     * them together, so the readable total is their sum.
     */
    function sumWallets(normalWallets, bonusWallets) {
      const totals = new Map();
      const add = (wallets, part) => {
        for (const wallet of Array.isArray(wallets) ? wallets : []) {
          if (!wallet || typeof wallet.currency !== 'string') continue;
          const entry = totals.get(wallet.currency)
            ?? { currency: wallet.currency, toppedUp: 0, granted: 0 };
          const value = Number(wallet.balance);
          if (Number.isFinite(value)) entry[part] += value;
          totals.set(wallet.currency, entry);
        }
      };
      add(normalWallets, 'toppedUp');
      add(bonusWallets, 'granted');
      const entries = [...totals.values()].map((entry) => ({
        ...entry,
        total: entry.toppedUp + entry.granted,
      }));
      entries.sort((a, b) => (a.currency === 'CNY' ? -1 : b.currency === 'CNY' ? 1 : 0));
      return entries[0];
    }

    /**
     * Price one session's provider-reported usage, in CNY. `tier` selects the
     * model price list; flash is the profile default.
     */
    function estimateCost(usage, peak, tier = 'flash') {
      const rates = PRICING[tier] ?? PRICING.flash;
      const at = peak ? 1 : 0;
      const hit = usage.cacheReadTokens || 0;
      const miss = (usage.uncachedInputTokens || 0) + (usage.cacheWriteTokens || 0);
      const out = usage.outputTokens || 0;
      return (hit * rates.hit[at] + miss * rates.miss[at] + out * rates.output[at]) / 1e6;
    }

    /** Format a cost reading; amounts under one yuan keep four decimals. */
    function formatCost(amount) {
      if (!Number.isFinite(amount)) return '¥--';
      if (amount === 0) return '¥0.00';
      return amount >= 1 ? `¥${amount.toFixed(2)}` : `¥${amount.toFixed(4)}`;
    }

    function formatTokens(count) {
      return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /** Read-only identity of the requesting UI, as every account call expects. */
    function clientMetadata(ctx) {
      const boot = globalThis.__DSH_BOOT__;
      const version = boot && boot.release && typeof boot.release.version === 'string'
        ? boot.release.version
        : '';
      return {
        version: version || '0.0.0',
        locale: ctx.locale.getSnapshot().active,
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      };
    }

    function createPill(ctx) {
      /** Composer pill: account balance and the current billing phase. */
      return function BalancePill({ useSession, useProjection, useSessions }) {
        const t = ctx.locale.bind(NS);
        const [reading, setReading] = React.useState({ status: 'loading', wallet: undefined });
        const [now, setNow] = React.useState(() => Date.now());
        const [busy, setBusy] = React.useState(false);
        const alive = React.useRef(true);
        const settle = React.useRef(false);
        const useRunning = typeof useSession === 'function' ? useSession : (() => undefined);
        const running = useRunning((snapshot) => (snapshot ? snapshot.running : undefined));
        const project = typeof useProjection === 'function' ? useProjection : (() => undefined);
        const useSessionsSafe = typeof useSessions === 'function' ? useSessions : (() => undefined);
        const childSnapshots = useSessionsSafe((state) => (state ? state.projectionsBySession : undefined));
        const catalog = project('subagentCatalog');
        const childRefresh = React.useRef(new Set());
        const days = useHolidayDays();
        const refreshEvery = useRefreshSeconds();
        const usage = project('tokenUsage');

        React.useEffect(() => {
          const service = ctx.sessions;
          if (!service || typeof service.refreshProjections !== 'function' || !Array.isArray(catalog)) return;
          for (const entry of catalog) {
            if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') continue;
            if (childSnapshots?.[entry.id]?.values?.sessionCost !== undefined) continue;
            if (childRefresh.current.has(entry.id)) continue;
            childRefresh.current.add(entry.id);
            Promise.resolve(service.refreshProjections(entry.id)).catch(() => {});
          }
        }, [catalog, childSnapshots]);

        React.useEffect(() => () => {
          alive.current = false;
        }, []);

        const load = React.useCallback(async () => {
          setBusy(true);
          try {
            const result = await ctx.remote.account.getBalance(clientMetadata(ctx));
            if (!alive.current) return;
            if (!result || !result.ok) {
              setReading({ status: 'unavailable', wallet: undefined });
              return;
            }
            const outcome = result.value;
            if (!outcome || outcome.status !== 'ready') {
              setReading({ status: 'absent', wallet: undefined });
              return;
            }
            setReading({ status: 'ready', wallet: sumWallets(outcome.value, outcome.bonusWallets) });
          } catch {
            if (alive.current) setReading({ status: 'unavailable', wallet: undefined });
          } finally {
            if (alive.current) setBusy(false);
          }
        }, []);

        React.useEffect(() => {
          void load();
          const balanceTimer = setInterval(() => void load(), refreshEvery * 1000);
          const clockTimer = setInterval(() => setNow(Date.now()), 30 * 1000);
          return () => {
            clearInterval(balanceTimer);
            clearInterval(clockTimer);
          };
        }, [load, refreshEvery]);

        /** Follow a New Year while the page stays open: load the new year once. */
        React.useEffect(() => {
          void refreshHolidayDays(now);
        }, [now]);

        /** Refresh once when a running turn settles, so the charge shows up promptly. */
        React.useEffect(() => {
          if (running === true) {
            settle.current = true;
            return;
          }
          if (running === false && settle.current) {
            settle.current = false;
            void load();
          }
        }, [running, load]);

        const peak = isPeak(now, days);
        const phase = t(peak ? 'phase.peak' : 'phase.offPeak');
        const boundary = nextSwitch(now, days);
        const until = boundary === null ? '--' : formatBeijingTime(boundary);
        const amount = reading.wallet ? formatAmount(reading.wallet.total, reading.wallet.currency) : undefined;
        const exact = project('sessionCost');
        const exactTotal = totalCostOf(exact);
        const children = childCostSummary(catalog, childSnapshots);
        const combined = exactTotal === undefined ? undefined : exactTotal + children.amount;
        const cost = combined !== undefined
          ? combined
          : usage ? estimateCost(usage, peak) : undefined;
        const costText = cost === undefined ? null : t('cost.inline', { amount: formatCost(cost) });
        const label = [
          amount === undefined ? null : t('balance.amount', { amount }),
          phase,
          costText,
        ].filter(Boolean).join(' · ');
        const detail = reading.wallet && reading.wallet.granted > 0
          ? t('title.grantedDetail', {
            topped: formatAmount(reading.wallet.toppedUp, reading.wallet.currency),
            granted: formatAmount(reading.wallet.granted, reading.wallet.currency),
          })
          : null;
        const costTokens = exactTotal !== undefined ? exact : usage;
        const costDetail = costTokens === undefined ? null : exactTotal !== undefined
          ? t('cost.exact.title', {
            hit: formatTokens(costTokens.cacheReadTokens || 0),
            miss: formatTokens((costTokens.inputTokens || 0) + (costTokens.cacheWriteTokens || 0)),
            out: formatTokens(costTokens.outputTokens || 0),
          })
          : t('cost.title', {
            hit: formatTokens(usage.cacheReadTokens || 0),
            miss: formatTokens((usage.uncachedInputTokens || 0) + (usage.cacheWriteTokens || 0)),
            out: formatTokens(usage.outputTokens || 0),
            phase,
          });
        const serviceParts = [];
        if (exact && (exact.searchRequests || 0) > 0) {
          serviceParts.push(t('cost.services.search', { search: formatTokens(exact.searchRequests) }));
        }
        if (exact && (exact.fetchRequests || 0) > 0) {
          serviceParts.push(t('cost.services.fetch', { fetch: formatTokens(exact.fetchRequests) }));
        }
        const serviceDetail = serviceParts.length === 0
          ? null
          : t(exact.serviceCost > 0 ? 'cost.services.billed' : 'cost.services.free', {
            parts: serviceParts.join(' · '),
            amount: formatCost(exact.serviceCost || 0),
          });
        const freeSearches = exact ? (exact.searchFree || 0) : 0;
        const freeDetail = freeSearches === 0
          ? null
          : t('cost.services.thirdParty', { free: formatTokens(freeSearches) });
        const childDetail = children.counted === 0
          ? null
          : t('cost.children', { count: children.counted, amount: formatCost(children.amount) });
        const childPending = children.pending === 0
          ? null
          : t('cost.children.pending', { count: children.pending });
        const title = [
          reading.status === 'unavailable'
            ? t('title.unknown')
            : t(peak ? 'title.peak' : 'title.offPeak', { next: until }),
          detail,
          costDetail,
          serviceDetail,
          freeDetail,
          childDetail,
          childPending,
          t('title.refresh'),
        ].filter(Boolean).join(' · ');

        return h('button', {
          type: 'button',
          'data-per-request-cost': true,
          title,
          'aria-label': label,
          'aria-busy': busy,
          onClick: () => void load(),
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            height: 18,
            padding: '0 6px',
            border: 0,
            borderRadius: 999,
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            fontSize: 11,
            lineHeight: '18px',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            opacity: busy ? 0.55 : 0.75,
          },
        }, label);
      };
    }

    function createSettingsView() {
      /** Plugins → dsh-per-request-cost page: edit the balance refresh interval. */
      return function BalancePillSettings({ t, view }) {
        const seconds = useRefreshSeconds();
        const [draft, setDraft] = React.useState(String(seconds));
        const [state, setState] = React.useState('idle');

        React.useEffect(() => {
          setDraft(String(seconds));
        }, [seconds]);

        if (view === 'summary') return t('settings.summary', { seconds });

        const submit = (event) => {
          event.preventDefault();
          const parsed = Number(draft);
          if (!Number.isFinite(parsed) || parsed < REFRESH_MIN || parsed > REFRESH_MAX) {
            setState('invalid');
            return;
          }
          setRefreshSeconds(parsed);
          setState('saved');
        };

        return h('form', {
          onSubmit: submit,
          style: { display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420, padding: '4px 0' },
        }, [
          h('label', { key: 'label', style: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 } }, [
            h('span', { key: 'text' }, t('settings.label')),
            h('input', {
              key: 'input',
              type: 'number',
              min: REFRESH_MIN,
              max: REFRESH_MAX,
              step: 5,
              value: draft,
              onChange: (event) => {
                setDraft(event.target.value);
                setState('idle');
              },
              style: {
                width: 140,
                height: 30,
                padding: '0 8px',
                borderRadius: 6,
                border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4))',
                background: 'var(--dsw-alias-bg-l1, transparent)',
                color: 'inherit',
                font: 'inherit',
              },
            }),
          ]),
          h('div', { key: 'actions', style: { display: 'flex', alignItems: 'center', gap: 10 } }, [
            h('button', {
              key: 'save',
              type: 'submit',
              style: {
                height: 28,
                padding: '0 14px',
                borderRadius: 6,
                border: 0,
                cursor: 'pointer',
                background: 'var(--dsw-alias-state-business-primary, #4176e6)',
                color: '#fff',
                font: 'inherit',
                fontSize: 13,
              },
            }, t('settings.save')),
            state === 'saved' ? h('span', { key: 'saved', style: { fontSize: 12, opacity: 0.7 } }, t('settings.saved')) : null,
            state === 'invalid' ? h('span', { key: 'invalid', style: { fontSize: 12, color: 'var(--dsw-alias-label-error, #d14343)' } }, t('settings.invalid')) : null,
          ]),
          h('p', { key: 'hint', style: { margin: 0, fontSize: 12, opacity: 0.6 } }, t('settings.hint')),
        ]);
      };
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.account', 'sessions'],
      /** Pure helpers, exported for verification outside the browser. */
      __test: { isPeak, nextSwitch, formatAmount, sumWallets, estimateCost, formatCost, clampRefresh, refreshHolidayDays, totalCostOf, childCostSummary },
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'per-request-cost: dictionaries');
        void refreshHolidayDays(Date.now());
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'per-request-cost',
          order: 2,
          locale: NS,
        }, createPill(ctx)));
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: 'dsh-per-request-cost',
          locale: NS,
        }, createSettingsView()));
      },
    };
  },
});
