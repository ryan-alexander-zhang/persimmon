---
id: issue-00030-npx-leaves-the-pty-spawn-helper-non-executable
type: issue
status: resolved
blocks: [spec-00011-multi-workspace]
---

# Issue: `npx` 形态下 node-pty 的 `spawn-helper` 没有可执行位，会话一起就崩

> 以 `npx --package <包> persimmon` 运行时，npm 不跑任何安装脚本——node-pty 自己
> 的 `post-install`、我们的 `postinstall` 都不跑——`spawn-helper` 停在 0644。
> `list`、`add`、启动与切换都正常，第一次发起 agent 会话时 pty 以
> `posix_spawnp failed` 起不来。`spec-00011-FR-20`「两种安装形态下命令行为
> 相同」对会话这一半不成立。

## 1. Problem

- Observed: `npm run test:install`（issue-00029 §7 的实测）在 `npx` 缓存里
  查得 `node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper` 为
  `-rw-r--r--`（0644），带与不带 `--allow-scripts` 皆然；全局安装
  （`npm install -g`）下同一文件为 0755。
- Expected: 两种安装形态下会话都能起——node-pty 的 pty 进程靠这个 helper
  `exec`，位不对即 `posix_spawnp failed`（`scripts/fix-pty-permissions.js:1-5`
  的注释写的就是这条失败）。
- Trigger: 任何 `npx` 形态的运行里发起推进、澄清、审计或共写会话。

## 2. Impact

- Affected: 用 `npx @ryan-alexander-zhang/persimmon` 而不做全局安装的每个人；
  `list`/`add`/`remove`/启动/切换/答疑之外的一切会话形态。
- Since: 包可安装之日（`07fc1a7`，plan-00027 T2） · Still occurring: yes
- Severity: 中高。CLI 层面的验收（`spec-00011-AC-20.1`/`AC-20.2`）全过，缺陷藏在
  第一次开终端时——正是「装好了、能列出、一用就崩」那类最伤信任的失败。

## 3. Root Cause (first principles)

1. 分歧：同一份 tarball，全局安装得到 0755 的 helper，`npx` 缓存得到 0644。
2. 最小机制：可执行位从来不是 tarball 带来的——npm 解包不保留它；它由**安装
   脚本**补上：node-pty 自己的 `post-install`，或我们的
   `scripts/fix-pty-permissions.js:13-15`（`package.json:19` 的 `postinstall`）。
   npm ≥ 11.17 缺省拦住依赖的安装脚本；`npm install -g` 仍跑**根包**的
   `postinstall`（本包），所以位被我们补回；`npx --package` 的缓存安装
   **两者都不跑**（issue-00029 §7.6 实测四格），没有任何一方补位。
3. 真正的根因：**把「helper 必须可执行」这条运行前提押在安装期脚本上**，而安装
   期脚本在 npm 的策略下并不保证执行。`fix-pty-permissions.js` 的存在本身
   就是对同一前提的一次修补（它补 node-pty 脚本被拦的情形），只是补在了同一个
   不可靠的时点。
   它**不是**：node-pty 的预编译产物缺失（四格里文件都在）；不是 issue-00029
   的类型剥离问题（那条已修，`list` 两种形态都过）；也不是 npm 的 bug——不跑
   缓存安装的脚本是它的策略。

- Introduced by: `07fc1a7`（本仓库首次成为可安装的包）；此前没有 `npx` 形态，
  缺陷不可能发生。`fix-pty-permissions.js` 更早（模板期）就在，它处理的是
  `npm install` 一侧，pre-dates the repo。

## 4. Scope (same-cause sweep)

机制是「运行前提押在安装脚本上」：

| Site | Same pattern | Affected | Action |
| --- | --- | --- | --- |
| `scripts/fix-pty-permissions.js`（`postinstall`） | yes | yes | 提案：同一逻辑改在运行时首次 spawn 前执行 |
| node-pty 自己的 `post-install` | yes | yes | 上游行为，不改；运行时补位覆盖它 |
| `prepack`（`npm run build`） | no | no | 发布端脚本，发布者自己跑 |

## 5. Reproduction (test-first)

- 失败复现不宜进默认套件：它需要 `npx` 的缓存安装（要 registry、几十秒），属
  TESTING.md 的 E2E/smoke 层。`npm run test:install` 已在两种形态各跑一次
  `list`，本 issue 的验证在它上加一格：安装后检查 helper 的 mode 是否含可执行
  位，并**实际起一个 pty**（`node -e` 调 node-pty `spawn('true')`）。
- 修复前该格在 `npx` 形态下红：mode 0644，`spawn` 抛 `posix_spawnp failed`。
- 默认套件里可以有单元级守卫：对 `ptySpawner` 的「首次 spawn 前确保 helper
  可执行」逻辑，用临时文件模拟一个 0644 的 helper 路径，断言 spawn 前被
  chmod 成 0755。

## 6. Fix

*已施加（plan-00027 已 `resolved`，本修复作为独立 issue 修复落地）。*

- Change: 把 `fix-pty-permissions.js` 的逻辑搬到**运行时**：`src/pty.ts` 新增
  `ensureExecutable(path)`，`ptySpawner` 在每次 `spawn` 前对
  `node_modules/node-pty/prebuilds/<platform>-<arch>/spawn-helper` 做一次
  `chmodSync(0o755)`（路径经 `createRequire(import.meta.url).resolve('node-pty')`
  解析，仓内 / 全局 / `npx` 三种布局同解）；文件不存在（Windows）或无权改动时
  吞掉错误，留给 node-pty 自己的 spawn 报错点名。每次 spawn 都 chmod 而不「记住」
  ——一次 syscall，比一个模块级状态便宜。`postinstall` 保留为快路径，且覆盖
  「以 root 全局安装、以普通用户运行」这一运行时无权 chmod 的情形。
- Why this addresses the root cause and not the symptom: 前提在**用到它的那一刻**
  由用到它的代码自己保证，不再依赖任何安装期脚本是否被 npm 放行；三种安装形态
  （仓内、全局、`npx`）与将来任何 npm 策略变化下同解。
- Alternatives rejected: README 里让用户 `--allow-scripts`——`npx --package`
  即便带上也不跑（§7.6 实测），且把正确性交给用户；不再依赖 node-pty 的
  prebuild 改自行编译——引入 node-gyp 与工具链，比一次 chmod 重两个量级。

## 7. Verification

已执行（仓库根，修复已施加）：

1. **§5 的单元守卫，红→绿**：`test/pty.test.ts` 两条（0644 的临时 helper 经
   `ensureExecutable` 后为 0755；不存在的路径不抛）。施加前
   `ensureExecutable` 不存在，`Tests 2 failed (2)`；施加后 `2 passed`。
2. **`npm run test:install` 的新增两格**（每种形态：读 helper 的 mode，再经该
   安装副本自己的 `lib/pty.js` 实起一个 pty 跑 `true`）：
   `global spawn-helper: 755 before the first spawn`、
   `npx spawn-helper: 644 before the first spawn`，两格的 pty 都以 0 退出，
   整轮 `both installed forms answered … — ok`。npx 那一格是 §1 的 0644
   现场——修复前的死路，现由运行时 chmod 带过。
3. **红侧在真实 npx 缓存副本上复现**：把该副本 node-pty 的 helper 手动改回
   0644，直接调 node-pty `spawn('true')` → `posix_spawnp failed.`；同一状态下
   经 `lib/pty.js` 的 `spawnPty` → `exit 0`，事后 helper 为 0755。
4. `npm run typecheck` 无输出（通过）。`npm run build` 成功（`test:install` 的
   `prepack`）。
5. `npm run test:coverage`：`Test Files 72 passed (72)` / `Tests 2077 passed
   (2077)`（2075 原有 + §5 两条）；门槛未动，实得 Statements 98.63 %、
   Branches 95.29 %、Functions 98.67 %、Lines 99.36 %；`src/pty.ts`
   96.55/90.9/100/96.15。

## 8. Follow-through

- Detection gap: `spec-00011` §7 的实测义务只写了「`list`」，而 `list` 不开 pty；
  issue-00029 的修复者在做实测时多看了一眼文件 mode 才发现。§7 的实测应扩到
  「起一个 pty」。
- Doc verdict: **doc was incomplete**——`spec-00011` §7 的验证义务须加「两种形态
  各实起一个 pty」，随其下一次修订轮（plan-00027 T1 的回填清单）一并改。
- Residual state: 已用 `npx` 形态装过的缓存条目里 helper 仍是 0644；运行时修复
  落地后首次 spawn 即自愈，无需用户处理（§7 第 3 条正是这一路径的实测）。
  `spec-00011` §7 的实测义务尚未改字——仍随其下一次修订轮回填
  （plan-00027 T1 第 (6) 条）。

## Links

- Blocks: spec-00011-multi-workspace（FR-20 的「两种形态行为相同」）
- Related: issue-00029-a-shipped-ts-source-cannot-run-from-node-modules（同一次实测
  发现；不同机制）、plan-00027-multi-workspace
