---
id: issue-00044-a-shutdown-hook-counts-arrivals-instead-of-naming-one
type: issue
status: resolved
blocks: [spec-00003-whiteboard-parallel-sessions]
---

# Issue: 关停用例数到达次数，却按启动顺序断言——十跑六红

> 关停把两个会话的收尾**并发**跑掉，谁先到达由 OS 调度决定。用例用「第一个
> 到达的那次抛错」制造失败，却断言「先启动的那个会话拿到了失败」。两者只在
> 调度恰好按启动顺序时相符，本机十跑六红。

## 1. Problem

- Observed: `test/sessionManager.test.ts > attach > wraps up every session on a
  shutdown even when one wrap-up throws` 间歇失败。首次 CI（run
  `34438160787`，`ubuntu-latest`，`node-version: '23'`）九红之一，98ms；本机
  darwin v26.5.0 连跑十次得 **6 红 4 绿**：

  ```sh
  for i in $(seq 10); do npx vitest run test/sessionManager.test.ts -t "wraps up every session"; done
  # → failed, passed, failed, failed, failed, passed, failed, failed, passed, passed
  ```

  红时的断言是最后两条对调：`first` 的 `outcome` 读到 `OUTCOME`，`second` 的
  读到 `{ problems: ['the commit failed'], … }`。
- Expected: 用例证的是 `spec-00003-AC-9.3` 与 `spec-00003-FR-9`——一次关停把
  **每个**运行中会话都收尾，其中一个的收尾抛错不该夺走别人的，失败要记在**它
  发生的那个会话**上。这条不变量与收尾的先后无关，用例的读数也应当与先后无关。
- Trigger: 两个 pty 的退出顺序与启动顺序不一致。纯调度，无需特定平台或
  Node 版本。

## 2. Impact

- Affected: 每一次 `npm test`，以约六成的概率。**产品代码不受影响**——
  `SessionManager.shutdown()` 的行为在红绿两种结果下完全相同，红的只是断言的
  前提。
- Since: `f914c7e`（2026-09-04，`init`，用例随 `test/sessionManager.test.ts`
  一同落地）· Still occurring: yes
- Severity: 高。间歇失败比稳定失败贵：它教人「重跑一次就好」，而那正是让真
  缺陷混进绿灯的习惯。它也是这次九红里唯一一条与平台、与 Node 版本都无关的。

## 3. Root Cause (first principles)

1. 分歧：用例用**到达顺序**选出要失败的那次收尾，却用**启动顺序**去认领这次
   失败。这两个顺序不是同一个序。
2. 最小机制，两处：
   - `src/sessionManager.ts:923-928`：关停把每个运行中会话的收尾放进
     `Promise.allSettled(this.running().map(async (session) => { … }))`——
     `map` 建的是**并发**的 promise，每个各自 `await this.terminate(id)` 再
     `await this.whenFinished(id)`，各等自己那个 pty 真的退出。谁先走完由 OS
     的进程调度决定。`allSettled`（而非 `all`）也正是这条设计的要点：settled，
     不是 raced。
   - `test/sessionManager.test.ts:1022-1027`：

     ```ts
     let calls = 0
     const onExit = vi.fn(async () => {
       calls += 1
       if (calls === 1) throw new Error('the commit failed')
       return OUTCOME
     })
     ```

     `calls === 1` 命中的是**第一个到达 hook 的**收尾。而
     `test/sessionManager.test.ts:1038-1043` 断言
     `manager.list().find((session) => session.id === first.id)!.outcome`
     拿到失败——`first` 是**先 start 的**那个。
3. 真正的根因：**用例把「哪一个会话失败」这件事交给了调度去决定，然后又假装
   自己知道答案**。要证的不变量（失败记在它发生的那个会话上）本身是确定的；
   不确定的只是「哪个会话失败」，而这一点用例本可以自己指定——hook 收得到
   `plan`（`src/sessionManager.ts:373`：
   `onExit: (plan: SessionPlan, baseline: DirtySnapshot) => Promise<SessionOutcome>`），
   plan 里有 `sourceId`，足以按身份认人。
   它**不是**：`shutdown()` 该改成串行（`allSettled` 的并发是
   `spec-00003-FR-9` 要的，串行会让一个卡住的收尾拖住其余）；不是
   `whenFinished` 有竞态；也不是用例该改成「谁失败都行」的弱断言——那会放掉
   「记在它发生的那个会话上」这半条。
   用例注释里那句「The failing hook is the first to run」正是这个错误前提的
   自白：并发之下没有 "the first to run"。

- Introduced by: `f914c7e`（`init`）。此前用例不存在，缺陷不可能发生。

## 4. Scope (same-cause sweep)

根因是「用 hook 的到达次数当会话身份」。扫一遍 `test/sessionManager.test.ts`
里每一处按次数分支的 `onExit`：

| Site | Same pattern | Affected | Action |
| --- | --- | --- | --- |
| `test/sessionManager.test.ts:1022-1027`（`calls === 1` 抛错） | yes | yes | fixed here |
| 其余 `makeManager(...)` 调用（用默认 `vi.fn(async () => OUTCOME)`） | no | no | 不按次数分支，对每个会话同样应答 |
| 只跑单个会话的关停/终止用例 | no | no | 只有一个会话，到达顺序即身份 |
| `src/sessionManager.ts:923-928` | 前提 | no | 并发收尾是 `spec-00003-FR-9` 要的行为，不动 |

## 5. Reproduction (test-first)

现有用例即复现用例——它断言的不变量没有错，错的是它选定失败者的方式。

```sh
for i in $(seq 10); do npx vitest run test/sessionManager.test.ts -t "wraps up every session"; done
```

- Failing test: `test/sessionManager.test.ts::wraps up every session on a
  shutdown even when one wrap-up throws` —— 红时失败在
  `expect(...find(session => session.id === first.id)!.outcome).toEqual({ problems: ['the commit failed'], … })`，
  实收 `OUTCOME`。
- 修前读数：darwin v26.5.0，十跑 **6 failed / 4 passed**；CI（ubuntu，Node 23）
  该次红，98ms。

## 6. Fix

- Change: hook 按**身份**决定失败，不按次数——`onExit` 用它收到的 `plan`
  比对 `sourceId`，只让 `first` 那一个抛错；`calls` 计数删去。同时改掉注释里
  「the failing hook is the first to run」那句错误前提。断言一字不动。
  连带一处：`makeManager`（`test/sessionManager.test.ts:52`）的 `onExit` 缺省
  值原推断为零参 mock，容不下带 `plan` 的实参，缺省值补上该形参——这是本次改动
  自己造成的类型收窄，不是无关整理。
- Why this addresses the root cause and not the symptom: 失败者由用例指定而不
  由调度指定，于是断言的前提在任何调度顺序下都成立。被测代码正确，改的只是
  断言前提。
- Alternatives rejected:
  - 断言「两个 outcome 里恰有一个是失败」 —— 放掉了「记在它发生的那个会话
    上」，而那正是 `spec-00003-AC-9.3` 要的那半条。
  - 让 `shutdown()` 串行收尾以固定顺序 —— 为迁就测试改产品，且与
    `spec-00003-FR-9` 的 settled-not-raced 相悖。
  - 加重试或 `retry: 3` —— 把间歇失败藏起来，不是修。

## 7. Verification

- 修后读数：该用例连跑十次 **10 passed / 0 failed**（修前 6 红 4 绿）。
- `npx vitest run test/sessionManager.test.ts` —— darwin v26.5.0 `76 passed`，
  Node 23.11.1 `76 passed`。
- `npm run typecheck` 无输出（通过）；`npm test` —— `74 passed (74)` /
  `2293 passed (2293)`。

## 8. Follow-through

- Detection gap: 现有测试抓不到它，因为**测试自己就是被测方**；而它在 CI 之前
  没被当回事，是因为间歇失败在本机会被下一次重跑洗掉。本 issue 记下的十跑
  红绿计数就是这条缺口的补法——凡断言里出现「第一个」而被测代码是并发的，
  先跑十次再说。不另加守卫用例。
- Doc verdict: **code was non-conformant**（此处的 code 是测试代码），docs
  unchanged。`spec-00003-FR-9` 与 `spec-00003-AC-9.3` 描述的行为与
  `SessionManager.shutdown()` 一致，无需修订，也无需新增 GWT。
- Residual state: none。

## Links

- Blocks: spec-00003-whiteboard-parallel-sessions（`FR-9` 的关停扇出、
  `AC-9.3`；这条用例是「一个收尾抛错不夺走别人的」的唯一守卫）
- Related: issue-00042-an-upgrade-refusal-waits-for-a-close-that-never-comes、
  issue-00043-a-400-kb-answer-goes-in-through-argv（同一次 CI 的另外两条）
