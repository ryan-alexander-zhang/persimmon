---
id: issue-00028-a-wildcard-bind-lets-a-loopback-squatter-answer-the-tests
type: issue
status: resolved
blocks: [plan-00027-multi-workspace]
---

# Issue: 通配绑定拿到的端口不独占 `127.0.0.1`，测试对着别人的服务器断言

> 测试用 `board.listen(0)` 绑**通配地址**拿到端口 P，却用 `http://127.0.0.1:P`
> 去连。机器上任何只绑 `127.0.0.1:P` 的外部进程都会把这些请求接走——通配 bind
> 不报 EADDRINUSE，内核按「更具体的绑定优先」派发。于是 `server.test.ts` 每
> 若干次全量跑就红一个，红在哪个用例只取决于短暂端口计数器扫到别人端口的时刻。

## 1. Problem

- Observed: `npx vitest run test/server.test.ts` 单文件连跑 10 次，红 2 次
  （run 1、run 5），每次只红一个用例，且不是同一个：
  - `the effective agent list > ignores a layer whose added entry declares a cwd
    of its own, naming that key` —
    `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`
  - `the effective agent list > ignores an override of an entry the project layer
    no longer has, and keeps the rest` —
    `SyntaxError: Unexpected token 'F', "Forbidden" is not valid JSON`

  plan-00027 期间在全量 `npm test`（2066 用例）上报的是同一族：约每 8 次全量红
  1 次，永远在 `test/server.test.ts`，且每次换一个用例——
  `the terminal socket > replays what the session already printed to a
  reconnecting terminal`（20 s 超时）、
  `streams session output and forwards what the user types`、
  `runs the declared first form…`、
  `DELETE /api/sessions/:id > ends the running process…`（一次 `HTTPParserError`）。
  单独跑每个都过（`replays…` 3/3）。
- Expected: 用 `board.listen(0)` 起的 board，用它回报的端口去连，必须连到**这个**
  board。plan-00027 §191 第 4 条要求「全量测试、typecheck、覆盖率门全绿」，本
  issue 与之矛盾。
- Trigger: 本机存在任何**只绑 `127.0.0.1`** 且端口落在短暂端口区间
  （macOS `net.inet.ip.portrange.hifirst..hilast` = 49152–65535）的监听进程，而
  某次 `listen(0)` 恰好被分到那个端口号。探查时本机有 4 个：

  | 占位者 | 对 `POST /api/sessions` 的回答 | 测试看到的症状 |
  | --- | --- | --- |
  | `agent-browser` `127.0.0.1:49775` | `400` + **合法 JSON** `{"success":false,"error":"Missing \"session\" field"}` | `body.id === undefined` → 终端连 `?sessionId=undefined` → 被关 → `SESSION_WAIT` 跑满 **20 s 超时** |
  | jetbrains `127.0.0.1:52829` | `403`，正文 `Forbidden` | `Unexpected token 'F', "Forbidden" is not valid JSON` |
  | jetbrains `127.0.0.1:59264` | `404`，正文 `<!doctype html>…` | `Unexpected token '<'…` |
  | `Google` `127.0.0.1:49776` | `404`，`Content-Length:0`（冒号后无空格的非标准头）、空正文 | `HTTPParserError` / `Unexpected end of JSON input` |

  四种症状与 plan-00027 期间报到的四种一一对上。**「PTY 计时」是伪相关**：那四个
  用例只是「先发一个 HTTP 请求拿 `id`，再等终端输出」的那批，被抢走 `id` 之后唯一
  可见的表现就是等满 20 s。

## 2. Impact

- Affected: 每一次 `npm test`。整条 HTTP/WS 测试面都在这个机制上——
  `server.test.ts`、`acceptance.test.ts`、`host.test.ts`、`boardSeams.test.ts`、
  `cli.test.ts`、`startup.test.ts`。红哪个用例是随机的，因此没有任何一个用例可以
  被单独「修稳」；套件长期有一个游走的红点，真正的回归会被「反正总有一个红」淹没，
  CI 一旦接上就永远不绿。
- Since: pre-dates the repo——`f914c7e`（init）的
  `tools/whiteboard/test/server.test.ts:97`（`board.listen(0)`）与 `:106`
  （`fetch('http://127.0.0.1:…')`）已是同一形态、同样行号，
  `tools/whiteboard/src/server.ts:535` 的 `this.app.listen(port)` 亦然。
  `07fc1a7`（plan-00027 T2，白板移到仓库根）只搬了路径。
  · Still occurring: **yes**（未修）
- Severity: 高——它不改任何运行时行为，但它使「全量绿」这个验收信号失效，而
  plan-00027 的 resolved 就压在这条上。同一机制在产品侧也存在（§4），概率低但
  后果是「board 起来了，打印的地址却不是它」。

## 3. Root Cause (first principles)

1. 分歧：测试以为自己在跟刚起的那个 board 说话；实际在跟「此刻答复
   `127.0.0.1:P` 的那个东西」说话。两者在没有占位者时重合，有占位者时分叉。
2. 最小机制：`src/server.ts:660` 的 `this.app.listen(port)` **不带地址**，Node
   因此绑通配地址（`server.address().address === '::'`，双栈）。通配 bind 的独占
   只覆盖通配地址这一个 `(addr, port)` 对；`bind()` 到**具体**地址
   `127.0.0.1:P` 是另一个对，内核允许，且入向查找取**最具体**的匹配。
   `test/server.test.ts:97` 拿走这个通配绑定给出的端口号，
   `test/server.test.ts:106`（HTTP）与 `:1226`/`:1299`（WS）却去连 `127.0.0.1`
   ——恰是这次 bind **没有**声明的那个地址。
3. 真正的根因：**把 `listen(0)` 读成「这个端口是我的」，而它只说「这个端口在
   通配地址上是空的」。** 端口号不是锁，`(地址, 端口)` 对才是。
   它**不是**这些症状：不是 replay 缓冲区与 socket attach 的竞态
   （`src/sessionManager.ts:706` 的 `attach` 在同一个 tick 里取 `session.buffer`
   并挂 listener，`publish`（`:1041`）先追缓冲再喂 listener，无窗口）；不是
   `onExit` 与 HTTP 响应的先后（`src/sessionManager.ts:1077` 的 `exit` 同步落状态，
   `terminate` 等 `finished`）；不是假 PTY 在 listener 挂上之前就发数据
   （`scriptedAgents` 的 `say` 由测试自己触发）；不是 `vi.waitFor` 窗口太短
   （`SESSION_WAIT` 20 s 对一次 `node -e` 足够，等不到是因为要等的东西不会来）；
   也不是共享端口写死。

- Introduced by: **pre-dates the repo**。机制自 `f914c7e` 起逐字存在。在它之前
  没有 HTTP 测试，缺陷无从发生。使它**开始发作**的不是仓库里的任何改动，而是
  本机装上了第一个「只绑 `127.0.0.1` 且落在短暂端口区间」的常驻服务；本仓库无法
  用 git 定位那一刻，这也正是它表现为「与代码无关的偶发」的原因。

### 为什么是「约每 8 次一红」

macOS 的短暂端口分配是**顺序**的、全机共用一个计数器（实测：连续 4 次
`server.test.ts` 的首/末端口首尾相接——55227→56617, 56632→61642, 61656→62812,
62815→64241），区间宽 16384。一次 `server.test.ts` 扫掉区间的 7%–31%（4 次实测
1390 / 5010 / 1156 / 1426 个端口位），其中只有 259 个位置是 `listen()`（其余是
出向连接、git 子进程、ws 客户端）。于是「某个 `listen()` 正好落在 4 个占位端口
之一」的概率 ≈ 259 × 4 / 16384 ≈ **6%/次单文件**；全量套件起的服务器更多，与
上报的 ~12.5%（1/8）和本次实测的 2/10 同一量级。顺序扫描也解释了聚簇：一次跑里
计数器扫到占位端口的时刻是固定的，落在当时正在跑的那个 describe 上——本次两次都
落在 `the effective agent list`，plan-00027 期间落在终端 socket 那批。

## 4. Scope (same-cause sweep)

机制是「以通配地址 bind 取得端口，再以具体回环地址连接」。扫了全部两端：

| Site | Same pattern | Affected | Action |
| --- | --- | --- | --- |
| `src/server.ts:660` `this.app.listen(port)` | yes | yes | 机制的唯一住所；修在这里（加地址形参） |
| `src/host.ts:74` `this.app.listen(port)` | yes | yes | 同上 |
| `test/server.test.ts:97` + `:106` | yes | yes | 绑通配、连 `127.0.0.1`；改为显式回环 |
| `test/server.test.ts:689` + `:694` | yes | yes | 同一形态 |
| `test/server.test.ts:1213` + `:1226`/`:1299`/`:1427`/`:1508`/`:1529`/`:1646`/`:3568` | yes | yes | 同一 board 的 HTTP 与 WS 两路 |
| `test/acceptance.test.ts:38` + `:43`；`:176` + `:180` | yes | yes | 同一形态 |
| `test/host.test.ts:125` + `:129`/`:150` | yes | yes | 同一形态 |
| `test/boardSeams.test.ts:101` + `:108` | yes | yes | `server.listen(0)` 通配 + `ws://127.0.0.1` |
| `test/cli.test.ts:168` + `:187`/`:338`/`:385` | yes | yes | `host.listen(0)` 通配 + `fetch('http://localhost:…')` |
| `test/helpers.ts:164` `freePort()` | yes | yes | 用**通配** bind 探空后宣布端口可用；它交给 `startup`/`cli` 测试去 `listen(port)` 的端口可能已被 `127.0.0.1` 占着 |
| `bin/persimmon.js:141` 探针 `fetch('http://localhost:${port}/api/instance')` | yes | yes（产品，潜伏） | 探针问的是「localhost 上是谁」，bind 声明的是通配——两个问题不同。占位者占着 4173 时：探针读到「不是 persimmon」→ 通配 bind 成功 → 打印 `http://localhost:4173/` → 浏览器落到占位者。4173 在短暂区间外，概率低，**不在本 issue 修**，见 §8 |
| `test/startup.test.ts:81` `createServer().listen(port)` | yes | yes | **本行原记「要的就是通配冲突，并如期拿到 EADDRINUSE」，实测不成立**（§7 第 5 条）：CLI 在探测判定 occupied 后即 `fail()`，从不走到 `listen()`，所以这条断言走的一直是探测路径而非 EADDRINUSE。占位者改绑回环 |
| `src/pty.ts`、`src/sessionManager.ts`、`src/killLadder.ts` | no | no | 不开 socket；PTY 路径自始不在其中（症状伪相关） |

## 5. Reproduction (test-first)

**确定性复现**，不是统计的：`test/issue-flake-repro.test.ts`（临时文件，随修复
折进 `server.test.ts` 或删除）。把「短暂端口恰好撞上」换成写死端口，其余与
`test/server.test.ts` 逐字同形：先起一个只绑 `127.0.0.1` 的占位者，再让 `Board`
在同一端口 `listen`，然后照原样发请求。两个用例覆盖两种占位者、两种症状：

- Failing test 1（占位者答非 JSON，即 jetbrains `:52829` 那种）：
  `test/issue-flake-repro.test.ts::serves the board’s own /api/config to a
  127.0.0.1 caller` — 失败于
  `SyntaxError: Unexpected token 'F', "Forbidden" is not valid JSON`，与野外
  run 5 逐字节相同。用例中间那句
  `expect(server.address().address).toBe('::')` **先通过**，即通配 bind 并未失败
  ——两个服务器同时「在」这个端口上，这就是缺陷本身。
- Failing test 2（占位者答合法 JSON，即 agent-browser `:49775` 那种）：
  `test/issue-flake-repro.test.ts::replays what the session already printed to a
  reconnecting terminal`，`vi.waitFor` 那一句照抄 `test/server.test.ts:1345`
  ——失败于 `AssertionError: expected '' to contain 'printed early'`，耗时
  **20.5 s**，即 `SESSION_WAIT` 跑满。这就是上报的那次「`replays…` 20 s 超时」。
  用例里 `expect(started.id).toBeUndefined()` 先通过：JSON 解析成功，所以**没有
  任何东西喊出「你连错了服务器」**，只剩一个等满的 20 s。这一条把「PTY 计时」
  这个读法直接排除。

统计侧的数字（供对照，不作为验收）：

| 跑法 | 次数 | 红 |
| --- | --- | --- |
| `npx vitest run test/server.test.ts`，串行，安静机器 | 10 | **2**（run 1、run 5，见 §1） |
| 同上，带 fetch/listen 探针（共 1220 次 listen，7 次跑） | 7 | 0 |
| 同上，3 份并发（CPU 负载） | 3 | 0 |

合计 20 次单文件跑，红 2 次（10%）。后两批为 0 不是反证，而是同一模型的预测：
计数器是全机顺序的，那两批扫过的区段里没有占位端口（探针记下的 `listen` 端口
序列证实每批首尾相接，且都没落在那 4 个端口上）。

内核层面的三条实测（`node` 独立脚本）：

1. 通配 `listen(0)` 会分到被 `127.0.0.1` 占着的端口：**5 / 20000** 次
   （与 4 / 16384 相符）。
2. 显式 `listen(0, '127.0.0.1')` 分到同一端口：**0 / 20000** 次。
3. 显式 `listen(P, '127.0.0.1')` 撞上占位者：**`EADDRINUSE`**——静默窃取变成
   响亮失败。

## 6. Fix

*已施加*（本节所述，逐条见 §7）。

- Addendum（施加时发现的必要伴随改动）：命名地址的 bind 比通配形式**晚一个 tick**
  —— Node 的 `listen(port, host)` 走 `dns.lookup`，字面 IP 也只是 `process.nextTick`
  的快路，于是 `listen()` 返回时 `server.address()` 还是 `null`。原先测试里
  `const port = (server.address() as { port: number }).port` 紧跟 `listen()` 同步读，
  改地址后 306 个用例一起报 `Cannot read properties of null (reading 'port')`。
  内核不肯把「回环上空着的端口」同步交出来（能同步交出的只有通配形式，而那正是缺陷），
  所以端口只能在 `listening` 之后读。新增 `test/helpers.ts` 的 `boundPort(server)`
  —— 一个 `Promise<number>`；`call()` 本就是 `async`，在内部 `await` 它，因此
  ~100 个只用 `call` 的用例一行不改，只有真正拿 `port` 拼 URL 的 ~20 处加了 `await`
  （`connect`/`subscribe` 两个局部辅助改成收 `Promise<number>`，一处签名换 13 处调用）。
  `tsc` 把每一处漏掉的都报了出来，是完整的工单。

- Change: **绑的地址与连的地址取成同一个。** 给两处 `listen()` 缝
  （`src/server.ts:660`、`src/host.ts:74`）加一个可选地址形参并传下去
  （`this.app.listen(port, host)`），测试传它本来就在连的那个地址
  （`board.listen(0, '127.0.0.1')`）；`test/helpers.ts:164` 的 `freePort()`
  用同一地址探空。测试侧的 `fetch`/`WebSocket` 一行不改。
- Why this addresses the root cause and not the symptom: 根因是「端口号被当成锁」。
  显式绑到客户端实际拨的那个地址之后，内核对**这个** `(地址, 端口)` 对给出独占：
  分配器不再交出被占的端口（§5 实测 0/20000），真撞上时 `EADDRINUSE` 当场抛出而
  不是把别人的响应交给断言。它不动任何 `vi.waitFor` 窗口、不加 sleep、不改产品
  时序——因为那些从来不是问题。
- Alternatives rejected:
  - 改连 `[::1]`：把一个没主的地址换成另一个（`::1` 同样可被占），且在没有 IPv6
    回环的环境里直接连不上。
  - 放长 `SESSION_WAIT`：把 20 s 超时当慢；它等的东西永远不会来。
  - JSON 解析失败后重试：掩盖窃取，且会朝占位者一直重试。
  - 换到某个「私有」端口段：冲突来自**具体地址**的 bind，只要 bind 还是通配，
    没有任何端口段是安全的。
  - 起服务器前先探一次 `127.0.0.1:P`：又一个 TOCTOU，且这正是
    `bin/persimmon.js:141` 已经栽过的那一跤。
- **产品侧同一处一并改（编排者裁定）**：`src/host.ts` 的 `listen()` 与
  `bin/persimmon.js` 的探测都改到 `127.0.0.1`——不是新的可达性决定，而是
  回到文档早已声明的约束：`spec-00011` §6「进程仍只监听 `localhost`」、
  `ARCHITECTURE.md` §2「`localhost` only」、`prd-00001` 范围外「远程部署」。
  今天绑通配地址的板从局域网可达，与三处文档都相悖；§3 记的 CLI 潜在误判
  （回环占位者让探测读成「不是 persimmon」）随之消失。打印给用户的地址仍是
  `http://localhost:<port>`（浏览器对两种回环都会试）。`Board.listen()` 的
  地址形参保留缺省为通配——它只剩测试与单板旧路径在用，不改其既有语义。

## 7. Verification

已执行（仓库根，修复已施加）：

1. **回归守卫**（§5 的复现折进套件，断言改为「bind 以 `EADDRINUSE` 被拒」，守的是
   「绑的地址就是连的地址」这条不变量而不是某一个用例）：
   - `test/server.test.ts::the port a board serves on > refuses to come up on a
     port a loopback listener already holds`
   - `test/host.test.ts::shutting the host down > refuses to come up on a port a
     loopback listener already holds`（产品侧：`Host.listen()` 的缺省回环绑定）

   两条都绿。修复前它们必红：实测通配 bind 落在已被 `127.0.0.1:P` 占着的端口上
   **成功**（`wildcard bind after loopback: OK`），守卫等的 `error` 事件永不到达，
   用例超时。修复后同一形态是 `EADDRINUSE`（`loopback bind after loopback:
   EADDRINUSE`）。
2. `npm test` **连跑两次**：`Test Files 70 passed (70)` / `Tests 2072 passed
   (2072)`，59.13 s 与 59.22 s。2070 是原有用例，+2 是上面两条守卫。
   `npm run typecheck` 无输出（通过）。
3. `npm run test:coverage`：门槛未动（`vitest.config.ts:22`
   `{ lines: 90, branches: 90, functions: 90 }`），实得
   Statements 98.63 % (5128/5199)、Branches 95.29 % (2918/3062)、
   Functions 98.67 % (1560/1581)、Lines 99.36 % (4409/4437)；
   改到的两个文件 `src/host.ts` 97.94/96.36/97.05/98.46、
   `src/server.ts` 99.64/92.19/100/99.59。`npm run build` 成功。
4. **产品侧实测**：`PORT=4311 node bin/persimmon.js`（仓库根）——
   `lsof -nP -iTCP:4311 -sTCP:LISTEN` 给出
   `node 72186 ryan 14u IPv4 … TCP 127.0.0.1:4311 (LISTEN)`，不再是 `*:4311`；
   `curl -s http://127.0.0.1:4311/api/instance` 答
   `{"app":"persimmon","version":"0.1.0","pid":72186}`；打印给用户的仍是
   `persimmon: http://localhost:4311/w/persimmon`。
5. **`test/startup.test.ts` 的「port held」用例走的是哪条路**：探测超时，不是
   `EADDRINUSE`（§4 该行原记有误，已改）。理由：`bin/persimmon.js` 的 `start()`
   在 `probe()` 判定 `occupied` 后立即 `fail()`，永远走不到 `host.listen()`，所以
   这条断言从来不由 bind 产生。占位者改为绑 `127.0.0.1`（而不是通配）：通配占位者
   留下的端口在回环上**仍可绑**，那样断言的就是「一个进程其实拿得到的端口」，
   用例名 «a port it cannot have» 便不成立。占位者是个没有 `request` 监听的
   `createServer()`，连接被接下但永不答复 → 探测的 1 s `AbortSignal.timeout`
   触发 → `occupied` → exit 1 与 `port <P> is already in use`。占位者的 `listen`
   也必须先 `await`（`boundPort`）：`boot()` 用 `spawnSync` 堵住事件循环，命名 bind
   那一个 tick 否则永不发生，端口实际是空的，子进程会正常启动（实测 exit 0 + 20 s
   `spawnSync` 超时）。
6. grep 守卫：`test/` 内不再存在「`listen` 未给地址、却对
   `127.0.0.1`/`localhost` 发起连接」的组合（§4 表格即这条的清单；
   `test/boardSeams.test.ts`、`test/cli.test.ts`、`test/helpers.ts` 的三处本就
   `await` 了 `listening` 回调，只加地址）。

## 8. Follow-through

- Detection gap: 这些用例全都只断言**解析后的 body**，所以「你在跟另一个服务器
  说话」只能以 JSON 语法错误或一次静默的 20 s 等待现身，从不以自己的名义现身；
  套件里也没有任何一处断言过自己绑到的地址。显式绑定本身就是守卫（撞上即
  `EADDRINUSE`），无需再加断言。另：本轮之所以能定位，靠的是包一层 `fetch`
  把非 JSON 响应连状态码和响应头一起打出来——这类探针值得在下次追偶发时先上。
- Doc verdict: 测试侧 **code was non-conformant**。产品侧 `design-00003 §8`
  「启动握手先探端口再占」**不完整而非错误**：探针问 `localhost`、bind 声明通配，
  两者不是同一个问题；应在该节补明「探的地址与绑的地址必须相同」，并记入
  `bin/persimmon.js` 的暴露面。§4 表格里 `bin/persimmon.js:141` 那一行**已在本
  issue 的修复范围内**（编排者裁定，§6 末）：探针改问 `127.0.0.1`，
  `Host.listen()` 缺省绑回环——这不是新的可达性取舍，而是回到 `spec-00011` §6
  「进程仍只监听 `localhost`」与 `ARCHITECTURE.md` §2「`localhost` only」早已
  声明的约束，因此无需 `decision`。
- Residual state: 磁盘与配置上无残留（4311 的实测进程已停，端口已释放）。
  plan-00027 §191 第 4 条**不再阻塞**：§7 第 2 条的两次全量重跑与 typecheck 全绿。
  仍待办的只有一条文档修补——`design-00003 §8` 补明「探的地址与绑的地址必须相同」
  并记入 `bin/persimmon.js` 的暴露面；该文件此刻由 issue-00029 的修复占用，故未
  在本次一并改，留给下一次触碰 `design-00003` 的改动带上。

## Links

- Blocks: plan-00027-multi-workspace
- Related: design-00003-multi-workspace §8（启动握手的端口探测）、
  issue-00027-a-directory-symlink-crashes-the-text-merge-guard（同属「测试问的
  问题与它实际做的检查不是同一个」这一族）
