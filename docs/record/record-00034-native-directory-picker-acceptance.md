---
id: record-00034-native-directory-picker-acceptance
type: record
status: active
parent: plan-00032-native-directory-picker
verifies: [spec-00011-multi-workspace]
---

# 验收记录：原生目录选择对话框

对 [plan-00032-native-directory-picker](../plan/plan-00032-native-directory-picker.md)
的验收。交付范围为 `spec-00011` 第三十轮新增的 `FR-22`、`FR-23`、`FR-24` 与其
11 条 AC。范围外不一并验收：`record-00028` 追注的 `AC-7.4`/`AC-20.3` 属上一轮，
其余 87 条由 `record-00028` 持有。T1（端点）与 T2（按钮）并行落地，T3 补测试，
本记录是 T4 的收口。测试路径相对仓库根。

## 质量门

命令均在仓库根执行：

- `npm test`：退出码 0，73 个文件、2100 个测试全部通过。
- `npm run typecheck`：退出码 0，`tsc --noEmit` 无输出。
- `npm run test:coverage`：退出码 0，statements 98.59% / branches 95.25% /
  functions 98.68% / lines 99.35%。`vitest.config.ts` 的 90 门槛一字未改，
  无被压制的发现。本轮新增或改动的三个文件：
  `src/directoryPicker.ts` 96.66 / 92.30 / 100 / 96.15（未覆盖的是非 macOS 的
  早退分支，只在别的平台执行——`test/directoryPicker.test.ts` 的对应用例在
  macOS 上 skip，这是平台条件而非缺口）；`src/host.ts` 97.14 / 94.52 / 97.36 /
  98.70；`web/src/WorkspaceSwitcher.tsx` 100 / 97.36 / 100 / 100。
- `npm run build`：退出码 0。

一次覆盖率运行中 `refuses a second dialog and leaves the first one alone`
偶发失败：第一个对话框原以 `setTimeout(50 ms)` 结束，若其前的 `vi.waitFor`
超过 50 ms，第一个已收工、第二次自然得到 200 而非 409。已改为由测试显式放行，
其后单条连跑三次、整体两次均无失败。**这是测试自身的竞态，不是产品缺陷**。

## 手工验证（测试钉不住的那一半）

单元层钉住的是端点与前端的契约；对话框本身是否弹出、是否来到最前，只有真机
能答。以下两次经 `lib/`（`npm run build` 的产物，即安装后实际运行的那份）
调用真实 `osascript`，由域主在本机操作：

1. **选定**（`spec-00011-AC-22.1`）：弹出 Finder，域主选定
   `<projects>/topics-hunter` 并确认。
   返回 `{"kind":"picked","path":"<projects>/topics-hunter"}`
   ——**不以分隔符结尾**，与 AC 一致。
2. **取消**（`spec-00011-AC-23.1`/`AC-23.3`）：弹出 Finder，域主点 Cancel。
   返回 `{"kind":"cancelled"}`，耗时 2354 ms（即等到人做出选择为止），
   **不是失败、无错误**。

`tell application "System Events" to activate` 一句的效果（窗口来到最前）在
两次中均未被域主报告为异常。**它没有被独立断言**——「最前」不是本进程能读到
的状态，只有人眼可判；本记录只记「两次均弹出且可操作」。

## 验收清单

| AC | 证据 | 结果 |
| --- | --- | --- |
| spec-00011-AC-22.1 | test/directoryPicker.test.ts::gives back the chosen directory without its trailing separator + test/host.test.ts::answers the chosen directory + web/test/workspaceSwitcher.test.tsx::puts the directory the dialog gave back into the path field + 上文手工验证第 1 项 | pass |
| spec-00011-AC-22.2 | test/directoryPicker.test.ts::leaves the root as the root | pass |
| spec-00011-AC-22.3 | web/test/workspaceSwitcher.test.tsx::registers nothing until Add is pressed | pass |
| spec-00011-AC-22.4 | test/host.test.ts::refuses a second dialog and leaves the first one alone（409 那一半）+ test/directoryPicker.test.ts::is busy only while a dialog is open | pass |
| spec-00011-AC-22.5 | test/host.test.ts::refuses a second dialog and leaves the first one alone（第一个照常返回那一半） | pass |
| spec-00011-AC-23.1 | test/host.test.ts::answers a cancel with no path and no error + web/test/workspaceSwitcher.test.tsx::leaves the typed path and stays quiet when the dialog is cancelled + 上文手工验证第 2 项 | pass |
| spec-00011-AC-23.2 | test/directoryPicker.test.ts::reads the cancel code as a cancel, not an error（取消后 picker 复位，`busy` 回到 false，下一次照常起） | pass |
| spec-00011-AC-23.3 | web/test/workspaceSwitcher.test.tsx::leaves the typed path and stays quiet when the dialog is cancelled（断言 `toast.error` 未被调用） | pass |
| spec-00011-AC-24.1 | test/directoryPicker.test.ts::reads any other failure as one it cannot open + test/host.test.ts::answers 503 when the dialog cannot be opened here + web/test/workspaceSwitcher.test.tsx::says why it could not open, and says it again on the next try | pass |
| spec-00011-AC-24.2 | test/host.test.ts::says the same thing on the next activation + web/test/workspaceSwitcher.test.tsx::says why it could not open, and says it again on the next try（两次调用的文案逐字相同） | pass |
| spec-00011-AC-24.3 | web/test/workspaceSwitcher.test.tsx::still adds a workspace typed by hand when the dialog cannot open | pass |

11 条 AC 各有一行，全部 pass。范围外另有四条守卫，不占清单行但一并记下：
`test/host.test.ts` 的 `refuses a request a foreign site sent`、
`refuses an origin it cannot parse`、`takes a loopback origin whatever its port`
（design-00003 §5 的 Origin 规则，spec 未立 FR——见下节）与
`ends an open dialog when the shutdown starts`（design-00003 §7）。

## 只钉住半边的 AC

- `spec-00011-AC-23.2`「目录选择对话框照常打开」——所钉的是取消之后 picker
  不再 busy、下一次 `pick()` 照常起子进程；「对话框真的又弹出来一次」属手工
  验证的范畴，本轮的两次手工验证是先选定后取消，没有再做第三次。
- `spec-00011-AC-24.1`/`AC-24.2` 的「本机开不了」以假 spawn 在缝上成立。
  **真实的无图形会话未验**——它要一台没有 GUI 的机器，属 `TESTING.md` 的
  E2E 层，本轮不做（`TESTING.md` 把 E2E 限于关键流程与最值得的失败路径）。

## 实现期的既定取舍

- **Origin 规则宽到「任意回环端口」而不比端口**：`bin/persimmon.js` 打印
  `http://localhost:PORT` 而 `listen` 绑 `127.0.0.1`，`npm run dev` 的 vite 代理
  又以自己的 `localhost:5173` 转发——比端口会把用户自己的每一次「浏览」403 掉。
  放宽不丢防护：能在回环上架站的人本就能直接调该端点。这是本仓库第一处
  origin 处置，`spec-00011` 未为它立 FR（它是 design 层的实现约束，
  design-00003 §5 持有），故其三条守卫不占验收清单行。
- **`AC-22.4` 的「至多一个」由服务端持有**：前端按钮的 `disabled` 只管同一个
  页面，两个标签页各点一次时管不着。
- **平台**：只实现 macOS。别的平台未实现也未实测；FR-24 是这条取舍的兜底。

## Links

- Parent: [plan-00032-native-directory-picker](../plan/plan-00032-native-directory-picker.md)
- Verifies: [spec-00011-multi-workspace](../spec/spec-00011-multi-workspace.md) 的 FR-22 / FR-23 / FR-24
- Design: [design-00003-multi-workspace](../design/design-00003-multi-workspace.md) §5 §7 §11 · [design-00002-whiteboard-ui](../design/design-00002-whiteboard-ui.md) §3
