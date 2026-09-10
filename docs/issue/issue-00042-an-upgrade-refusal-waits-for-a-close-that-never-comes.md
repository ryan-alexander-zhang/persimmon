---
id: issue-00042-an-upgrade-refusal-waits-for-a-close-that-never-comes
type: issue
status: resolved
blocks: [spec-00011-multi-workspace, spec-00001-docs-whiteboard]
---

# Issue: 五条 upgrade 拒绝用例在等一个 Node 23 永不送达的 close

> 服务端以裸 `socket.destroy()` 拒绝一次握手，测试夹具却只在 `open` / `close`
> 上落定。Node ≤ 23 的 undici 对未完成的握手只发 `error`，于是五条用例各挂满
> 30 秒超时——被拒绝这件事本身是对的，写不下来的是「它被拒绝了」这句断言。

## 1. Problem

- Observed: 首次 CI（run `34438160787`，`ubuntu-latest`，`node-version: '23'`）
  九红中的五条，全部以 30 秒超时收场：
  - `test/boardSeams.test.ts > a board attached to somebody else's http server >
    destroys an upgrade of any other kind` — 30006ms
  - `test/boardSeams.test.ts > closing a board without shutting it down >
    refuses the upgrades shutdown leaves open` — 30002ms
  - `test/host.test.ts > websocket upgrades > destroys an upgrade when a hand
    edit made the registry ill-formed` — 30011ms
  - `test/host.test.ts > websocket upgrades > destroys an upgrade on any other
    path` — 30022ms
  - `test/server.test.ts > the docs-change socket > refuses an upgrade on any
    other path` — 30029ms
- Expected: 五条各自断言的是「这次 upgrade 被拒了」——`spec-00011-AC-8.x` 之外
  由 `spec-00011-FR-8` / `FR-16` / `FR-18` 与 `spec-00001-FR-42` 共同兜住的那条
  不变量：一次落不到任何 socket server 上的 upgrade 不留半开连接。断言应在毫秒
  级落定，读作 `opened === false`。
- Trigger: 客户端跑在 Node ≤ 23 上。产品代码在两侧完全一致，触发条件只有测试
  进程的 Node 版本。本机 v26.5.0 五条全绿，`node@23.11.1` 下五条全红。

## 2. Impact

- Affected: 只影响 CI 与任何在 Node 23 上跑测试的开发机。**产品代码不受影响**
  ——浏览器端的 `WebSocket` 按 WHATWG 规范在 `error` 之后必发 `close`
  （规范 "fail the WebSocket connection" 一步同时排入 error 与 close），
  `web/src/eventSocket.ts` / `web/src/terminalSocket.ts` 的重连逻辑挂在 `close`
  上，从来没有等不到过。
- Since: 各夹具写下之时（`eaa6adb` 2026-09-07 建 `test/boardSeams.test.ts`、
  `dad65f3` 2026-09-07 建 `test/host.test.ts`；`test/server.test.ts` 那条更早）
  ——但直到 `93bb290`（2026-09-08）落下 `.github/workflows/ci.yml` 并把
  `node-version` 钉在 `'23'`，才有一台机器在 23 上跑过它们 · Still occurring: yes
- Severity: 高。它不产生错误数据，但它让整条 CI 红着，且每次红要多花 150 秒
  （5 × 30s）才走到红。更要紧的是：`package.json` 的 `engines` 声明
  `">=23.6"`，所以 23 是本包**声明支持的最低 Node**——测试在声明支持的下界跑不过，
  等于这五条不变量在下界上无人守。

## 3. Root Cause (first principles)

1. 分歧：服务端做的是「拆连接」，夹具听的是「收到关闭事件」。这两件事只在
   客户端实现愿意把前者翻译成后者时才等价。
2. 最小机制，两处对上才出错：
   - 服务端以**裸 TCP 拆除**拒绝，而不是以一个 HTTP 应答或一个 close 帧：
     `src/host.ts:356`（路径不匹配或 workspace 不存在）、`src/host.ts:364`
     （注册表不合式，catch 分支）、`src/server.ts:632`（`kind` 命名不到任何
     socket server）。三处都是 `socket.destroy()`，且都是对的——一次 upgrade
     没有可用来答复拒绝的 body（`test/host.test.ts:808` 的注释正是这句）。
   - 夹具只在 `open` / `close` 上落定：`test/boardSeams.test.ts:114-117`、
     `test/host.test.ts:182-185`、`test/server.test.ts:1673-1675`。三处都另挂
     一个 `error` 的**空**监听器（只为吞掉事件），于是 `error` 到达时什么也不
     发生。
3. 真正的根因：**undici 在握手未完成时是否补发 `close`，是一个跨 Node 版本变过
   的实现细节，而夹具把它当成了不变量**。实测：

   ```
   v23.11.1 seen=["error"]
   v26.5.0  seen=["error","close"]
   ```

   （探针：起一个 `server.on('upgrade', (_, socket) => socket.destroy())` 的
   http server，用全局 `WebSocket` 去连，记录 1.5 秒内到达的事件。）
   `error` 是**两个版本都发**的那一个，因此「握手没成」这件事应当读 `error`。

   它**不是**：产品拒绝得不对（三处 `destroy()` 都是规格要求的）；不是 CI 的
   Node pin 选错了（`engines` 说 23 受支持，测试就必须在 23 上过——pin 不动）；
   也不是超时阈值太短（等的那个事件永远不会来，给多久都一样）。

- Introduced by: 夹具写下之时（`eaa6adb`、`dad65f3`，以及 `test/server.test.ts`
  中更早的那条）。在此之前这三个夹具不存在，缺陷不可能发生。它长期不显形，是
  因为在 `93bb290` 落下 CI 之前，唯一跑过它们的机器是 darwin 上的 Node ≥ 24。

## 4. Scope (same-cause sweep)

根因是「等 `close` 来判定一次**未完成的握手**」。凡等的是**已完成连接**之后的
关闭，undici 两个版本都照发，不在范围内。

| Site | Same pattern | Affected | Action |
| --- | --- | --- | --- |
| `test/boardSeams.test.ts:114-117`（`connect` 的 `settled`） | yes | yes | fixed here |
| `test/host.test.ts:182-185`（`connect` 的 `settled`） | yes | yes | fixed here |
| `test/server.test.ts:1673-1675`（`stray` 的等待） | yes | yes | fixed here |
| `test/helpers.ts:176-179`（`closed()`） | no | no | 只用在**已 open** 的 socket 上（`test/boardSeams.test.ts:211`），关闭由服务端主动发出，Node 23 照收 |
| `test/server.test.ts:1336`（`subscribe` 的 `closed`） | no | no | 同上：先 `open` 再等 close |
| `test/server.test.ts:3595`（答疑会话的终端拒绝） | no | no | `spec-00005-AC-7.7`——握手**成功**后才被关，Node 23 实跑通过 |
| `src/host.ts:356`、`:364`、`src/server.ts:632` | 前提 | no | 产品侧，行为正确，不动 |
| `web/src/eventSocket.ts`、`web/src/terminalSocket.ts` | 消费方 | no | 浏览器 `WebSocket` 按规范 `error`+`close` 齐发 |

Node 23 实跑证实了这一划分：`test/server.test.ts` 252 条只红 1 条、
`test/host.test.ts` 61 条只红 2 条、`test/boardSeams.test.ts` 12 条只红 2 条，
其余等 close 的用例全绿。

## 5. Reproduction (test-first)

五条现有用例**就是**复现用例——它们断言的行为没有错，错的是等待条件。本地在
声明支持的最低 Node 上重跑即可复现（无需 docker，npx 能取到 23）：

```sh
npx --yes node@23.11.1 -v          # → v23.11.1，落在 ~/.npm/_npx/<hash>/node_modules/node/bin/node
N23=~/.npm/_npx/<hash>/node_modules/node/bin/node
$N23 ./node_modules/vitest/vitest.mjs run test/boardSeams.test.ts
$N23 ./node_modules/vitest/vitest.mjs run test/host.test.ts
$N23 ./node_modules/vitest/vitest.mjs run test/server.test.ts
```

- Failing test: 上列五条 —— 各以 `Test timed out in 30000ms.` 失败，`connect()`
  的 `settled` 从未落定。
- 修前读数：Node 23 下 `boardSeams 2 failed | 10 passed`、
  `host 2 failed | 59 passed`、`server 1 failed | 251 passed`；
  darwin Node v26.5.0 下三份全绿（12 / 61 / 252）——正是这个版本差把它藏了两天。

## 6. Fix

- Change: 三处夹具在 `error` 上与 `close` 同样落定（各加一行）。
  `error` 是两个版本都发的那一个事件，握手未成即读作「未打开」。
- Why this addresses the root cause and not the symptom: 判据从「实现是否补发
  close」换成「握手是否成功」——后者是被测的那件事本身，与 undici 的版本无关。
- Alternatives rejected:
  - 把 CI 的 `node-version` 抬到 24 —— `package.json` 的 `engines` 是
    `">=23.6"`，抬 pin 等于让下界失守，且不改夹具的话任何人在 23 上跑仍红。
  - 让产品改以 HTTP 应答或 close 帧拒绝 —— 一次 upgrade 没有 body 可答，
    `spec-00011-FR-18` 与 `spec-00001-FR-42` 要的就是拆掉；为迁就测试改产品是
    倒置。
  - 调大超时 —— 等的事件永不到来。

## 7. Verification

- 修后读数，三份测试文件在两个 Node 下全绿：Node 23.11.1 —— `boardSeams 12
  passed`、`host 61 passed`、`server 252 passed`；Node 26.5.0 —— 同样的
  12 / 61 / 252。五条用例各在毫秒级落定，不再有 30 秒挂起。
- `npm run typecheck` 无输出（通过）；`npm test` —— `74 passed (74)` /
  `2293 passed (2293)`。

## 8. Follow-through

- Detection gap: 现有测试没能抓到它，因为**测试自己就是被测方**——夹具的等待
  条件不是任何用例的断言对象。真正的探测缺口是「本仓库在合入 CI 之前从未在
  `engines` 下界上跑过一次测试」。CI 已经补上这个缺口（`node-version: '23'`
  正是它抓到这五条的原因），本 issue 不再另加守卫：多加一条「undici 会发
  error」的用例只会把同一个实现细节钉死在另一处。
- Doc verdict: **code was non-conformant**（此处的 code 是测试代码），docs
  unchanged。`spec-00011-FR-8` / `FR-16` / `FR-18` 与 `spec-00001-FR-42` 描述的
  行为与产品实现一致，无需修订，也无需新增 GWT。
- Residual state: none。

## Links

- Blocks: spec-00011-multi-workspace（`FR-8` 的 upgrade 路由、`FR-16` 的关停
  收束、`FR-18` 的注册表不合式拒绝，三者的守卫用例都在这五条里）、
  spec-00001-docs-whiteboard（`FR-42` 的文档变更推送，其未知路径拒绝是
  `test/server.test.ts` 那一条）
- Related: issue-00028-a-wildcard-bind-lets-a-loopback-squatter-answer-the-tests
  （同一批夹具的上一处环境依赖）、issue-00031-an-upgraded-socket-never-lets-the-shutdown-finish
  （`test/helpers.ts` 的 `closed()` 的由来）、
  issue-00043-a-400-kb-answer-goes-in-through-argv、
  issue-00044-a-shutdown-hook-counts-arrivals-instead-of-naming-one（同一次 CI 的另外两条）
