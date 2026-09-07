---
id: issue-00031-an-upgraded-socket-never-lets-the-shutdown-finish
type: issue
status: resolved
blocks: [plan-00027-multi-workspace]
---

# Issue: 浏览器开着 WebSocket 时 `SIGINT` 收尾做完了，进程却永不退出

> 关停把每个会话都收了尾（`.json`/`.log` 已落盘），但 `Host.stop()` 等的那个
> `server.close()` 回调永远不来：升级过的 WebSocket 既不是 idle 连接，`ws` 在
> `noServer` 模式下的 `close()` 也不关它——于是 `shutdown()` 不 settle，
> `process.exit(0)` 永不执行。浏览器一关，进程立刻 exit 0。

## 1. Problem

- Observed: `HOME=<scratch> PORT=<p> node bin/persimmon.js`，浏览器打开
  `http://localhost:<p>/w/persimmon`（页面持有 `/w/persimmon/api/events`），
  `kill -INT <pid>`：HTTP 端口立刻不再 accept，进程**不退出**，+76 s 仍在。
  关掉浏览器标签的那一瞬进程 exit 0。没有浏览器连着时不到 1 s 退出。
  会话收尾本身完成了——`.whiteboard/sessions/*.json` 与 `*.log` 都已写出。
- Expected: `spec-00011-FR-16`「……全部收尾完成后退出」。收尾完成即退出，退出
  不以「浏览器先断开」为条件。`spec-00003-FR-9` 的服务端正常关停同理。
- Trigger: 关停时任何一个升级过的 WebSocket 还在——即「有人正开着页面」。
  这是关停的常态而不是边角：Ctrl-C 通常正是从开着白板的那台机器上敲的。

## 2. Impact

- Affected: 每一次「页面开着时的正常关停」。用户敲 Ctrl-C，收尾其实早已做完，
  但终端不回来、进程留在那里占着 4173；再敲一次 Ctrl-C 也只是并入同一次
  （`spec-00011-AC-16.3` 的幂等），只能 `kill -9`（丢掉的其实什么都没有，
  因为收尾已完成——但用户无从知道这一点）。下一次 `persimmon` 会探到端口上
  「有个已运行进程」并把工作交给这个僵着的进程。
- Since: `dad65f3`（plan-00027 T6，2026-09-07）· Still occurring: **yes**（未修）
- Severity: 高——它不丢数据（收尾在挂住之前就完成了），但它使
  `spec-00011-FR-16` 的「退出」这一半不成立，`spec-00011-AC-16.1`/`AC-16.2`
  的「进程才退出」无从验证；plan-00027 的 step-6 浏览器 smoke 正是栽在这里。

## 3. Root Cause (first principles)

1. 分歧：`Host.shutdown()` 应在收尾做完后 settle；实际它等的是「http server
   上所有连接都结束」，而升级过的 socket 不会因为关停而结束。两者在没有活
   socket 时重合，有一个活 socket 时永远分叉。
2. 最小机制，三行合起来才成立：
   - `src/host.ts:103-108`：`await new Promise(resolve => { server.close(() =>
     resolve()); server.closeIdleConnections() })`。`http.Server.close()` 的回调
     等的是 **net 层** `server._connections` 归零。
   - Node 在 upgrade 时把这个 socket 从 `Symbol(http.server.connections)` 里
     **摘掉**，却仍算在 `_connections` 里。实测（`node v26.5.0`，一个升级过的
     socket 在场）：`kConnections.all().length === 0`、`idle().length === 0`、
     `server._connections === 1`。所以 `closeIdleConnections()` **和**
     `closeAllConnections()` 都碰不到它，而 `close()` 的回调却在等它。
   - `src/server.ts:648`（`Board.close()`）与 `src/host.ts:100`
     （`Host.stop()` 的 host events）只调 `WebSocketServer.close()`。
     `node_modules/ws/lib/websocket-server.js:186-198`：`noServer` 模式下
     `close()` 只摘 listener、把 `_state` 置 CLOSING，然后**等** `clients` 自己
     变空才 `emitClose`——它一个 client 都不关。
3. 真正的根因：**升级过的 socket 没有主人。** 它已经不在 http server 的连接表
   里（所以 `closeIdleConnections`/`closeAllConnections` 关不到），`ws` 的
   `close()` 又只是「不再接新的」而不是「关掉旧的」——唯一还握着它的是
   `wss.clients`，而关停路径上没有任何一处去动那个集合。于是 `close()` 等一个
   谁都没被要求去结束的连接。
   它**不是**这些症状：不是会话收尾没做完（`.json`/`.log` 已落盘，
   `commitCount` 已涨）；不是 `shutdown()` 的幂等 memo 卡住
   （`this.stopping` 只是同一个未 settle 的 promise）；不是入口的
   `void host.shutdown().then(() => process.exit(0))` 写错（`.then` 从未被
   调用，因为前面的 promise 不 settle）；不是 watcher 或 pty 有句柄没释放
   （无浏览器时同一路径 <1 s 退出）；也不是缺一个 exit 超时——超时只会把
   「永不退出」换成「等满 N 秒再退出」，而正确的退出时机是**现在**。

- Introduced by: **`dad65f3`**（plan-00027 T6，`src/host.ts` 首次出现
  `stop()` 里那个 `await new Promise(… server.close(…) …)`）。在它之前入口是
  `bin/whiteboard.js`：`board.shutdown().then(() => { server.close();
  process.exit(0) })`（`07fc1a7:bin/persimmon.js:33-35`）——`server.close()`
  的回调根本没人等，`process.exit(0)` 在同一 tick 就跑，所以挂住无从发生。
  同一个 `ws`/Node 机制那时就在，缺的是「等它」这个动作。

## 4. Scope (same-cause sweep)

机制是「关一个 `WebSocketServer` 却不关它的 client，而某个等待方在等这些
client 结束」。三处住着这个机制：

| Site | Same pattern | Affected | Action |
| --- | --- | --- | --- |
| `src/server.ts:648` `Board.close()`，两个 socket server（terminal + events） | yes | yes | **smoke 里挂住的就是这一处**：浏览器持有的是 `/w/<wid>/api/events`，属 board。修在这里 |
| `src/host.ts:100` `Host.stop()` 的 host events server（`/api/workspaces/events`） | yes | yes | 切换器页面持有它，同样挂住 `server.close()`。修在这里 |
| `src/host.ts:103-108` `Host.stop()` 的 `server.close()` 等待 | yes | yes（等待方） | 不改：把 socket 关掉之后它就是「等在飞的 HTTP 请求做完」，本就是它想等的（`:105-106` 的注释） |
| `src/server.ts:671` `Board.listen()` 的 `server.on('close', () => void this.close())` | yes | 潜伏 | 顺序是反的：`close()` 只在 `'close'` 事件后跑，而那个事件同样要等连接结束——单板路径若有活 socket 也会挂。产品侧已无人走这条路（入口只用 `Host`），只剩 `test/server.test.ts`；`Board.close()` 修好后这条路的 `afterEach` 仍先关客户端，故不额外改动，仅在此记明 |
| `src/host.ts:231-235` `remove()` 里的 `board.shutdown()` + `board.close()` | yes | yes（同一修复覆盖） | 走的就是 `Board.close()`；修好后一次 DELETE 会把这个 workspace 的活 socket 一并断开——这正是它应有的语义（实例被放掉了） |
| `src/docsWatcher.ts`、`src/sessionManager.ts` | no | no | 不持有 socket server |

## 5. Reproduction (test-first)

两条，各守一半，都带 5 s 上界——「不 settle」必须表现为**断言失败**而不是
用例超时，否则读起来和一次慢跑没有区别：

- `test/host.test.ts::shutting the host down > resolves while a browser still
  holds its sockets open` — 真的连上 `/w/alpha/api/events`（board 的）与
  `/api/workspaces/events`（host 的），登记好两端的 `close` 观察者，再
  `await host.shutdown()`。修复前失败于 `expected 'timed out' to be undefined`
  （`Host.stop()` 的 `server.close()` 回调永不来）。
- `test/boardSeams.test.ts::closing a board without shutting it down > drops the
  sockets a live browser is holding` — 一个 board 挂在别人的 http server 上，
  开着 terminal 与 events 两个 socket，`await board.close()` 后两端都必须收到
  close。修复前失败于 `expected 'still open' to be 'closed'`（`ws` 的
  `close()` 一个 client 都没关，两个 socket 都还开着）。

## 6. Fix

- Change: `Board.close()` 与 `Host.stop()` 在 `WebSocketServer.close()` 之前，
  先把该 server 的每个 client `terminate()`（`clientTracking` 是 `ws` 的默认
  开启项，`noServer` 模式下 `clients` 集合照样在，实测 `size === 1`）。
  design-00003 §7 的顺序不动：会话先收尾，再 socket 与 watch，最后 HTTP server。
- Why this addresses the root cause and not the symptom: 根因是「升级过的
  socket 没有主人」。`wss.clients` 是唯一还握着它的地方，所以关停由这里下手，
  socket 一断 Node 的 `_connections` 就归零，`server.close()` 的回调当场触发
  ——不动等待方、不加超时、不改入口。
- **不加 `closeAllConnections()`**（smoke 的读法在这一点上需要更正）：实测它
  对升级过的 socket 无效，因为 Node 已经把该 socket 从
  `Symbol(http.server.connections)` 摘掉了（§3 第 2 条的三个数）。
  实测四种组合（一个活 WebSocket 在场，等 `server.close()` 回调）：
  `closeIdleConnections()` 单用 → 超时；`+ closeAllConnections()` → 超时；
  `terminate()` 每个 client → **1 ms 回调，客户端收到 close**；
  `client.close()` 每个 client → 1 ms（但取决于对端回应 close 帧，一个卡住的
  对端就会拖到 `ws` 的 30 s `closeTimeout`，故取 `terminate()`）。
- 入口不动：`void host.shutdown().then(() => process.exit(0))` 逐字保留。
- Alternatives rejected:
  - 给 `shutdown()` 或入口加一个退出超时：把「永不退出」换成「等满 N 秒」，
    而正确时机是收尾做完的那一刻；且它会掩盖下一个同类漏洞。
  - `server.closeAllConnections()`：实测无效（上）。
  - 不等 `server.close()` 的回调（回到 `07fc1a7` 的写法）：那是把缺陷藏起来
    ——在飞的 HTTP 请求会被切断，`Host.stop()` 的 `:105-106` 明确要留它们做完。
  - `client.close()` 而非 `terminate()`：优雅关闭要等对端回 close 帧，一个不
    回的对端就是新的无界等待（`ws` 默认 `closeTimeout` 30 s）。关停时对端已
    经没有任何要说的了。

## 7. Verification

已执行（仓库根，修复已施加）：

1. **§5 的两条守卫，红→绿**（`red` 为施加修复前实测的失败原文）：
   - `test/boardSeams.test.ts::drops the sockets a live browser is holding` —
     红：`AssertionError: expected 'timed out' to deeply equal [ 'closed',
     'closed' ]`（`board.close()` 之后两个客户端一个都没被关）→ 绿。
   - `test/host.test.ts::resolves while a browser still holds its sockets open` —
     红：`AssertionError: expected 'timed out' to be undefined`，用例耗时
     5126 ms（`bounded` 的上界，即 `shutdown()` 未 settle）→ 绿。
   两条一起：`Test Files 2 passed (2)` / `Tests 61 passed (61)`。
2. **端到端，照 smoke 的做法**（scratch `HOME`，临时空闲端口，一个 node 脚本
   持有 `/w/persimmon/api/events`，`kill -INT`）：
   - 修复前（`git stash` 掉两个源文件后 `npm run build` 重出 `lib/`——入口跑的
     是 `lib/`）：SIGINT 之后进程**不退出**；`holder: open` 一直在，
     `/api/workspaces` 已答复过。直到把 holder 进程 `kill` 掉的那一瞬才
     `exit code=0 after 139137ms`——「浏览器一断就退」的上报症状逐字复现。
   - 修复后：`exit code=0 after **144ms**`，holder 仍连着；holder 随即打出
     `holder: closed at +1.06s`，即服务端主动断的。
3. `npm test` **连跑两次**：两次都 `Test Files 71 passed (71)` /
   `Tests 2075 passed (2075)`（60.93 s、60.25 s）。2073 是原有用例，+2 是
   §5 的两条。无失败，故无需单独重跑任何一条。
4. `npm run typecheck` 无输出（通过）。`npm run build` 成功。
5. `npm run test:coverage`：门槛未动（`vitest.config.ts:23`
   `{ lines: 90, branches: 90, functions: 90 }`），实得
   Statements 98.63 %、Branches 95.29 %、Functions 98.67 %、Lines 99.36 %；
   改到的两个文件 `src/host.ts` 97.97/96.36/97.05/98.47、
   `src/server.ts` 99.64/92.19/100/99.60。
6. **关停仍然有界，且不需要新的超时**（本 issue 的第 4 条要求）：
   design-00003 §7 说等待由会话的信号升级阶梯定界（issue-00012）。socket 一侧
   现在是同步的 `terminate()`——不等对端、不等 close 帧；`this.events.close()`
   与 `WebSocketServer.close()` 本就不被 `await`；剩下 `server.close()` 等的只有
   「在飞的 HTTP 请求做完」，那是它想等的（`src/host.ts:105-106`）。因此关停路径
   上已没有无界等待，**不加**任何 exit 超时。

## 8. Follow-through

- Detection gap: 套件里没有任何一处**跨关停持有一个活 socket**——
  `test/host.test.ts` 与 `test/boardSeams.test.ts` 的 `afterEach` 都是
  「先 `socket.close()`，再 `host.shutdown()` / `board.close()`」，正好把缺陷
  发生的那个前提清掉了；`boardSeams` 原有的
  «refuses the upgrades shutdown leaves open» 只测「关停后**新**升级被拒」，
  从不测「关停前**已有**的连接怎么办」。现在两条守卫各持一个活 socket 跨过
  关停，且都带 5 s 上界——「不 settle」表现为断言失败而不是用例超时，否则它读
  起来与一次慢跑无从区分。
- Doc verdict: **code was non-conformant**。`spec-00011-FR-16`「全部收尾完成后
  退出」与 `spec-00003-FR-9` 都已把该说的说清；design-00003 §7 的顺序也对
  （会话 → `close()` → HTTP server），代码只是没把 §7 的「`close()`」做完整。
  文档不改，无需新增 GWT 之外的条目——两条守卫挂在既有的
  `spec-00011-AC-16.1`/`AC-16.2`（退出那一半）与 `spec-00011-FR-16` 上。
- Residual state: none。收尾在挂住之前就已完成，所以历史上每一次「Ctrl-C 后
  僵住再 `kill -9`」都没有丢 commit 或转写；磁盘与注册表上无残留（本轮实测起
  的进程与临时 `HOME` 均已清理）。`spec-00011-AC-16.1`/`AC-16.2` 的退出一半
  不再阻塞 plan-00027。

## Links

- Blocks: plan-00027-multi-workspace
- Related: design-00003-multi-workspace §7（关停顺序）、
  issue-00012-stop-cannot-end-a-process-that-ignores-sighup（关停的有界性由信号
  升级阶梯给出，本 issue 说明 socket 一侧不再有无界等待）
