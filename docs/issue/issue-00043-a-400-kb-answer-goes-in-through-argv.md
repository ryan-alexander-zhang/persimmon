---
id: issue-00043-a-400-kb-answer-goes-in-through-argv
type: issue
status: open
blocks: [spec-00005-whiteboard-ask-threads]
---

# Issue: 400 KB 的答案是从 argv 递进去的，linux 上递不进去

> 「长答案要在调用结束前收齐」这条用例，把那 400 KB 的答案本身写成了子进程的
> 一个命令行参数。darwin 对单个参数不设上限，linux 设 128 KiB——同一条用例在
> CI 上以 `spawn E2BIG` 立刻失败，从来没走到它要证的那一步。

## 1. Problem

- Observed: 首次 CI（run `34438160787`，`ubuntu-latest`，`node-version: '23'`）
  九红之一：

  ```
  FAIL test/headless.test.ts > headlessSpawner > has the whole of a long answer in hand by the time the call ends
  Error: spawn E2BIG
  Serialized Error: { errno: -7, code: 'E2BIG', syscall: 'spawn' }
  ```

  用时 11ms——`spawn` 在 `execve` 上就被内核回绝了，子进程根本没有起来。
- Expected: 用例证的是 `spec-00005-FR-3` 背后的那条实现约束（`src/headless.ts:212-216`
  的注释写明）：调用在 `close` 而不是 `exit` 上结束，因此一个大到要分几个
  chunk 才发得完的答案，最后一块落在进程消失**之后**也仍然收得齐。断言应当是
  `call.printed.stdout` 长度等于整个答案、`capture()` 解得出 `resumeId`。
- Trigger: 在 linux 上跑。答案 400 000 个 `x`，包成 argv 单参后实测
  **400 066 字节**；linux 的 `MAX_ARG_STRLEN` 是 `PAGE_SIZE * 32` = 131 072
  字节，单个参数超过它即 `E2BIG`，与 `ARG_MAX`（总量）无关。darwin 只限总量、
  不限单参，所以本机 v26.5.0 与 v23.11.1 下这条都绿。

## 2. Impact

- Affected: linux 上的每一次 `npm test`——也就是 CI 的每一次。**产品代码不受
  影响**：这条路径上被测的 `headlessSpawner`（`src/headless.ts:196-222`）从未
  被执行到。
- Since: `f914c7e`（2026-09-04，`init`，用例随 `test/headless.test.ts` 一同落地）
  · Still occurring: yes
- Severity: 中。它挡 CI，但它挡的是一条**从未在 linux 上生效过的守卫**——
  `close`-not-`exit` 这条约束在 linux 上一天也没被守过；红的代价小于「以为它绿」
  的代价。

## 3. Root Cause (first principles)

1. 分歧：用例要的是「子进程**打印**一个 400 KB 的字符串」，写下的却是
   「把这 400 KB 的字符串**交给** 子进程」。前者只经过 pipe，后者要经过 argv。
2. 最小机制：`test/headless.test.ts:155`

   ```ts
   const call = run('node', ['-e', `process.stdout.write(${JSON.stringify(answer)})`])
   ```

   模板字面量把整个 `answer` 内联进 `-e` 的脚本文本，于是这一个 argv 条目长
   400 066 字节。`run()`（`test/headless.test.ts:21-22`）原样交给
   `headlessSpawner(...)(command, args, …)`，最终落到 `src/headless.ts:198` 的
   `spawn(command, args, …)` → `execve`，内核按 `MAX_ARG_STRLEN` 逐参检查后返回
   `E2BIG`。
3. 真正的根因：**用例把「生成数据」和「传输数据」放在了同一侧**。要证的是
   stdout 管道能把大负载分块送齐，而管道的容量与 argv 的容量是两个互不相干的
   内核限额；把负载塞进 argv，等于让用例先去撞一个与被测行为无关的墙。
   它**不是**：`headlessSpawner` 处理不了大输出（它从未被调用）；不是
   `spec-00005-FR-3` 的口径有问题；也不是 400 KB 这个量级选得不对——量级正是
   为了跨越单个 pipe 缓冲区，该保留。

- Introduced by: `f914c7e`（`init`）。此前用例不存在，缺陷不可能发生。它在
  darwin 上长期显不出来，因为 darwin 的 `execve` 不设单参上限；`93bb290`
  （2026-09-08）落下 ubuntu CI 的第一跑就撞上了。

## 4. Scope (same-cause sweep)

根因是「把一份超过 128 KiB 的负载放进单个 argv 条目」。全仓扫一遍所有
`spawn` / `-e` 的调用点：

| Site | Same pattern | Affected | Action |
| --- | --- | --- | --- |
| `test/headless.test.ts:155` | yes | yes | fixed here |
| `test/headless.test.ts` 其余 `run('node', ['-e', …])` | yes | no | 脚本文本均在数十字节量级 |
| `test/server.test.ts` / `test/sessionManager.test.ts` 的 `['-e', …]` 夹具 | yes | no | 同上，全部远低于 128 KiB |
| `src/headless.ts:146`（`{question}` 代入 argv） | **yes** | **yes（产品侧，本 issue 不修）** | 见下 |
| `src/headless.ts:198`（`spawn`） | 前提 | no | 传输者，非源头 |

**产品侧的同源观察（记录，不在本 issue 修）**：`headlessArgs`
（`src/headless.ts:135-153`）把用户提问原样代入 `{question}` 占位符，成为 CLI
的一个 argv 条目。一条超过 128 KiB 的提问在 linux 上会撞同一堵墙，`spawn` 抛
`E2BIG`，按 `src/headless.ts:223-226` 的口径收作一次失败调用。这是真实可达的
输入路径（提问由人在前端输入，`spec-00005-FR-1`），但它是**另一条**缺陷、需要
另一份 root cause（谁来限长、限在哪一层、超长时给什么提示），且改它要动产品
代码与 `spec-00005` 的口径。本 issue 只负责测试侧，把它记在这里以免同源被漏。

## 5. Reproduction (test-first)

现有用例即复现用例——它断言的行为没有错，错的是负载的送达通路。

- Failing test: `test/headless.test.ts::has the whole of a long answer in hand
  by the time the call ends` —— 在 linux 上以 `Error: spawn E2BIG` 失败
  （CI run `34438160787`，`2026-09-10T04:45:02.79Z` 一行）。
- 单参字节数可在任意平台核出，无需 linux：

  ```sh
  node -e "const a=JSON.stringify({result:'x'.repeat(400000),session_id:'cli-7'});
           console.log(Buffer.byteLength(\`process.stdout.write(\${JSON.stringify(a)})\`))"
  # → 400066   （> MAX_ARG_STRLEN = 128 * 1024 = 131072）
  ```

- 修前读数：linux（CI，Node 23）该条红，`Error: spawn E2BIG`；
  darwin v26.5.0 与 v23.11.1 下 `test/headless.test.ts` 14 条全绿——darwin 不设
  单参上限，本机复现不出来，这一条只有 CI 证据加上上面的字节数核算。

## 6. Fix

- Change: 长串改在子进程内生成——`-e` 的脚本文本里写
  `'x'.repeat(400_000)`，只有几十字节过 argv；`answer` 仍留在测试侧，作为期望
  长度的量尺。断言与量级都不变。
- Why this addresses the root cause and not the symptom: 负载不再走 argv，只走
  被测的那条通路（子进程 stdout → pipe → `headlessSpawner` 的 chunk 收集），
  用例从此只受它要证的那一个限额约束。
- Alternatives rejected:
  - 把答案落到临时文件、子进程读文件再打印 —— 多一个 I/O 依赖与一次清理，
    换不来任何额外覆盖。
  - 把量级降到 128 KiB 以下 —— 那就不再跨越 pipe 缓冲区，用例要证的
    「多 chunk 在 exit 之后到齐」随之失效。
  - 给用例加 `skipIf(process.platform === 'linux')` —— 恰好跳过唯一跑 CI 的
    平台，等于删掉这条守卫。

## 7. Verification

- 修后读数：`test/headless.test.ts` —— darwin v26.5.0 `14 passed`，
  Node 23.11.1 `14 passed`。子进程的 `-e` 脚本文本现为 90 字节。
- `npm run typecheck` 无输出（通过）；`npm test` —— `74 passed (74)` /
  `2293 passed (2293)`。
- 真正的证据要等下一次 ubuntu CI：本条的判据是 `spawn E2BIG` 不再出现，且该
  用例走到它的三条断言。

## 8. Follow-through

- Detection gap: 现有测试抓不到它，因为**测试自己就是被测方**，且唯一能暴露它
  的是平台差异。缺口是「本仓库在 `93bb290` 之前从未在 linux 上跑过测试」，CI
  已经补上；不另加守卫——为一条内核限额再写一条用例，只会把同一个平台细节钉在
  第二处。
- Doc verdict: **code was non-conformant**（此处的 code 是测试代码），docs
  unchanged。`spec-00005-FR-3` 与 `spec-00005-AC-3.1` 的口径与产品实现一致。
  §4 记下的产品侧 `{question}` 超长路径**尚未定性**：它可能需要 `spec-00005`
  追一条 Unwanted 条款，但那要由域主裁定，不在本 issue 认领。
- Residual state: none。

## Links

- Blocks: spec-00005-whiteboard-ask-threads（`FR-3` 的调用生命周期；这条用例是
  「答案收齐才算结束」这半条的唯一守卫）
- Related: issue-00042-an-upgrade-refusal-waits-for-a-close-that-never-comes、
  issue-00044-a-shutdown-hook-counts-arrivals-instead-of-naming-one（同一次 CI
  的另外两条）
