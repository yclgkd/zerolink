---
name: AI Task
about: 独立可并行的开发任务模板（1 任务 = 1 分支 = 1 PR）
title: "[Task] ZL-xxx <task-name>"
labels: ["task"]
assignees: []
---

## Task ID
ZL-xxx

## Objective
一句话说明任务目标。

## Scope
- 允许修改的文件/目录：
  - `path/to/file`

## Out of Scope
- 明确不应改动的内容。

## Dependencies
- 前置任务：`ZL-...`

## Difficulty
- [ ] 1
- [ ] 2
- [ ] 3
- [ ] 4
- [ ] 5

## Acceptance Criteria
- [ ] 功能完成并符合任务目标
- [ ] 相关测试通过
- [ ] typecheck/lint 通过
- [ ] PR 描述包含风险与回滚说明

## Branch Naming
`<type>/<short-name>`

- `type` must be one of: `feat`, `fix`, `security`, `perf`, `refactor`, `test`, `docs`, `style`, `chore`, `ci`, `revert`
- Do not include task IDs in the branch name.
- Track task IDs in the issue and PR instead.

## PR Naming
`[ZL-xxx] <summary>`

## Validation Steps
1. `pnpm <command>`
2. `pnpm <command>`
