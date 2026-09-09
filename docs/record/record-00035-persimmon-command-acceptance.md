---
id: record-00035-persimmon-command-acceptance
type: record
status: active
parent: plan-00033-persimmon-command
verifies: [spec-00012-persimmon-command, spec-00013-persimmon-scaffold, spec-00011-FR-2, spec-00011-FR-3, spec-00011-FR-4, spec-00011-FR-13, spec-00011-FR-14, spec-00011-FR-15, spec-00011-FR-18, spec-00011-AC-20.1, spec-00011-AC-20.4, spec-00011-FR-21]
---

# 验收记录：一个 `persimmon` 命令

对 [plan-00033-persimmon-command](../plan/plan-00033-persimmon-command.md) 的
验收。交付范围为 `spec-00012` 的 32 条 AC、`spec-00013` 的 70 条 AC，与
`spec-00011` 九条在范围内的 FR 的 39 条 AC（`AC-2.1`…`2.7` / `AC-3.1`…`3.4` /
`AC-4.1`…`4.5` / `AC-13.1`…`13.7` / `AC-14.1`…`14.3` / `AC-15.1`…`15.4` /
`AC-18.1`…`18.3` / `AC-20.1` / `AC-20.4` / `AC-21.1`…`21.4`），共 141 行，每行
恰一个 id。`spec-00011-AC-20.2` 与 `AC-20.3` 自第三十一轮起分别按「移交」与
「失效」不再计入验收集，故不出现为行。测试路径相对仓库根。

**本轮验收不放行 `resolved`**：141 行里 125 行 pass，余下 16 行待人工实测
（`spec-00012` §7 的验证义务加本 plan 的两处偏离），文末逐条列出；按 plan
§Detailed Acceptance Path 第 6、7 项，它们阻塞 `plan-00033` 的
`open → resolved`，本 plan 状态不动。**仓库内的证据齐了**：先前十条无带 id
溯源标注的 AC（plan T10 的 verify 明写「每个测试带 AC id 溯源标注」）本轮收口
——五条回填注释（`spec-00013-AC-9.1`、`AC-9.7`、`AC-10.1`、`AC-10.3`、
`AC-10.6`），五个新用例（`spec-00013-AC-10.4`、`AC-10.5` 与 `spec-00012-AC-1.1`、
`AC-9.1`、`AC-10.3`），十条现均为 pass。

## 质量门

均在本分支 `plan-00033`、提交 `58ca864` 上于仓库根执行（2026-09-09）：

- `npm test`：73 个文件、2087 个测试全部通过。
- `npm run typecheck`：干净，无输出。
- `npm run test:coverage`：全部文件 lines 98.59% / branches 95.25% /
  functions 98.68% / statements 99.35%，`vitest.config.ts` 的三个 90 门槛全过。
  **阈值一字未改、无被压制的发现**。
- `gofmt -l cli`：输出为空。
- `go -C cli vet ./...`：ok。
- `sh scripts/go-coverage.sh`：通过。逐包语句覆盖 `cli` 94.3%、
  `cli/internal/hostproc` 92.3%、`cli/internal/project` 100.0%、
  `cli/internal/registry` 93.8%（四个新包的门是 ≥ 90%），
  `cli/internal/scaffold` 82.8%——它是 `CODE_QUALITY.md` §8 的 legacy 债，门为
  棘轮记录值，本轮补测后由 82.1% 升到 82.8%，棘轮随之上抬
  （`scripts/go-coverage.sh` 的 `SCAFFOLD_RATCHET=82.8`，`CODE_QUALITY.md` §3
  与 [TESTING.md](../../TESTING.md) 同步记为 82.8%），**只升不降、未下调**。
- `goreleaser release --snapshot --clean`：产出 6 个平台归档与
  `checksums.txt`（T1，T8 复跑）。

## 缺陷立案（plan §交付范围「编号」，五份都已 `resolved`）

| issue | 缺陷 | 状态 |
| --- | --- | --- |
| [issue-00034](../issue/issue-00034-a-template-coordinate-with-an-empty-owner-passes-validation.md) | 模板坐标的 owner 为空也通过校验 | resolved |
| [issue-00035](../issue/issue-00035-a-variant-only-language-prints-a-branch-that-does-not-exist.md) | 只有 variant 的语言被 `list-langs` 打印成一条不存在的分支 | resolved |
| [issue-00036](../issue/issue-00036-list-langs-stops-at-the-first-page-of-branches.md) | `list-langs` 停在分支列表的第一页 | resolved |
| [issue-00037](../issue/issue-00037-new-silently-drops-a-second-positional-argument.md) | `new` 静默丢弃第二个位置参数 | resolved |
| [issue-00038](../issue/issue-00038-install-script-installs-an-archive-it-could-not-verify.md) | 安装脚本装下一个它没能校验的归档 | resolved |

五份各有一个先于修复写下、当时失败的测试，`blocks` 均指向本 plan。

## 实现期的既定取舍

- **`spec-00012-AC-5.1` / `AC-5.2` 移入实测集**（plan §实测义务 偏离 1）：
  `spec-00012` §7 没有列它们，但「命令拉起的 host 与命令同版本」只有一次真的
  发布之后才有可配对的版本。仓库内的半边是 `AC-9.1` 的 `ldflags` 注入与
  `cli/internal/hostproc/hostproc_test.go::TestTakesThePublishedHostPackage`
  拼出的 `npx …@<版本>` 命令行；真机一次在人工实测。
- **`spec-00012-AC-4.4` 计为仓库内已验证**（偏离 2）：§7 把 `AC-4.1`…`AC-4.4`
  一并押在信号透传实测之后，但 `AC-4.4` 讲的是接入路径——命令没有子进程，
  `SIGINT` 只让自己退出，那条路上既无 `npx` 也无子进程，Go 测试即完整证据。
- **`package.json` 的 `files` 由 `scripts/` 收窄为
  `scripts/fix-pty-permissions.js`**：对 `design-00004` §7「`files` 不变」的
  有意偏离——`scripts/` 下另三个都是开发工具，`postinstall` 只要那一个文件；
  `test/distribution.test.ts` 模拟的安装树形状同改。
- **`install.sh` 的校验和口径不照抄迁入源**（`design-00004` §6 追注、
  `spec-00012-FR-11`）：校验和不符、缺该归档那一行、那一行不合式——三种都中止
  且不在 PATH 上留二进制；只有取不到校验和文件、或本机既无 `sha256sum` 也无
  `shasum` 才退让为一句告警并继续。issue-00038 先立案先写红，再改。

## 验收清单

| 被验 id | 测试 | 结果 |
| --- | --- | --- |
| spec-00012-AC-1.1 | cli/main_test.go::TestListLangsNeedsNothingElseOnThePath | pass |
| spec-00012-AC-1.2 | cli/main_test.go::TestHelpListsExactlyTheClosedSubcommandSet | pass |
| spec-00012-AC-2.1 | cli/main_test.go::TestAnUnknownSubcommandIsRefusedAndLeavesTheRegistryAlone | pass |
| spec-00012-AC-2.2 | cli/main_test.go::TestAPathLikeFirstArgumentIsAnUnknownSubcommand | pass |
| spec-00012-AC-3.1 | cli/internal/hostproc/hostproc_test.go::TestLaunchesTheHostForTheProjectTheCwdIsIn + cli/internal/hostproc/hostproc_test.go::TestPassesStdinThrough | 待人工实测 |
| spec-00012-AC-3.2 | cli/internal/hostproc/hostproc_test.go::TestPassesTheHostsStderrThrough | 待人工实测 |
| spec-00012-AC-3.3 | cli/internal/hostproc/hostproc_test.go::TestExitsWithTheHostsCode | 待人工实测 |
| spec-00012-AC-3.4 | cli/internal/hostproc/hostproc_test.go::TestJoinsTheProcessOnThePort | pass |
| spec-00012-AC-4.1 | cli/internal/hostproc/hostproc_test.go::TestForwardsSIGINTAndDoesNotExitFirst | 待人工实测 |
| spec-00012-AC-4.2 | cli/internal/hostproc/hostproc_test.go::TestForwardsSIGTERM | 待人工实测 |
| spec-00012-AC-4.3 | cli/internal/hostproc/hostproc_test.go::TestForwardsSIGINTAndDoesNotExitFirst | 待人工实测 |
| spec-00012-AC-4.4 | cli/internal/hostproc/hostproc_test.go::TestTheJoinPathIsTakenDownByTheSignal | pass |
| spec-00012-AC-5.1 | （无带 id 标注的测试） | 待人工实测 |
| spec-00012-AC-5.2 | （无带 id 标注的测试） | 待人工实测 |
| spec-00012-AC-6.1 | cli/internal/hostproc/hostproc_test.go::TestLaunchesTheHostForTheProjectTheCwdIsIn | pass |
| spec-00012-AC-6.2 | cli/internal/hostproc/hostproc_test.go::TestTakesThePublishedHostPackage | pass |
| spec-00012-AC-7.1 | cli/internal/hostproc/hostproc_test.go::TestReportsAMissingNode | pass |
| spec-00012-AC-7.2 | cli/main_test.go::TestNewWorksWithNoNodeOnThePath | pass |
| spec-00012-AC-7.3 | cli/internal/scaffold/scaffold_test.go::TestUpdateMergesOnAMachineWithoutNode | pass |
| spec-00012-AC-8.1 | cli/internal/hostproc/hostproc_test.go::TestRefusesToGuessAVersion + cli/main_test.go::TestTheDispatchAnswersEveryFormOfTheClosedSet | pass |
| spec-00012-AC-8.2 | cli/main_test.go::TestListWorksOnADevelopmentBuildWithNoOverride | pass |
| spec-00012-AC-9.1 | cli/main_test.go::TestVersionPrintsTheInjectedVersion（`ldflags` 那一半另见 §质量门 的 goreleaser snapshot） | pass |
| spec-00012-AC-9.2 | cli/main_test.go::TestTheDispatchAnswersEveryFormOfTheClosedSet | pass |
| spec-00012-AC-9.3 | cli/main_test.go::TestTheDispatchAnswersEveryFormOfTheClosedSet | pass |
| spec-00012-AC-10.1 | test/install.test.ts::installs the archive when its checksum matches | 待人工实测 |
| spec-00012-AC-10.2 | （无带 id 标注的测试） | 待人工实测 |
| spec-00012-AC-10.3 | cli/main_test.go::TestEverySubcommandRunsWithoutNode | pass |
| spec-00012-AC-11.1 | test/install.test.ts::aborts and installs nothing when the checksum does not match | 待人工实测 |
| spec-00012-AC-11.2 | test/install.test.ts::aborts when the checksums file has no line for the archive | 待人工实测 |
| spec-00012-AC-11.3 | test/install.test.ts::aborts when the archive line is malformed | 待人工实测 |
| spec-00012-AC-11.4 | test/install.test.ts::warns and installs when the checksums file cannot be fetched | 待人工实测 |
| spec-00012-AC-11.5 | test/install.test.ts::warns and installs when the machine has neither sha256sum nor shasum | 待人工实测 |
| spec-00013-AC-1.1 | cli/main_test.go::TestNewTakesTheBaseTemplateByDefault | pass |
| spec-00013-AC-1.2 | cli/main_test.go::TestNewTakesTheLanguageBranchForLang | pass |
| spec-00013-AC-1.3 | cli/main_test.go::TestNewTakesTheVariantBranchForLangAndVariant | pass |
| spec-00013-AC-1.4 | cli/main_test.go::TestNewLetsRefOverrideTheBranchLangImplies | pass |
| spec-00013-AC-1.5 | cli/main_test.go::TestNewCreatesTheProjectUnderDir | pass |
| spec-00013-AC-1.6 | cli/main_test.go::TestNewTakesTheTemplateCoordinateFromTheEnvironment | pass |
| spec-00013-AC-1.7 | cli/main_test.go::TestNewAcceptsSetMoreThanOnce | pass |
| spec-00013-AC-1.8 | cli/main_test.go::TestNewAcceptsFlagsBeforeTheProjectName | pass |
| spec-00013-AC-2.1 | cli/internal/scaffold/scaffold_test.go::TestNewSkipsAnExcludedDirectory | pass |
| spec-00013-AC-2.2 | cli/internal/scaffold/scaffold_test.go::TestNewNeverCopiesTheGitDirectoryOrTheManifest | pass |
| spec-00013-AC-2.3 | cli/internal/scaffold/scaffold_test.go::TestNewSubstitutesPlaceholdersInTheListedFiles | pass |
| spec-00013-AC-2.4 | cli/internal/scaffold/scaffold_test.go::TestNewExpandsPlaceholdersInsideAVariableDefault | pass |
| spec-00013-AC-2.5 | cli/internal/scaffold/scaffold_test.go::TestNewSkipsAPostCreateStepGatedOnAnotherLanguage | pass |
| spec-00013-AC-2.6 | cli/internal/scaffold/scaffold_test.go::TestNewRunsAPostCreateStepGatedOnTheChosenLanguage | pass |
| spec-00013-AC-2.7 | cli/internal/scaffold/scaffold_test.go::TestNewRunsPostCreateStepsInDeclarationOrder | pass |
| spec-00013-AC-2.8 | cli/internal/scaffold/scaffold_test.go::TestNewIgnoresASubstituteEntryTheBranchDoesNotHave | pass |
| spec-00013-AC-3.1 | cli/internal/scaffold/scaffold_test.go::TestNewRecordsTheTemplateCoordinateRefAndBaseCommit | pass |
| spec-00013-AC-3.2 | cli/internal/scaffold/scaffold_test.go::TestNewRecordsTheResolvedVariablesWithoutName | pass |
| spec-00013-AC-3.3 | cli/internal/scaffold/scaffold_test.go::TestUpdateHandlesAProjectScaffoldedBeforeTheMove | pass |
| spec-00013-AC-4.1 | cli/main_test.go::TestNewRefusesVariantWithoutLang | pass |
| spec-00013-AC-4.2 | cli/main_test.go::TestNewWithoutANamePrintsTheUsage | pass |
| spec-00013-AC-4.3 | cli/main_test.go::TestNewRefusesASetValueWithoutAnEquals | pass |
| spec-00013-AC-4.4 | cli/main_test.go::TestNewRejectsASecondPositionalArgument | pass |
| spec-00013-AC-5.1 | cli/internal/scaffold/scaffold_test.go::TestNewRefusesATargetThatAlreadyExists | pass |
| spec-00013-AC-5.2 | cli/internal/scaffold/scaffold_test.go::TestNewReportsAMissingBranchAndPointsAtTheListing | pass |
| spec-00013-AC-5.3 | cli/internal/scaffold/scaffold_test.go::TestNewReportsAMissingRequiredVariable | pass |
| spec-00013-AC-5.4 | cli/internal/scaffold/scaffold_test.go::TestNewReportsWhichPostCreateStepFailedAndWritesNoMarker | pass |
| spec-00013-AC-5.5 | cli/internal/scaffold/scaffold_test.go::TestNewLeavesWhatItAlreadyCopiedAfterAPostCreateFailure | pass |
| spec-00013-AC-5.6 | cli/internal/scaffold/scaffold_test.go::TestNewWarnsAndLeavesTheBaseEmptyWhenTheCommitCannotBeResolved + cli/internal/scaffold/scaffold_test.go::TestUpdateRefusesACreationMarkerWithAnEmptyBase | pass |
| spec-00013-AC-6.1 | cli/main_test.go::TestNewRegistersWhatItScaffolded | pass |
| spec-00013-AC-6.2 | cli/main_test.go::TestNewRegistersThroughTheProcessAlreadyRunning | pass |
| spec-00013-AC-6.3 | cli/main_test.go::TestNewClosesWithTheRegisteredIDAndHowToOpenIt | pass |
| spec-00013-AC-6.4 | cli/main_test.go::TestNewRegistersTheResolvedPath | pass |
| spec-00013-AC-6.5 | cli/main_test.go::TestNewRefusesAFlagThatWouldSkipTheRegistration | pass |
| spec-00013-AC-7.1 | cli/main_test.go::TestNewRegistersDespiteAPortHeldBySomebodyElse | pass |
| spec-00013-AC-7.2 | cli/main_test.go::TestNewWritesTheSameFileContractAProcessWouldRead | pass |
| spec-00013-AC-8.1 | cli/main_test.go::TestNewKeepsTheProjectWhenTheRegistryIsIllFormed | pass |
| spec-00013-AC-8.2 | cli/main_test.go::TestNewKeepsTheProjectWhenTheRegistryCannotBeWritten | pass |
| spec-00013-AC-8.3 | cli/main_test.go::TestNewKeepsTheProjectWhenTheRunningProcessRefuses | pass |
| spec-00013-AC-8.4 | cli/main_test.go::TestAProjectLeftUnregisteredRegistersOnceTheCauseIsGone | pass |
| spec-00013-AC-9.1 | cli/internal/scaffold/scaffold_test.go::TestMergeTreeKeepsLocalEditsWhileFoldingInUpstream | pass |
| spec-00013-AC-9.2 | cli/internal/scaffold/scaffold_test.go::TestUpdateLeavesConflictMarkersAndListsTheFile | pass |
| spec-00013-AC-9.3 | cli/internal/scaffold/scaffold_test.go::TestUpdateSucceedsEvenWhenItLeavesAConflict | pass |
| spec-00013-AC-9.4 | cli/internal/scaffold/scaffold_test.go::TestUpdateAdvancesTheBaseAfterAConflict | pass |
| spec-00013-AC-9.5 | cli/internal/scaffold/scaffold_test.go::TestUpdateAdvancesTheBaseAfterACleanMerge | pass |
| spec-00013-AC-9.6 | cli/internal/scaffold/scaffold_test.go::TestUpdateLeavesTheProjectsOwnFilesAlone | pass |
| spec-00013-AC-9.7 | cli/internal/scaffold/scaffold_test.go::TestMergeTreeAddsFilesNewSinceTheBase | pass |
| spec-00013-AC-9.8 | cli/internal/scaffold/scaffold_test.go::TestUpdateMergesAnUpstreamAdditionThatTheProjectAlreadyHas | pass |
| spec-00013-AC-9.9 | cli/internal/scaffold/scaffold_test.go::TestUpdateReportsAProjectAlreadyUpToDate | pass |
| spec-00013-AC-9.10 | cli/internal/scaffold/scaffold_test.go::TestUpdateMergesTheDirectoryItWasPointedAt | pass |
| spec-00013-AC-10.1 | cli/internal/scaffold/scaffold_test.go::TestMergeTreeLeavesDeliberateDeletionsDeleted | pass |
| spec-00013-AC-10.2 | cli/internal/scaffold/scaffold_test.go::TestUpdateHonoursAnExcludePatternTheTemplateAddedAfterCreation | pass |
| spec-00013-AC-10.3 | cli/internal/scaffold/scaffold_test.go::TestMergeTreePrunesExcludedDirectories | pass |
| spec-00013-AC-10.4 | cli/internal/scaffold/scaffold_test.go::TestMergeTreeLeavesAnAgreeingLinkAndItsTargetAlone | pass |
| spec-00013-AC-10.5 | cli/internal/scaffold/scaffold_test.go::TestMergeTreeReportsALinkTheProjectReplacedWithAFile | pass |
| spec-00013-AC-10.6 | cli/internal/scaffold/scaffold_test.go::TestMergeTreeKeepsARetargetedLinkAndSparesWhatItPointsAt | pass |
| spec-00013-AC-11.1 | cli/internal/scaffold/scaffold_test.go::TestUpdateRefusesADirectoryWithNoCreationMarker | pass |
| spec-00013-AC-11.2 | cli/internal/scaffold/scaffold_test.go::TestUpdateRefusesACreationMarkerThatIsNotValidJSON | pass |
| spec-00013-AC-11.3 | cli/internal/scaffold/scaffold_test.go::TestUpdateRefusesACreationMarkerWithAnEmptyBase | pass |
| spec-00013-AC-11.4 | cli/internal/scaffold/scaffold_test.go::TestUpdateRejectsATemplateThatIsNotOwnerSlashRepo | pass |
| spec-00013-AC-11.5 | cli/internal/scaffold/scaffold_test.go::TestUpdateRejectsATemplateThatIsNotOwnerSlashRepo | pass |
| spec-00013-AC-12.1 | cli/internal/scaffold/scaffold_test.go::TestUpdateFailsOnTheFirstMergeWhenGitIsMissing | pass |
| spec-00013-AC-12.2 | cli/internal/scaffold/scaffold_test.go::TestUpdateLeavesTheBaseWhereItWasWhenGitIsMissing | pass |
| spec-00013-AC-13.1 | cli/main_test.go::TestListLangsListsTheBaseTemplateThenLanguagesInOrder | pass |
| spec-00013-AC-13.2 | cli/main_test.go::TestListLangsSaysOnlyTheBaseTemplateIsAvailable | pass |
| spec-00013-AC-13.3 | cli/main_test.go::TestListLangsOmitsTheBaseLineForAVariantOnlyLanguage | pass |
| spec-00013-AC-13.4 | cli/main_test.go::TestListLangsFollowsPaginationToTheLastPage | pass |
| spec-00013-AC-14.1 | cli/main_test.go::TestListLangsReportsARequestThatCouldNotBeSent | pass |
| spec-00013-AC-14.2 | cli/main_test.go::TestListLangsReportsTheAddressAndStatusOfANon200 | pass |
| spec-00013-AC-14.3 | cli/main_test.go::TestListLangsReportsAnUnparseableReply | pass |
| spec-00011-AC-2.1 | cli/internal/registry/registry_test.go::TestAddingAWorkspace + cli/main_test.go::TestAddRegistersThroughTheProcessAlreadyRunning + test/host.test.ts::registers a new directory and answers 201 | pass |
| spec-00011-AC-2.2 | cli/internal/registry/registry_test.go::TestAddingAWorkspace + test/workspaceRegistry.test.ts::numbers a colliding id and keeps both entries | pass |
| spec-00011-AC-2.3 | cli/internal/registry/registry_test.go::TestAddingAWorkspace + test/host.test.ts::answers 200 with the entry that was already there + test/workspaceRegistry.test.ts::returns the existing entry for an already registered path | pass |
| spec-00011-AC-2.4 | cli/internal/project/project_test.go::TestFindRoot | pass |
| spec-00011-AC-2.5 | cli/internal/registry/registry_test.go::TestAddingAWorkspace + test/workspaceRegistry.test.ts::collapses a symlinked spelling of a registered path | pass |
| spec-00011-AC-2.6 | cli/internal/registry/registry_test.go::TestAddingAWorkspace + test/workspaceRegistry.test.ts::falls back to `workspace` when the directory name derives an empty id | pass |
| spec-00011-AC-2.7 | test/workspaceRegistry.test.ts::keeps the id when the user repoints an entry at a renamed directory | pass |
| spec-00011-AC-3.1 | test/host.test.ts::answers 422 for a directory the registry refuses + test/workspaceRegistry.test.ts::refuses a path that does not exist, leaving the registry alone + web/test/workspaceSwitcher.test.tsx::keeps the dialog and what was typed when the add is refused | pass |
| spec-00011-AC-3.2 | cli/internal/registry/registry_test.go::TestAddingAWorkspace + test/workspaceRegistry.test.ts::refuses a directory without a flow config, naming the file it looked for | pass |
| spec-00011-AC-3.3 | cli/internal/registry/registry_test.go::TestAddingAWorkspace + test/workspaceRegistry.test.ts::registers a directory whose flow config is invalid | pass |
| spec-00011-AC-3.4 | cli/internal/registry/registry_test.go::TestAddingAWorkspace + test/workspaceRegistry.test.ts::registers a directory nested inside another workspace | pass |
| spec-00011-AC-4.1 | cli/internal/hostproc/hostproc_test.go::TestDeleteDropsTheEntryThroughTheProcess + cli/main_test.go::TestRemoveDropsTheEntryThePathNames + cli/main_test.go::TestRemoveDropsTheEntryThroughTheProcessAlreadyRunning | pass |
| spec-00011-AC-4.2 | test/host.test.ts::leaves the workspace’s own files where they are | pass |
| spec-00011-AC-4.3 | web/test/workspaceSwitcher.test.tsx::lands the page on the first available entry when the current one goes | pass |
| spec-00011-AC-4.4 | web/test/workspaceSwitcher.test.tsx::lands on the empty state when the current one was the only entry | pass |
| spec-00011-AC-4.5 | web/test/workspaceSwitch.test.tsx::goes to the first available entry when nothing was remembered + web/test/workspaceSwitcher.test.tsx::skips an unavailable entry when it lands | pass |
| spec-00011-AC-13.1 | cli/internal/hostproc/hostproc_test.go::TestLaunchesTheHostForTheProjectTheCwdIsIn | pass |
| spec-00011-AC-13.2 | web/test/workspaceSwitch.test.tsx::goes to the workspace this browser was last in | pass |
| spec-00011-AC-13.3 | web/test/workspaceSwitch.test.tsx::goes to the first available entry when nothing was remembered | pass |
| spec-00011-AC-13.4 | cli/internal/hostproc/hostproc_test.go::TestLaunchesWithNoWorkspaceOutsideEveryProject + web/test/workspaceSwitcher.test.tsx::invites the first workspace when the registry is empty, switcher and all | pass |
| spec-00011-AC-13.5 | cli/internal/hostproc/hostproc_test.go::TestLaunchesTheHostForTheProjectTheCwdIsIn | pass |
| spec-00011-AC-13.6 | cli/internal/hostproc/hostproc_test.go::TestLaunchesTheHostForTheProjectTheCwdIsIn | pass |
| spec-00011-AC-13.7 | cli/internal/hostproc/hostproc_test.go::TestLaunchesTheHostForTheProjectTheCwdIsIn + web/test/workspaceSwitcher.test.tsx::says which config error keeps a registered workspace from opening | pass |
| spec-00011-AC-14.1 | cli/internal/hostproc/hostproc_test.go::TestJoinsTheProcessOnThePort | pass |
| spec-00011-AC-14.2 | cli/internal/hostproc/hostproc_test.go::TestJoinsTheProcessOnThePort + test/host.test.ts::signals the host events channel on a new entry + web/test/workspaceSwitcher.test.tsx::shows an entry added elsewhere while it stays open | pass |
| spec-00011-AC-14.3 | cli/internal/hostproc/hostproc_test.go::TestJoinsOutsideEveryProject | pass |
| spec-00011-AC-15.1 | cli/internal/hostproc/hostproc_test.go::TestProbeReadsWhoHoldsThePort + cli/internal/hostproc/hostproc_test.go::TestRefusesAPortItCannotHave | pass |
| spec-00011-AC-15.2 | cli/internal/hostproc/hostproc_test.go::TestProbeReadsASilentHolderAsOccupied + cli/internal/hostproc/hostproc_test.go::TestRefusesAPortItCannotHave + test/startup.test.ts::reports a port it cannot have instead of crashing | pass |
| spec-00011-AC-15.3 | cli/internal/hostproc/hostproc_test.go::TestReportsARegistrationTheFileRefused + cli/internal/hostproc/hostproc_test.go::TestReportsARegistrationTheProcessRefused | pass |
| spec-00011-AC-15.4 | cli/main_test.go::TestListReadsTheFileWhenAStrangerHoldsThePort | pass |
| spec-00011-AC-18.1 | cli/internal/registry/registry_test.go::TestReadingTheRegistry + test/workspaceRegistry.test.ts::leaves an ill-formed file as it stands + test/workspaceRegistry.test.ts::refuses an ill-formed file, naming the path and the problem | pass |
| spec-00011-AC-18.2 | cli/internal/registry/registry_test.go::TestReadingTheRegistry + test/workspaceRegistry.test.ts::refuses an ill-formed file, naming the path and the problem | pass |
| spec-00011-AC-18.3 | cli/internal/registry/registry_test.go::TestReadingTheRegistry + test/workspaceRegistry.test.ts::refuses when the registry directory is a file, naming the path | pass |
| spec-00011-AC-20.1 | （无带 id 标注的测试） | 待人工实测 |
| spec-00011-AC-20.4 | cli/main_test.go::TestAddRegistersThisRepositoryAtItsRoot | pass |
| spec-00011-AC-21.1 | cli/main_test.go::TestListShowsEveryEntryWithItsAvailability + test/workspaceRegistry.test.ts::returns the entries in file order, and an empty list for an empty registry | pass |
| spec-00011-AC-21.2 | cli/main_test.go::TestListPrintsNothingOnAnEmptyRegistry + test/workspaceRegistry.test.ts::returns the entries in file order, and an empty list for an empty registry | pass |
| spec-00011-AC-21.3 | cli/main_test.go::TestListRetreatsToWhatItCanSettleWithoutNode | pass |
| spec-00011-AC-21.4 | cli/main_test.go::TestListStillNamesTheUnavailabilitiesItCanSettle | pass |

## 待人工实测的 16 行

`spec-00012` §7 明写「在对应实测通过前不计已验证」，加上 §实现期的既定取舍
偏离 1 的两条。仓库内能证的半边都在，缺的是真机那一次；plan §须由人执行或
授权的步骤第 5 条持有这四行义务，本轮不执行其中任何一条。

- **stdio 与信号透传（无 TTY、离线各一次）**：`spec-00012-AC-3.1`、`AC-3.2`、
  `AC-3.3`、`AC-4.1`、`AC-4.2`、`AC-4.3`。仓内半边是
  `cli/internal/hostproc/hostproc_test.go` 的六个用例，以
  `PERSIMMON_HOST` 指向 `testdata/host` 的 stub、在无 TTY 下跑真子进程；缺的
  是 `npx` 那一层的真发布版本与一次真冷缓存。
- **版本配对**：`spec-00012-AC-5.1`、`AC-5.2`。仓内无带这两个 id 的测试（见
  §实现期的既定取舍 偏离 1），须第一次推 `v0.2.0` 之后才有可配对的版本。
- **安装形态**：`spec-00012-AC-10.1`、`AC-10.2`、`AC-11.1`…`AC-11.5` 与
  `spec-00011-AC-20.1`。`AC-10.1` 与 `AC-11.1`…`AC-11.5` 的仓内半边是
  `test/install.test.ts` 的本机 HTTP stub（五种校验和情形全覆盖）；`AC-10.2`
  （安装脚本不支持的平台上解归档跑 `persimmon version`）与
  `spec-00011-AC-20.1`（装入 PATH 后任意目录 `persimmon list`）仓内无带 id 的
  测试，仓内证据只有 snapshot 归档。须真实 linux 与 darwin 各跑一次真 Release。

## 第三十二轮追注（2026-09-09）：所验收的交付已被推翻

`decision-00020` 第三十二轮推翻了 Go 与两产物形态，`plan-00033` 随之转
`wontfix`。本记录**留 `active`**：它如实记录了 2026-09-09 那次验收实际
跑出的结果，`docs/README.md:27` 禁止以归档来记录结果。

读本记录时须知三件事：

1. 125 行 pass 的证据**全部是 Go 测试名**（`cli/...`）。`cli/` 移除后这些
   路径不再存在，逐行溯源须回到 git 历史（本记录所引 commit 及其之前）。
2. 16 行「待人工实测」（见 §待人工实测的 16 行；逐行即 §验收清单里结果为
   「待人工实测」的那些）的**实测义务**全部消失（不再有 `npx` 那一层、不再有
   两个产物、`install.sh` 已删）。这 16 行中 15 行属 `spec-00012`，按
   `decision-00020` §5 的逐条裁定分两种归宿，别混：
   - **作废保 id，8 条**（需求或该条采样的机制随之消失）：`AC-5.1` / `AC-5.2`
     （`FR-5` 版本配对作废）、`AC-11.1` / `AC-11.2` / `AC-11.3` / `AC-11.4` /
     `AC-11.5`（`FR-11` 校验和作废），以及 `AC-3.2`——`FR-3` 虽是改写，但这
     一条采样的是**转发这一层的正确性**（服务写的 stderr 经父进程出现在命令的
     stderr 上）。单进程下两者是同一个流，该断言退化成「一个进程写自己的
     stderr」这一同义反复，按 `ACCEPTANCE.md`「no criterion restates its
     requirement」退出验收集；stdout 那一半已由改写后的 `AC-3.1` 采样。
   - **改写后继续存在，7 条**（§5 裁定 `FR-3` / `FR-4` / `FR-10` 是改写不是
     作废）：`AC-3.1` / `AC-3.3`、`AC-4.1` / `AC-4.2` / `AC-4.3`、
     `AC-10.1` / `AC-10.2`。它们在单进程模型下重新表述，须由后续 plan 的
     新验收记录重新取证。
   8 + 7 = 15，与这 16 行里属 `spec-00012` 的行数相符；分类与
   `spec-00012` 的墓碑清单逐条一致（该 spec 第三十二轮把 `AC-3.2` 列为墓碑）。第 16 行
   `spec-00011-AC-20.1` 单独一条：Given 从「已经 `install.sh` 装入 PATH」改写
   为 npm bin，同样由后续 plan 重验。
   `AC-3.4` / `AC-4.4` / `AC-10.3` **不属于这一节**：它们分别归 `FR-3` /
   `FR-4` / `FR-10`，本轮同样是改写后存续，但它们是当初 pass 的 125 行里的
   三行，本轮的归宿见第 1 条（证据是 Go 测试名，逐行溯源回 git 历史）。
3. 行为层面存续的是 `spec-00013` 的脚手架全部 70 条 AC 与 `spec-00011`
   的注册表相关条目——它们在移植后须由新的验收记录重新取证，本记录不
   替新实现背书。
