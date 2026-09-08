---
id: plan-00032-native-directory-picker
type: plan
status: resolved
implements: [spec-00011-FR-22, spec-00011-FR-23, spec-00011-FR-24, design-00002-whiteboard-ui, design-00003-multi-workspace]
---

# Plan: 添加 workspace 时用原生对话框选目录，而不是键入路径

> 添加对话框的路径字段旁加一个「浏览」按钮，服务端弹出操作系统的目录选择对话框，
> 选定的绝对路径回填输入框；键入路径这条路原样保留，作为它开不了时的退路。
> 落 `spec-00011` 第三十轮的 FR-22、FR-23 与 FR-24。

## Design

- [design-00003-multi-workspace](../design/design-00003-multi-workspace.md) ——
  §5 `POST /api/pick-directory` 的五种回答、`osascript` 的实测口径与 Origin
  校验、§7 在飞的对话框不得挂住关停、§11 平台耦合这笔交易。
- [design-00002-whiteboard-ui](../design/design-00002-whiteboard-ui.md) ——
  §3「浏览目录」一行：按钮位置、`disabled` 只管同一个页面（「至多一个」在
  服务端）、`{path: null}` 与 409 / 503 各自的呈现。

## Tasks

**前置**：本轮降为 `draft` 的三份 living doc（`spec-00011`、`design-00002`、
`design-00003`）须在 T1 开工**之前**重新接收为 `active`——`CLAUDE.md` §8
不许对着 `draft` 写代码，`AUTOPILOT.md` 也把 spec 阶段的出口定在 `active`。
这不是本 plan 的任务，是本 plan 能开工的条件。

T1 与 T2 互相独立、可并行（一个服务端一个前端，靠 §5 的契约对接）；T3 依赖
两者；T4 收口。

- **T1 — 目录选择端点** (spec-00011-FR-22, FR-23, FR-24)：新增
  `src/directoryPicker.ts`——`pickDirectory()` 以 `spawn`（**不经 shell**；
  脚本是固定的 `-e` 字面量，路径只从 stdout 回来，故没有任何路径内容被拼进
  命令）起 `osascript`，按 design-00003 §5 判三种收场（0 → 去尾分隔符后的路径，
  根目录 `/` 除外；非零且 stderr 含 `-128` → 取消；其余非零 → 开不了），
  非 macOS 直接作「开不了」而不起子进程。`Host` 挂
  `POST /api/pick-directory`（200/200-null/409/503 + 非同源 403），持有**至多
  一个**在飞子进程，`stop()` 一进来就杀掉它，`req` 的 `'close'` 也杀
  （design-00003 §5、§7）。
- **T2 — 浏览按钮** (spec-00011-FR-22, FR-23, FR-24)：`web/src/WorkspaceSwitcher.tsx`
  的 `AddWorkspaceDialog` 中路径输入右侧加按钮，`web/src/api.ts` 的 `hostApi`
  加 `pickDirectory()`；请求在飞时按钮 `disabled`；`{path}` 回填输入框
  （不提交）、`{path: null}` 什么都不做、403 / 409 / 503 走既有的 `toast.error`。
- **T3 — 测试** (spec-00011-AC-22.1…AC-24.3)：`test/directoryPicker.test.ts`
  以注入的假 spawn 覆盖三种收场、尾分隔符规范化与根目录例外；
  `test/host.test.ts` 覆盖端点四种状态码、非同源 403、「第二次请求 409」、
  「关停杀掉在飞子进程」与「客户端中断也杀」；
  `web/test/workspaceSwitcher.test.tsx` 覆盖回填不提交、在飞时 disabled、
  取消不动字段、开不了时出 toast 且仍可键入提交、再点一次仍出同一句。
  **`AC-24.1`/`AC-24.2` 的「本机开不了」在单元层以假 spawn 成立**——真实的
  无图形会话要一台没有 GUI 的机器，属 TESTING.md 的 E2E 层，本轮不做，
  理由记在 record（`TESTING.md` 把 E2E 限于关键流程与最值得的失败路径，
  而该分支的 `Then` 在缝上已被钉住）。
- **T4 — 验收与记录**：交付范围内每条 AC 一行；`AC-22.1` 与
  `AC-23.1` 另各做一次**真机手工验证**（真的弹一次 Finder：选定一次、取消
  一次，并确认窗口来到最前），因为单元层钉住的是端点与前端的契约，弹窗本身
  钉不住；质量门不降；写 `record`。

## Detailed Acceptance Path

1. 端点三种收场各自成立 → verify: `npm test` 中 `test/directoryPicker.test.ts`
   与 `test/host.test.ts` 的相关用例全绿。
2. 对话框开着时关停**及时**完成 → verify: `test/host.test.ts` 的守卫断言
   `shutdown()` 在 **1 s 内** settle。上界不取 `bounded` 的 5 s——`issue-00033`
   已证那比这一类缺陷本身还宽，「settle 了」在缺陷上照样是绿的。
3. 真机手工验证两次 → verify: 点「浏览」弹出 Finder **并来到最前**，选定后
   输入框呈现该目录的绝对路径且不以 `/` 结尾；再点一次「浏览」并取消，输入框
   不变、无错误提示。
4. 交付范围内每条 AC 在 record 中有 pass 行 → verify: `docs/record/` 中
   `parent` 指向本 plan 的那份。
5. 本 plan 过 `open → resolved` → verify: 归档门与 resolved 门清（`rule-00001-BR-25`）。
