#!/usr/bin/env bash

set -euo pipefail

DOC_PATH="${DOC_PATH:-docs/TASK_BREAKDOWN.md}"
LABELS="${LABELS-task}"
MODE="dry-run"

if [[ "${1:-}" == "--apply" ]]; then
  MODE="apply"
fi

if [[ "$MODE" == "apply" ]] && ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI 'gh' is not installed or not in PATH."
  exit 1
fi

if [[ ! -f "$DOC_PATH" ]]; then
  echo "Error: task document not found: $DOC_PATH"
  exit 1
fi

TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

awk '
BEGIN {
  in_table=0
}
/^## Task List$/ {
  in_table=1
  next
}
in_table && /^## / {
  in_table=0
}
in_table && /^\| ZL-[0-9]{3} / {
  line=$0
  gsub(/^[[:space:]]*\|[[:space:]]*/, "", line)
  gsub(/[[:space:]]*\|[[:space:]]*$/, "", line)
  n=split(line, cols, /[[:space:]]*\|[[:space:]]*/)
  if (n >= 6) {
    task_id=cols[1]
    task_name=cols[2]
    scope=cols[3]
    depends=cols[4]
    difficulty=cols[5]
    ai_tier=cols[6]
    printf "%s\t%s\t%s\t%s\t%s\t%s\n", task_id, task_name, scope, depends, difficulty, ai_tier
  }
}
' "$DOC_PATH" > "$TMP_FILE"

if [[ ! -s "$TMP_FILE" ]]; then
  echo "Error: no tasks found in $DOC_PATH"
  exit 1
fi

create_issue() {
  local task_id="$1"
  local task_name="$2"
  local scope="$3"
  local depends="$4"
  local difficulty="$5"
  local ai_tier="$6"

  local title="[Task] ${task_id} ${task_name}"
  local body

  body="$(cat <<EOF
## Task ID
${task_id}

## Objective
完成 ${task_name}，并满足任务范围与验收标准。

## Scope
- ${scope}

## Out of Scope
- 详见 \`docs/TASK_BREAKDOWN.md\` 的 Task Contracts 对应条目。

## Dependencies
- ${depends}

## Difficulty
- ${difficulty}

## Suggested AI Tier
- ${ai_tier}

## Definition of Done
- [ ] 仅完成当前任务范围（跨任务改动需在 PR 说明）
- [ ] 通过该任务对应 DoD Commands
- [ ] Typecheck/Lint/Test 满足任务要求
- [ ] PR 标题遵循：\`[${task_id}] <summary>\`

## Branch Naming
\`task/$(echo "${task_id}" | tr '[:upper:]' '[:lower:]')-$(echo "${task_name}" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-')\`
EOF
)"

  if [[ "$MODE" == "apply" ]]; then
    if [[ -n "${LABELS// }" ]]; then
      gh issue create --title "$title" --label "$LABELS" --body "$body"
    else
      gh issue create --title "$title" --body "$body"
    fi
  else
    printf '%s\n' "----"
    printf 'TITLE: %s\n' "$title"
    printf 'LABELS: %s\n' "${LABELS:-<none>}"
    printf '%s\n' "$body"
  fi
}

while IFS=$'\t' read -r task_id task_name scope depends difficulty ai_tier; do
  create_issue "$task_id" "$task_name" "$scope" "$depends" "$difficulty" "$ai_tier"
done < "$TMP_FILE"

if [[ "$MODE" == "apply" ]]; then
  echo "Done: issues created from $DOC_PATH"
else
  echo "Dry-run complete. Use '--apply' to create issues."
fi
