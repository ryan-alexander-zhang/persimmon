---
id: issue-00040-a-dead-requirement-still-reads-as-a-gap
type: issue
status: open
blocks: [spec-00012-persimmon-command, spec-00011-multi-workspace]
---

# Issue: 一条已作废的需求在检视面板上仍读作缺口

> 第三十三轮只给 AC 侧开了 `作废` 标记位。整条作废的需求因此在面板上读
> 「未覆盖」，而 `record-00035` 十六行 `待人工实测` 的过期证据把另一批条目
> 永久钉在「未通过」——门不受影响，失真的只是人看的那一面。

## 1. Problem

- Observed: 以全部 record 为证据集（`spec-00001-FR-32` 给检视面板与
  `spec-00002-FR-10` 的全局覆盖视图定的证据集）读第三十三轮之后的 `spec-00012`
  与 `spec-00011`：
  - `spec-00012-FR-6` / `FR-7` / `FR-8` 读 **`uncovered`**——三条整条作废，
    其 AC 全为墓碑（`AC-6.1`/`6.2`、`AC-7.1`…`7.3`、`AC-8.1`/`8.2`，各带一行
    `pass`），于是「计入的 AC」为空，落进 `FR-32`「没有任何计入的 AC」那一支，
    与零 AC 同判。
  - `spec-00012-FR-5` / `FR-11` 读 **`failing`**——两条同样整条作废，但它们的
    墓碑 AC（`AC-5.1`/`5.2`、`AC-11.1`…`11.5`）上各挂着 `record-00035` 的一行
    `待人工实测`，非 `pass` 先命中。
  - `spec-00012-FR-3` / `FR-4` / `FR-10` 与 `spec-00011-FR-20` 读 **`failing`**
    ——这一批的非 `pass` 行落在**现行** AC 上（`AC-3.1`/`3.3`、`AC-4.1`…`4.3`、
    `AC-10.1`/`10.2`、`spec-00011-AC-20.1`），与墓碑无关。
  `record-00035` 的十六行 `待人工实测` 正好一半（八行：`AC-3.2`、`5.1`、`5.2`、
  `AC-11.1`…`11.5`）落在墓碑 AC 上，另一半落在现行 AC 上。
- Expected: 一条**已作废**的需求既不欠验收、也没有失败——它不该读「未覆盖」
  （那是假缺口），也不该读「未通过」（那是对一件不存在的事报警）。一条**现行**
  需求的读数应由**仍然成立**的证据决定，而 `record-00035` 测的是第三十二轮已被
  回退掉的两产物形态。
- Trigger: 一份 spec 里有整条作废的需求，或有一份 `active` 的 record 其所测形态
  已被后续修订轮推翻。两者都是「文档改了、既有证据没有退役通路」的同一个面。

## 2. Impact

- Affected: 只影响**人看的那一面**——检视面板（`spec-00001-FR-31`…`FR-33`）与
  全局覆盖视图（`spec-00002-FR-10`）。九条需求的读数是假的：三条假缺口
  （`FR-6`/`FR-7`/`FR-8`），六条假报警（`FR-3`/`FR-4`/`FR-5`/`FR-10`/`FR-11`、
  `spec-00011-FR-20`）。
- **门不受影响**：`spec-00001-FR-52` 把证据集另限为 `parent` 指向该 plan 的
  record，`record-00035` 的 `parent` 是 `plan-00033`（已 `wontfix`），够不着
  `plan-00034` 的门；那五条整条作废的 FR 也不在任何 plan 的 `implements` 里。
- Since: 第三十二轮（`e8a1bb7`，形态回退使 `record-00035` 的证据过期）与第
  三十三轮（AC 侧标记落地，把 `FR-6`/`FR-7`/`FR-8` 从假「已验证」翻成假
  「未覆盖」）· Still occurring: yes
- Severity: 中。它不挡任何流转，也不产生错误数据；代价是覆盖视图上长期挂着九条
  读不准的条目，而覆盖视图的全部价值就是「缺口一眼看得见」。数目只增不减：往后
  每一次形态回退都会再留下一批过期证据。

## 3. Root Cause (first principles)

1. 分歧：文档侧说这些断言已经作废、这些证据已经过期；机器侧的覆盖推导既不知道
   一条需求可以整条作废，也不知道一行验收行可以过期。
2. 最小机制，两处：
   - `docs/spec/README.md` 的条目文法**只在 AC 的归属标注上**开了 `作废`
     token，条目声明行没有这一位（第三十三轮的编排者裁定：FR 侧要连改
     `spec-00002-FR-10`/`FR-11` 的全局计数、`design-00001` §7 的 API、
     `design-00002` §2/§9 的呈现与 `web/src/coverageMarks.ts`，那一轮不背）。
     整条作废的需求因此只能靠「AC 全为墓碑」被间接看出，而
     `spec-00001-FR-32`（实现在 `src/requirements.ts:204-205`）把「计入的 AC
     为空」与「一条 AC 都没有」判成同一态。
   - record 一经 `active` 即不可改（`docs/record/README.md:63-68`：更正只能另开
     一份新 record），而覆盖推导**没有任何证据退役的通路**——
     `coverageOf`（`src/requirements.ts:201-206`）把每一份 record 的每一行等价
     看待，非 `pass` 先命中先出，一行 `待人工实测` 就此永久有效。新写一份
     record 只能**加**行，加不出「前一行不再作数」。
3. 真正的根因：**覆盖三态的入参里没有时间**。条目文法与验收行文法都只表达
   「是什么」，不表达「到哪一轮为止是什么」；而 spec 的修订轮与 plan 的作废
   （`plan-00033` → `wontfix`）恰恰是在改这件事。留 id 与不改 record 各自都是
   刻意的（`decision-00005` §1 的断链事故、`docs/record/README.md` 的 Note），
   合起来就必然攒下一批读不准的条目。
   它**不是**：第三十三轮的墓碑标记做错了（那一半正确且必要，见
   `issue-00039`）；不是门读错了（`FR-52` 的另限证据集已经把它挡在外面）；也不是
   `record-00035` 写错了——它如实记下了当时的读数。

- Introduced by: `e8a1bb7`（第三十二轮，形态回退令 `record-00035` 的十六行实测
  义务失去对象）与本轮（第三十三轮，AC 侧标记落地）。此前 `FR-6`/`FR-7`/`FR-8`
  读「已验证」——同样是假的，只是方向相反；这一条从来没有一刻是准的。

## 4. Scope (same-cause sweep)

| Site | Same pattern | Affected | Action |
| --- | --- | --- | --- |
| `docs/spec/README.md` 的条目声明文法（无 FR 侧 `作废`） | yes | yes | 候选修法 ① 的落点 |
| `src/requirements.ts:204-205`（`coverageOf` 的 `uncovered` 一支） | yes | yes | 「计入的 AC 为空」与「零 AC」同判，随 ① 一起变 |
| `src/requirements.ts:201-203`（非 `pass` 先命中） | yes | yes | 过期证据从这里进来；候选修法 ② 的落点 |
| `docs/record/README.md:63-68`（record 不可改） | 前提 | — | 不动：它是刻意的，问题在没有**别的**退役通路 |
| `src/resolvedGate.ts:71-79`（`resolvedGaps`） | 消费方 | no | `FR-52` 已把证据另限为 `parent` 指向该 plan 的 record |
| `web/src/CoverageView.tsx`、`web/src/coverageMarks.ts` | 呈现 | yes（症状） | 读同一份 `coverage`，无独立改动 |
| `spec-00012-FR-5` … `FR-8`、`FR-11` | yes | yes | 整条作废，五条 |
| `spec-00012-FR-3` / `FR-4` / `FR-10`、`spec-00011-FR-20` | 后一半机制 | yes | 现行需求被过期证据钉住，四条 |

## 5. Reproduction (test-first)

现场复现（无需代码，读当前仓库即可）：以全部 record 为证据集跑
`requirementViewFrom(spec-00012, scanRecords(docs/record/**))`，`FR-6`/`FR-7`/
`FR-8` 的 `coverage` 为 `uncovered`，`FR-3`/`FR-4`/`FR-5`/`FR-10`/`FR-11` 为
`failing`。

守卫用例要等修法裁定后才写得出——三条候选各自的断言不同（①「整条作废的条目不
落进 uncovered」、②「parent 已 `wontfix` 的 record 的行不参与推导」、③ 无用例）。
本 issue 只固定复现路径，不预写用例。

## 6. 候选修法（未裁定）

| # | 修法 | 代价 |
| --- | --- | --- |
| ① | 条目声明行也开 `作废` token，整条作废的需求**不携带覆盖状态**（或第四态「已作废」） | 要连改 `spec-00001-FR-31`/`FR-32`、`spec-00002-FR-10`/`FR-11`、`design-00001` §7 的 API 形状、`design-00002` §2/§9 的呈现与 `web/src/coverageMarks.ts`。只解前一半——过期证据仍在 |
| ② | 按 record 的 `parent` plan 的状态过滤证据（`wontfix` 的 plan 下的 record 不参与面板推导） | 违反 `decision-00004` §5 裁定二「覆盖推导不区分 record 的 status」的精神——那条裁定说的是 record 自己的 status，本条改的是 parent 的，须由域主**追注**该裁定。只解后一半 |
| ③ | 接受这个读数，在 spec 的 §Acceptance 处以散文说明 | 零代价，但覆盖视图从此需要一份「哪些读数不要信」的口传清单——正是 `issue-00039` 判为根因的那种形态 |

两半是两个机制，可以分别裁定；①②同取才能让九条全部读准。本 issue 不裁定。

## 7. Verification（待裁定后补）

修法落地时须记满：九条的面板读数逐条重取；以 `record-00036` 为证据集重跑
`resolvedGaps(plan-00034.implements, …)` 确认门的读数不因本修法改变；
`npm test`、`npm run typecheck` 全绿。

## 8. Follow-through

- Detection gap: 与 `issue-00039` 同类——测试断言的是「代码符合当时的文法」，
  文档约定变了、既有文档没跟上，测试天然抓不到。能抓到它的是有人真的去读一次
  覆盖视图并逐条核对，本 issue 就是那一次核对的产物。
- Doc verdict: **the doc was wrong or missing**，但**范围未定**：改哪一份文档
  取决于 §6 取哪条修法。第三十三轮已按裁定把 AC 侧那一半落地
  （`spec-00001-FR-32`、`docs/spec/README.md`、19 条既有墓碑），本 issue 承接
  剩下的。
- Residual state: 九条需求的面板读数在修法落地前一直失真；`record-00035` 的
  十六行 `待人工实测` 不会自己消失，`plan-00033` 已 `wontfix`，那批实测义务按
  `record-00035` 文末的结论段已随形态回退整体消失——**消失的是义务，不是行**。

## Links

- Blocks: spec-00012-persimmon-command、spec-00011-multi-workspace（两份 spec
  的 §Acceptance 各挂着一段说明，说明的正是本 issue 未解的那一半）
- Related: issue-00039-a-tombstone-ac-holds-its-item-uncovered（同一根因的前一
  半，第三十三轮已落地）、spec-00001-docs-whiteboard（`FR-31`、`FR-32`、`FR-52`
  与 §1 第三十三轮的裁定记录）、spec-00002-whiteboard-governance（`FR-10` 全局
  覆盖视图）、record-00035-persimmon-command-acceptance（十六行 `待人工实测`）、
  record-00036-persimmon-single-npm-artifact-acceptance（门的实跑读数）、
  decision-00004-whiteboard-requirement-panel（§5 裁定二：证据集不区分 record
  的 status；候选修法 ② 须追注此条）、decision-00005-whiteboard-parsing-contract
  （§1 的断链事故，留 id 的理由）
