---
id: issue-00039-a-tombstone-ac-holds-its-item-uncovered
type: issue
status: open
blocks: [plan-00034-persimmon-single-npm-artifact]
---

# Issue: 墓碑 AC 把它所属的条目一直判成「未覆盖」

> 第三十一轮起，需求作废的 AC 不删 id、只在正文里写「退出验收集」。条目文法
> 没有这个标记位，`src/requirements.ts` 因此照常把它算成一条须验证的 AC，
> 没有 pass 行就把整条 FR 判 `uncovered`；`resolvedGate` 据此挡住
> `plan-00034` 的 `open → resolved`，而这些 FR 的**现行** AC 全部 `pass`。

## 1. Problem

- Observed: 以 `record-00036` 作证据集实跑 `src/resolvedGate.ts` 的
  `resolvedGaps`（`record-00036` §320-338、§353-381 记的就是这一次实跑），
  返回四条缺口——`spec-00012-FR-3`（因 `AC-3.2`）、`spec-00012-FR-10`
  （因 `AC-10.3`）、`spec-00011-FR-20`（因 `AC-20.3`）、`spec-00011-FR-21`
  （因 `AC-21.3` / `AC-21.4`）。这五条 AC 全是墓碑，正文各自写着「自第三十二轮
  起退出验收集，**无替代条目**——id 就地留存」。
- Expected: 这四条 FR 的现行 AC（`AC-3.1`/`3.3`/`3.4`、`AC-10.1`/`10.2`、
  `AC-20.1`/`20.2`/`20.4`、`AC-21.1`/`21.2`/`21.5`）在 `record-00036` 里逐条
  `pass`，按 `spec-00001-FR-32` 应判 `verified`，`rule-00001-BR-25` 的门应
  放行。
- Trigger: 一份 spec 含墓碑 AC，且该墓碑所属的 FR 出现在某个 plan 的
  `implements` 里，而那个 plan 走到 `open → resolved`。第三十一轮之后没有
  plan 走到过 `resolved`，所以此前从未踩到。

## 2. Impact

- Affected: 两处。① `rule-00001-BR-25` 的机器门——今天挡着 `plan-00034`，
  此后每一个交付面里含墓碑 FR 的 plan 都会被同样挡住；② 检视面板与全局覆盖
  视图——`spec-00011` 的 FR-20 / FR-21、`spec-00012` 的 FR-3 / FR-10 以及
  `spec-00012` 那五条**整条作废**的 FR（FR-5 … FR-8、FR-11）今天一律显示
  「未覆盖」，读者看到的缺口数是假的。
- Since: `5ea8f92`（第三十一轮，第一批墓碑落地）· Still occurring: yes
- Severity: 中高。它不产生错误数据，但**把唯一一道自动的验收门变成了必须绕开
  的门**：门给出的四条缺口都是假的，而人一旦学会「这门的报警可以不理」，真
  缺口也会跟着被放过。且缺口数只增不减——墓碑是只进不出的集合，今天 19 条。

## 3. Root Cause (first principles)

1. 分歧：一条**已声明但不再须验证**的 AC，文档侧说它不计入验收集，机器侧把它
   算成一条欠验收行的 AC。
2. 最小机制：`src/requirements.ts:205`——
   `item.criteria.some((criterion) => criterion.rows.length === 0) ? 'uncovered' : 'verified'`。
   条目的 `criteria` 由 `attachCriteria`（`:208-229`）按归属标注
   （`ATTRIBUTION`，`:32`，形态 `^\(([^)]+)\)`）填入，凡 `- **…-AC-…** (…-FR-…)`
   起头的行一律入列。三态判定里没有第二种 AC，`rows.length === 0` 即 `uncovered`。
3. 真正的根因：**条目文法只有一种 AC 形态，没有「声明但不计入」的表达**
   （`docs/spec/README.md:34`：`- **spec-<n>-AC-<i>.<k>** (spec-<n>-FR-<i>)`，
   归属标注必写、且只此一项）；而覆盖判定（`spec-00001-FR-32`）把「被声明」
   直接等同于「须验证」。文档侧的墓碑约定完全活在**散文**里
   （`spec-00011` §430、`spec-00012` §319 的那两段说明），机器读不到。
   三者各自都成立：留 id 是为了不让 `record-00028` / `record-00035` /
   `plan-00033` 的既有引用变成断链（`decision-00005` §1 记的正是这一类事故）；
   保留完整声明形态是因为**文法里唯一能让一行不被解析为 AC 的办法是不以粗体
   id 起头**，而那正会造成断链；覆盖逐 AC 要求是 `decision-00004` §5 裁定三
   刻意定的。合起来必然相冲。
   它**不是**：`resolvedGate` 读错了（它复用同一份推导，正是设计要的，
   `src/resolvedGate.ts:76-78`）；不是 `record-00036` 少记了行（现行 AC 一条
   不缺）；也不是 `FR-33`「无法归属」的问题——墓碑归属得上，它只是不该被要求。

- Introduced by: `5ea8f92`（第三十一轮引入第一条墓碑 AC；`e8a1bb7`、`0af67b0`
  两轮把总数推到 19 条）。此前 spec 里的每条 AC 都真的须验证，「声明即须验证」
  与文档约定不冲突，缺陷不可能发生。`requirements.ts` 的三态推导自 `f914c7e`
  （init）起一字未改——**变的是文档侧的约定，不是代码**。

## 4. Scope (same-cause sweep)

机制是「AC 的声明形态里没有『不计入』这一位，凡声明必被要求」：

| Site | Same pattern | Affected | Action |
| --- | --- | --- | --- |
| `src/requirements.ts:205`（`coverageOf` 的 `uncovered` 判定） | yes | yes | 根因所在，须改（见 §6） |
| `src/requirements.ts:32` / `:215`（`ATTRIBUTION` 与 `attachCriteria` 的归属解析） | yes | yes | 标记位的落点，须改 |
| `src/requirements.ts:227`（AC 计数所依据的 `criteria.push`） | yes | no | 墓碑**仍**计入 `FR-31` 的 AC 计数，按 §6 的裁定不动 |
| `src/resolvedGate.ts:76-78`（`resolvedGaps` 读 `coverage`） | 消费方 | yes（症状） | 不自带判定，随 `requirements.ts` 一并变正；无独立改动 |
| `web/src/Inspector.tsx:106`/`:181`、`web/src/Details.tsx:66-73`、`web/src/SubNodes.tsx:82-91`（AC 的三处呈现） | 呈现 | yes | 墓碑须有区别样式，否则读者无从知道某条 AC 为何不欠行 |
| `web/src/CoverageView.tsx:122`、`web/src/coverageMarks.ts` | 消费方 | yes（症状） | 同上，读同一份 `coverage`，无独立改动 |
| `src/requirements.ts:218-224`（`FR-33` 的「无法归属」） | no | no | 墓碑归属得上，不走这条路；`FR-33` 语义不变 |
| `docs/spec/README.md:34`（条目文法） | yes | yes | 文法须加这一位（另一 agent 在改） |
| `spec-00011` 3 条 / `spec-00012` 16 条既有墓碑 | yes | yes | 各加标记；加完前门的读数不变 |

`spec-00012` 的 16 条墓碑里只有 `AC-3.2`、`AC-10.3` 挂在存续的 FR 上，故门
只报了两条；其余 14 条挂在整条作废的 FR-5 … FR-8、FR-11 上——那五条 FR 不在
任何 plan 的 `implements` 里，门看不见它们，但**检视面板照样把它们显示为
「未覆盖」**。同一根因的两种可见面，一种阻塞流转，一种只是读数失真。

## 5. Reproduction (test-first)

守卫用例（`test/requirements.test.ts` 的 `describe('coverage')` 块内，沿用该
文件既有的 `specBody` / `item` / `criterion` / `checklist` / `viewOf` 助手）：

```ts
// issue-00039 — 墓碑 AC 计入 AC 计数，但不参与覆盖三态
it('keeps a criterion marked 作废 out of the coverage verdict, but in the count', () => {
  const view = viewOf(
    specBody(
      [item('spec-00001-FR-1')],
      [
        criterion('spec-00001-AC-1.1', 'spec-00001-FR-1'),
        criterion('spec-00001-AC-1.2', 'spec-00001-FR-1, 作废'),
      ],
    ),
    [checklist('record-00001-x', [['spec-00001-AC-1.1', 'first test', 'pass']])],
  )

  expect(view.items[0]!.criteria.map((found) => found.id)).toEqual([
    'spec-00001-AC-1.1',
    'spec-00001-AC-1.2',
  ]) // FR-31：墓碑仍是这条 FR 的 AC，仍计数
  expect(view.diagnostics).toEqual([]) // FR-33：它归属得上，不是无法归属
  expect(view.items[0]!.coverage).toBe('verified') // FR-32：它不欠验收行
})
```

修复前该用例红，且红在根因上：`ATTRIBUTION` 取到的 `attributedTo` 是整串
`spec-00001-FR-1, 作废`，`attachCriteria` 找不到同名条目，`AC-1.2` 落进
`unattributable` 诊断——`criteria` 只剩一条（计数断言红）、`diagnostics` 非空
（第二条断言红）。

**两个方向要分开守**：今天这个仓库里的墓碑写的是不带标记的普通归属标注
（`(spec-00011-FR-20)`），那种形态下 `coverage` 才读出 `uncovered`——但修复
之后它**仍应**读 `uncovered`（没有标记的 AC 就是须验证的 AC），所以它不能当
回归守卫，只能作边界断言：

```ts
// 没有标记的 AC 照旧须验证——修复不得把这一条也放过
it('still calls an item uncovered when an unmarked criterion has no row', () => {
  expect(viewOf(TWO_CRITERIA, [checklist('record-00001-x', [['spec-00001-AC-1.1', 't', 'pass']])])
    .items[0]!.coverage).toBe('uncovered')
})
```

现场复现（已实跑，见 `record-00036` §320-338）：以 `record-00036` 为证据集调
`resolvedGaps(plan-00034.implements, …)`，返回

```
spec-00012-FR-3    ← spec-00012-AC-3.2（墓碑）无行
spec-00012-FR-10   ← spec-00012-AC-10.3（墓碑）无行
spec-00011-FR-20   ← spec-00011-AC-20.3（墓碑）无行
spec-00011-FR-21   ← spec-00011-AC-21.3 / AC-21.4（墓碑）无行
```

## 6. 修复方向（编排者已定，本 issue 不实施）

**改文法 + 改门**，两侧同轮落地：

- 归属标注允许第二个逗号分隔的 token `作废`：
  `- **spec-00012-AC-3.2** (spec-00012-FR-3, 作废)`。
- 解析到 `作废` 的 AC **仍归属该 FR、仍计入 AC 计数**（`spec-00001-FR-31`），
  但**不参与覆盖三态**（`spec-00001-FR-32`）——它既不要求验收行，也不因没有
  验收行而使其 FR 落进 `uncovered`；若它**有**一条非 `pass` 的引用行，
  该行如何计入由 `FR-32` 修订时一并裁定（本 issue 不替它定）。
- 检视面板（含子画布与详情面板）以**区别样式**呈现墓碑 AC。
- `spec-00001-FR-31` / `FR-32` 与 `docs/spec/README.md` 的条目文法随之修订
  （另一 agent 正在做），`FR-33` 的「无法归属」语义**不变**。
- 19 条既有墓碑（`spec-00011` 3 条、`spec-00012` 16 条）逐条加标记。

为什么这是根因而不是症状：标记加在**声明**上，覆盖判定读的就是声明，故门、
检视面板、全局覆盖视图三处一次同时变正，且此后每一条新墓碑在写下的那一刻就
是机器可见的——不必再靠散文里的一段说明和读者的记性。

已否决的替法：① 为五条墓碑 AC 各补一条验收行——编造证据，且 `n/a` 会把 FR
判成 `failing`，比现状更糟；② 提高门的容忍度或在 `resolvedGate` 里排除墓碑
——门与检视面板会就同一条目给出不同答案，违反 `design-00001` §2「判定只有
一处」；③ 删掉墓碑 id——正是第三十一轮为避免断链而否决过的做法。

## 7. Verification（待修复后补）

修复落地时须记满：

- §5 的守卫用例红→绿，边界用例始终绿；
- 以 `record-00036` 为证据集重跑 `resolvedGaps`，四条假缺口消失，且不新增缺口；
- 检视面板与全局覆盖视图上 `spec-00011-FR-20` / `FR-21`、`spec-00012-FR-3` /
  `FR-10` 不再显示「未覆盖」，`spec-00012` 的 FR-5 … FR-8、FR-11 五条整条作废
  的 FR 呈现按修订后的 `FR-31` / `FR-32` 核对；
- `npm test`、`npm run typecheck` 全绿。

## 8. Follow-through

- Detection gap: `test/requirements.test.ts` 的 `describe('coverage')` 覆盖了
  `AC-32.1` … `AC-32.10` 全部十条，**但十条断言的前提都是「每条 AC 都须验证」**
  ——文档侧新增一类 AC 时，没有任何测试会红。这类缺陷（文档约定改了、代码没
  跟上）测试天然抓不到；能抓到它的是「一个 plan 真的走一次 `resolved`」，而
  第三十一轮之后第一次走就是 `record-00036`，也确实抓到了。修复时值得同时问：
  条目文法此后每加一位，`spec-00001-FR-40` 的解析诊断是否也须跟着加一条。
- Doc verdict: **the doc was wrong or missing**——文法与 `FR-31`/`FR-32` 都缺
  这一位，须修订并补 GWT（`spec-00001` 与 `docs/spec/README.md` 的修订由另一
  agent 进行）；代码不是不合规，它忠实实现了当时的文法。
- Residual state: `record-00036` 的结论段（「不放行」的第四件事）在修复后须
  重取读数；`plan-00034` 保持 `open`，直到门实跑无缺口。19 条既有墓碑在加上
  标记前，白板上的覆盖读数一直是失真的。

## Links

- Blocks: plan-00034-persimmon-single-npm-artifact（`open → resolved` 被门挡住）
- Related: spec-00001-docs-whiteboard（`FR-31`、`FR-32`、`FR-33`、`AC-32.1` …
  `AC-32.10`）、spec-00011-multi-workspace（§430 的三条墓碑）、
  spec-00012-persimmon-command（§319 的十六条墓碑）、
  record-00036-persimmon-single-npm-artifact-acceptance（§320-338、§353-381
  的实跑与点名）、decision-00004-whiteboard-requirement-panel（§5 裁定三：
  覆盖逐 AC 要求）、decision-00005-whiteboard-parsing-contract（§1 的断链事故、
  §4 的粗体 id 声明专用形态）
