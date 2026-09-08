---
id: issue-00033-a-slow-request-leaves-the-shutdown-unfinished
type: issue
status: resolved
blocks: [spec-00011-multi-workspace, plan-00032-native-directory-picker]
---

# Issue: 一个还在飞的慢请求会让关停永远完不成

> `Host.stop()` 只在 `server.close()` 的那一刻扫一次空闲连接。此刻正在处理请求的
> 那条连接**不空闲**，扫不到；等它的响应写完、变成空闲的 keep-alive 时，已经
> 没有我们的人再扫。关停于是停在那里，直到**别人的** keep-alive 超时把连接收走
> ——实测约 3 s，上界是 Node 自己的 `keepAliveTimeout`（缺省 5 s）。不是永不
> 完成（`issue-00031` 才是），是每次都被拖几秒，且拖多久不由我们决定。

## 1. Problem

- Observed: 一个请求在 `shutdown()` 发起、且在 `server.close()` **之后**才回复时，
  `server.close()` 的回调被拖到 **+3005 ms** 才触发（`test/host.test.ts` 实测；
  裸 `http` 复现同为 +3018 ms）。响应本身 7 ms 就写完了。
- Expected: 在飞的请求做完即关停完成——`src/host.ts:108-110` 的注释说的正是
  「其余在飞的请求留给它们自己做完」。
- Trigger: 关停时有任何一个尚未回复的 HTTP 请求，且其连接是 keep-alive
  （浏览器默认如此）。

## 2. Impact

- Affected: 每一个在有慢请求在飞时按 Ctrl-C 的人。今天最容易撞上的是慢的
  `/api/workspaces`（逐条 `git rev-parse`）与首次打开一个大 workspace 的解析。
- Since: `9995af8`（Host 落地）· Still occurring: yes
- Severity: 低。收尾早已完成，拖的只是最后的退出，不丢 commit 也不丢转写，
  且它自己会好——但「自己会好」靠的是对端的 keep-alive 超时，浏览器的可以比
  undici 长得多，我们对它没有发言权。与 `issue-00031` 的分野正在此：那条是
  永不完成，本条是拖几秒。**最初据审计写作「永不触发」，实测后更正为「被拖
  约 3 秒」**——差别足以改变严重度，故记在此。
- 本 issue 由 `plan-00032`（原生目录选择器）的设计审计发现：那个端点会一直
  等到用户在对话框上做出选择，把这条既有缺陷从「偶尔撞上」变成「每次用都撞」。

## 3. Root Cause (first principles)

1. `src/host.ts:106-111`：`server.close(cb)` 之后**同步**调用一次
   `server.closeIdleConnections()`。
2. Node 的 `closeIdleConnections()` 只关**此刻空闲**的连接。正在处理请求的
   那条不在其列——这是它该有的行为，否则就打断了在飞的请求。
3. 该请求回复完毕后，连接转为空闲的 keep-alive。Node **不会**因为 server 处于
   closing 就自行关掉它；而代码里那唯一一次扫描早已过去。没有第二次扫描，
   这条空闲连接便一直活到某个 keep-alive 超时——实测里是客户端先超时（+3 s），
   服务端自己的 `keepAliveTimeout`（5 s）是上界。`close()` 等的正是
   「所有连接都没了」。
4. 真正的根因：**把「扫一次」当成了「扫到干净为止」**——空闲是一个随时间产生的
   状态，而不是关停那一刻的一张快照。
   它**不是**：`closeIdleConnections()` 有 bug；不是 keep-alive 不该用；也不是
   `issue-00031` 没修好——那条修的是**升级过的 WebSocket**，走的是另一条路径
   （`terminate()`），与本条的普通 HTTP keep-alive 无关。

- Introduced by: `9995af8`(`Host.stop()` 写成时)。`issue-00031` 修的是同一个
  函数里 socket 的那一半，当时没有察觉普通连接也有同一个「只扫一次」的毛病。

## 4. Scope (same-cause sweep)

机制是「空闲连接只扫一次」：

| Site | Same pattern | Affected | Action |
| --- | --- | --- | --- |
| `src/host.ts` 的 `stop()` | yes | yes | 本 issue 修 |
| `src/server.ts` 的 `Board.close()` | no | no | 它不持有 http server，只关 ws 与 watcher |
| `bin/persimmon.js` 的信号处理 | no | no | 它只 `await host.shutdown()`，等的就是这一处 |

## 5. Reproduction (test-first)

`test/host.test.ts` 新增一条守卫：一个请求在飞时发起 `shutdown()`，随后放行
该请求，断言 `shutdown()` 在 `bounded` 的 5 s 上界内 settle。沿 `issue-00031`
两条守卫的写法——「不 settle」表现为断言失败而不是用例超时，否则它读起来与
一次慢跑无从区分。

守卫的上界必须是**及时**而不是**完成**：`bounded` 的 5 s 比缺陷本身还宽，
断言「settle 了」在修复前就是绿的。故断言 `< 1000 ms`。

最小机制在 Node 层面已独立复现（`http` 裸 server：响应 +7 ms 写完，
`close()` 回调 +3018 ms 才触发；期间再扫一次 `closeIdleConnections()` 即立刻
closed）。

## 6. Fix

- Change: `src/host.ts` 的 `stop()` 里，把那一次扫描改为**扫到关成为止**——
  `setInterval` 每 50 ms 扫一次，`close()` 的回调里 `clearInterval`。
- Why this addresses the root cause and not the symptom: 空闲是随时间产生的
  状态，所以扫描也必须随时间进行；这样不论有几个请求在飞、各自何时做完，
  最后一个做完之后的那一次扫描都必然扫到它们。在飞的请求仍不被打断——
  `closeIdleConnections()` 从不碰它们，这正是选它而不选 `closeAllConnections()`
  的原因。
- Alternatives rejected: 逐个 response 追踪生命周期、在最后一个 finish 时再扫
  ——同样的效果，却要在 `buildApp` 里加一层中间件和一份在飞集合，比一个
  50 ms 的轮询重；给关停加一个总超时——那是拿「不知道要等多久」当答案，而这里
  知道得很清楚。

## 7. Verification

已执行（仓库根，修复已施加）：

1. **§5 的守卫，红→绿**：`test/host.test.ts::resolves promptly once a request
   that was in flight has answered` —— 红：`AssertionError: expected 3005 to be
   less than 1000`；绿:同一断言通过，`test/host.test.ts` 50 条全过。
2. `npm test` 全绿（见下方本轮总数）；`npm run typecheck` 无输出。
3. 修复不打断在飞请求：守卫在关停后仍断言那个被持住的请求**照常拿到
   `{held: true}`**——`closeIdleConnections()` 从不碰非空闲连接，这正是选它
   而不选 `closeAllConnections()` 的原因。

## 8. Follow-through

- Detection gap: 两层。其一，`issue-00031` 的两条守卫各持一个**活 socket**
  跨过关停，没有一条持一个**在飞的 HTTP 请求**——两者是 Node 里完全不同的
  两条路径，修好其一读起来像修好了全部。其二，那两条守卫的上界是 `bounded`
  的 5 s，而本缺陷只拖 3 s，**即便有人写了这一格、用同样的上界也照样是绿的**；
  所以本守卫断言的是及时（< 1 s）而非完成。
- Doc verdict: **code was non-conformant**。`spec-00011-FR-16` 与
  design-00003 §7 都已把该说的说清，文档不改。
- Residual state: 无。收尾在挂住之前就已完成。

## Links

- Blocks: spec-00011-multi-workspace（FR-16 的退出那一半）、plan-00032-native-directory-picker
- Related: issue-00031-an-upgraded-socket-never-lets-the-shutdown-finish（同一函数、同一症状、不同路径）
