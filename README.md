# dsh-per-request-cost

中文 | [English](README.en.md)

一个 [DeepSeek Harness](https://github.com/deepseek-ai) 的 Web 界面插件，在输入框下方显示一枚紧凑的胶囊：

```
¥12.34 · 谷时 · 本次 ¥0.0123
```

它同时显示账户余额（充值 + 赠送）、当前是高峰还是空闲时段，以及**当前会话已经花掉多少钱**。

![输入框下方的胶囊，截图中余额已打码](assets/composer-pill.png)

> **单会话真实计价**：每一条模型请求都按「该请求发出那一刻」的峰谷单价计价，而不是把整段会话的 token 总量乘以某一个时段单价。因此会话跨过 12:00、18:00、周末或法定节假日，总计依然准确。

## 功能

| 显示 | 数据来源 | 刷新方式 |
|---|---|---|
| 余额（充值 + 赠送） | `account.getBalance` → 平台 `get_user_summary` | 挂载时、每 N 秒（默认 60，可配置）、每轮结束、点击手动 |
| 峰谷时段 | 本地时钟（北京时间） | 每 30 秒，无网络请求 |
| 本次消耗 | `sessionCost` Host 投影（逐请求真实计价）；无投影时回退到 `tokenUsage` 估算 | 每条请求结算后实时更新 |

- 充值余额与赠送余额按币种分别合并（优先 CNY）——平台扣费本来就是两者合计、且优先扣赠金；鼠标悬停可看到两者的拆分。
- 峰谷规则与官方一致：北京时间周一至周五 9:00–12:00、14:00–18:00 为高峰；午休、周末、法定节假日全天为空闲。
- 节假日数据不写死在某一年：每年只拉取当前年份一次，来源是 [holiday-cn](https://github.com/NateScarlet/holiday-cn)（依据国务院公告生成）；离线或当年公告尚未发布时使用内置的 2026 列表。
- 单条请求的计价公式为 `命中 × 命中价 + (未命中 + 缓存写) × 未命中价 + 输出 × 输出价`（元/百万 token），单价取该请求 step 开始时刻的时段：

| deepseek-flash | 空闲时段 | 高峰时段 |
|---|---|---|
| 输入，缓存命中 | ¥0.02 | ¥0.04 |
| 输入，缓存未命中 | ¥1 | ¥2 |
| 输出 | ¥4 | ¥8 |

### Search / Fetch 费用

只有 **DeepSeek 自己的搜索接口**按次数计费（¥5 / 1,000 次）。`dsh-free-search` 这类插件会把搜索路由到 Tavily、Bing、Exa、DuckDuckGo 等第三方引擎，这些引擎免费或走各自的额度，**不应计入 DeepSeek 账单**。插件以“DeepSeek 是否真的服务了这条请求”为唯一口径，判断不出来时一律不计费（宁少勿多）：

- 结果头部写明引擎时按引擎名判断：`Search (deepseek-tools):`、`Search (deepseek-official):`、`Search (deepseek-search-api):` 计入 Search；`Search (tavily):`、`Search (bing):`、`Search (exa):` 等第三方引擎显示为“未走 DeepSeek 的搜索”，金额始终为 0；
- 没有引擎头部的 `web_search`（DSH 核心工具）读取 `@deepseek-ai/dsh-web` 当前选中的搜索 provider：`deepseek-official` / `deepseek-search-api` 才计入 Search，`ddg` 等免费 provider（例如 `dsh-free-search`）不计费；
- `web_fetch` 同理看抓取 provider，只有 `deepseek-fetch-api` 才计入 Fetch；`http`、`fs-quality-fetch` 等本地或免费抓取不计费；
- `advanced_search` 按查询的引擎头判断，计 1 次请求；`multi_search` 混合多个引擎、无法拆分，因此不计费。

其余口径：

- 一次 `web_search` 按去重后的 query 数计费（与工具自身的并发 fan-out 规则一致）；
- 一次 `web_fetch` 在页面返回 2xx **且由 DeepSeek 抓取接口完成**时计 1 次；
- 报错结果、`No results found.`、非 2xx 的抓取都不计费；
- 请求会实时计数，但在**北京时间 2026-11-01 00:00 之前不计入金额**（DeepSeek 公告的 Harness 调用免费期）。悬停提示会显示已发生的 Search/Fetch 次数并标注“免费”；过了这个时刻，同样的次数按每次 ¥0.005 计入。

## 真实计价是怎么做的

Host 半边把持久会话日志折叠成一个对客户端可见的投影 `sessionCost`：

- `step/start` 记录该 step 开始的毫秒时间戳，这个时刻就是本次请求的计费时间；
- `assistant/message` 带 Provider 返回的最终 usage；`assistant/attempt` 带被取消/重建的流里最后一个 usage。同一 turn+step 的后续样本会替换前一个，`llm/retry-started` 结束替换窗口，让重试的那次单独计费；
- `request/header` 提供 model，用于选择 `deepseek-flash` 或 `deepseek-v4-pro` 价目表；未知模型按 flash 计；
- 折叠在 Host 上执行，因此翻页和上下文压缩都不会丢掉已计价的记录。

如果该投影不可用（旧版 Host，或 profile 未挂载 `sessionProjections`），前端退回旧算法：整段会话的 `tokenUsage` 按当前时段统一估价，并在悬停提示里标明“估算”。

## 按年份变化的节假日

周末是按星期计算的，任何年份都成立。法定节假日每年公布，插件不假装知道所有年份：

- 当前北京时间年份**只拉取一次**，按顺序尝试直到某个源返回非空且年份一致的安排：
  1. GitHub raw（`raw.githubusercontent.com/NateScarlet/holiday-cn`，权威数据源）；
  2. jsDelivr 的 GitHub 镜像；
  3. **timor.tech** —— 国内可访问的节假日 API，GitHub 与 jsDelivr 都被墙时使用（返回结构会归一化为日期）；
  4. ghproxy.net 作为最后的 GitHub 代理。

  Host 在启动与每日检查时尝试，浏览器在页面加载时尝试；已加载过的年份不再重复请求。
- 跨年后会自动拉取新的一年；公告发布前数据源为空，插件保持“未知”并重试，不会当成“全年无假日”。
- 返回内容年份不一致、或数据源没有可用日期时，自动落到下一个渠道。
- 所有渠道都失败（离线或被墙）时保留内置的 2026 列表；2027-01-01 是内置列表中唯一确定的跨年日期。
- 目前 2027 的官方安排尚未发布（数据为空），所以 2027 年的工作日暂按高峰计，周末仍为空闲。

数据集只包含日期与节日名称，不携带任何账号信息。

## 多智能体会话

会话把任务分给子智能体时，子智能体的模型调用发生在**子会话**里，各自有独立日志和独立的 `sessionCost` 投影。父会话的胶囊会把直接子会话的费用加进来：

- 父会话的 `subagentCatalog` 投影列出每个子会话；
- 浏览器向会话控制器请求每个子会话的投影（`sessions.refreshProjections`），把它们的 `sessionCost` 汇总；
- 悬停提示会显示 `含 N 个子会话 ¥x`；投影尚未返回的子会话会单独标注为“未加载”，而不是悄悄按 0 计。

只汇总当前会话的**直接子会话**；更深层的子会话、或另一个工作区里的智能体不计入。

## 设置

打开 **插件 → dsh-per-request-cost**，在 **Refresh rate（刷新频率）** 中修改余额刷新间隔（10–3600 秒，默认 60），点击保存后立即生效，胶囊会马上按新间隔刷新。该值保存在当前浏览器本地，不写入 `cordis.patch.yml`，也不需要重启。

每轮对话结束时仍会额外刷新一次余额，这是间隔之外的补充，不受该设置影响。

## 安装

需要 DeepSeek Harness 0.2.x，并已登录 DeepSeek 账号（余额来自账号会话，不是 API Key）。

**方式一 — 插件管理页**（Harness ≥ 0.2.1）：打开 **插件**，选择从目录安装，指向本包目录即可，bundle 的 patch 会自动注册插件行。

**方式二 — 手动 link 到 profile**：

```bash
cd "$DSH_PROFILE_DIR"          # 例如 ~/.dsh/profiles/desktop
pnpm add link:/absolute/path/to/dsh-per-request-cost
```

**方式三 — 直接从 GitHub 安装**（推荐）：`pnpm add github:Shad0wwa1ker/dsh-per-request-cost`，然后把 `dsh-per-request-cost` 加进 profile 的 `dsh.profile.bundles`。

然后把 bundle 加入该 profile 的 `package.json`：

```json
"dsh": { "profile": { "bundles": ["dsh-per-request-cost"] } }
```

刷新页面（或重启 Harness）一次，让浏览器加载新的客户端模块。Host 投影属于 Host 代码，需要**下次启动 Harness** 才生效；页面只需刷新。

## 配置

刷新间隔在插件详情页修改（见「设置」）。价格表和内置节假日列表分别位于 `index.js`（计价与 Host 节假日）和 `client.js`（回退估算与时段显示）顶部，DeepSeek 调价时改那里即可。插件不保存任何凭据，除 UI 本来就有的余额查询和公开节假日数据集外不发任何请求。

## 精度说明

- **每条请求按自己的时段计价。** 12:00 前开始的请求即使回答落在 12:00 后，仍按高峰计价；计费时间取 step 开始时刻，这是最接近请求发出时间的持久化事件。
- **节假日以已公布安排为准。** 国务院公告未发布前，工作日的节假日会按高峰计价；需要别的日历可改 `FALLBACK_HOLIDAYS` 或替换数据源地址。
- **模型档位来自 request header。** `deepseek-v4-pro` 使用 Pro 价目表，其余按 flash 计；自定义模型若计费不同会算偏。
- **余额是快照。** 反映的是最近一次刷新的平台余额，最多滞后一个刷新间隔。
- **Search / Fetch 自 2026-11-01 00:00（北京时间）起计费。** 只统计 DeepSeek 自己服务的请求：有引擎头时看引擎名，没有时看 `@deepseek-ai/dsh-web` 选中的 provider（`selectSearchProvider` / `selectFetchProvider`）。第三方引擎（Tavily/Bing/Exa 等）和免费 provider（`ddg`、`http` 等）不计费，悬停提示里单独显示次数。次数按成功请求统计：Search 看去重后的 query 数，Fetch 看 2xx 页面；报错或空结果不计费。多 query 调用中只有部分 query 有结果时，会按 query 总数计，可能略微多算；`multi_search` 混合多引擎无法拆分，不计费。切换 provider 后新请求立即按新 provider 判断，已计入的次数不会重算。
- **子智能体费用只汇总直接子会话，且要等投影加载完成。** 仍在加载的子会话会在提示里标为“未加载”；更深层的子会话不在汇总范围内。
- **非 DeepSeek 路由**（例如 Anthropic 兼容 provider）会按 DeepSeek 单价计算；本插件面向 DeepSeek 账号。

## 实现结构

- `index.js` — Host 半边：向 `ctx.sessionProjections` 注册 `sessionCost` 投影，折叠逻辑、价目表、节假日列表都在这里；注册是可选的，没有投影注册表的 profile 也能正常加载。
- `client.js` — 通过 `window.__ModuleLoader__` 注册的浏览器模块：注册输入框胶囊和 bundle 配置页，并通过 `useSession` / `useProjection` 标准 props 读取会话状态与两个投影。
- `cordis.patch.yml` — 插入 `per-request-cost` 插件行。
- `locale/*.json` — 插件管理页展示用的标题与描述（中/英）。

## 隐私

仓库中不含 token、cookie、账号标识、余额或本机路径。余额通过 Harness 已登录的账号会话读取；插件本身不持久化任何账号数据。

## 许可证

MIT