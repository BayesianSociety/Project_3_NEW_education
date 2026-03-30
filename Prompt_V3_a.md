This prompt defines a pragmatic Python 3.10 supervisor/orchestrator for Codex that preserves the real value of an outer process without simulating a fake multi-agent org chart.

# Goal

Build a production-oriented Python 3.10 supervisor/orchestrator named `new_orchestrator.py`.

The system must use `codex exec` as its execution mechanism, but it must not pretend that isolated subprocesses are inherently valuable as "agents" on their own.

The outer Python process exists for operational control:

- unattended batch runs
- resumable overnight jobs
- crash isolation
- strict filesystem policy enforcement
- launching one isolated worker only when there is a genuinely disjoint task

Do not use the OpenAI API or Codex SDK.

# Required brief handling

The system must read `Project_description.md` in full before any planning or implementation work starts.

It must treat `Project_description.md` as the canonical brief for the run and derive from it:

- scope
- constraints
- success criteria
- required outputs
- validation expectations
- stack expectations

It must not assume hidden requirements outside:

- repository state
- shared artifacts written by the orchestrator
- `Project_description.md`

# Core architectural principle

Do not simulate a large team of fake subprocess agents.

Instead, implement this model:

1. One outer Python supervisor/orchestrator
2. One Codex planning step
3. One main Codex implementation worker
4. Zero or one isolated helper worker only if the task is truly disjoint

Default behavior must be:

- one main implementation worker
- no helper worker

A helper worker is allowed only when all of these are true:

- the helper owns a clearly disjoint file scope
- the helper has minimal coordination needs with the main worker
- the helper can be validated independently enough to justify isolation
- using a helper reduces risk of collisions or meaningfully improves throughput

If those conditions are not met, the planner must keep the work in the main worker.

# What the outer Python process is for

## 1. Unattended operational control

The orchestrator must be able to:

- launch long Codex runs
- stream output to the terminal
- capture structured usage and result payloads
- persist logs and reports
- stop after bounded failures

## 2. Resume and checkpoints

The orchestrator must:

- checkpoint after each completed stage
- record stage artifacts and the project brief hash
- support conservative resume from a chosen stage
- verify prerequisite artifacts before resuming
- prefer restarting from an earlier stage when validity is uncertain

## 3. Crash isolation

Each Codex execution must run as a subprocess so the parent Python process can:

- detect hangs
- enforce timeouts
- classify and record failures
- retry only clearly retryable infrastructure failures
- keep the run state intact even if a child execution fails

## 4. Strict filesystem policy

The orchestrator must:

- snapshot the workspace before and after each editable step
- diff created, modified, and deleted files
- enforce an allowlist of editable paths per worker
- support frozen read-only inputs
- reject edits outside the approved scope

For helper workers, policy must apply to the helper's approved scope only.

## 5. Optional isolated helper

If a helper worker is justified, it must:

- run in its own git worktree
- own only its declared scope
- never be created just to mimic "multi-agent"
- be optional and bounded

The helper may run in parallel with the main worker only when the plan explicitly says parallel execution is safe and the file scopes are disjoint.

# Required stages

Keep stages explicit and operationally useful.

Use these stages in order:

1. Environment preflight
2. Planning
3. Plan validation
4. Implementation
5. Blocking build validation
6. Blocking runtime validation
7. Final acceptance summary

The stages must be checkpointed and resumable.

# Planning requirements

Planning must be a Codex step that produces a machine-checkable JSON plan.

The plan must include:

- `task_summary`
- `project_brief_path`
- `implementation_mode`
- `main_task`
- optional `helper_tasks` with length at most 1
- `build_proofs`
- `runtime_proofs`
- `acceptance_criteria`

## Implementation mode

The plan must explicitly choose one of:

- `single_worker`
- `single_worker_with_helper`

It must also explain why that mode is appropriate.

## Main task

The main task must include:

- summary
- owned paths or narrow path globs
- required outputs as concrete relative file paths
- read-only inputs
- forbidden paths or globs
- validation focus

## Optional helper task

If present, the helper task must include:

- summary
- owned paths or narrow path globs
- required outputs as concrete relative file paths
- read-only inputs
- forbidden paths or globs
- validation focus
- `run_mode` of either `parallel` or `after_main`
- a rationale for why isolation is justified

The plan must not emit a helper task unless the helper is genuinely disjoint.

## Proofs and acceptance

The plan must include blocking proofs, not just artifact existence checks.

Rules:

- every critical requirement must map to one or more proofs
- build proofs and runtime proofs must be executable shell commands
- proof results must drive final success
- final success must not be computed from stage completion alone
- if a blocking proof fails, final success must fail
- advisory mode must not exist unless behind an explicit debug flag

If local dependencies and tooling exist, the planner must prefer real executable proofs over artifact-only substitutes.

Do not use install commands such as:

- `npm install`
- `npm ci`
- `pnpm install`
- `yarn install`
- `bun install`

as build or runtime proofs.

# Validation and acceptance rules

Build and runtime validation are blocking.

Requirements:

- failed blocking build proofs must fail the run
- failed blocking runtime proofs must fail the run
- skipped required blocking proofs must fail the run
- final acceptance must summarize proof outcomes and worker outcomes
- final acceptance must never hardcode success

The orchestrator must not report success merely because:

- files were created
- workers returned "completed"
- a plan existed

It must report success only when all blocking proofs in the plan pass.

# Execution engine requirements

All Codex calls must go through one common execution path that:

- runs `codex exec`
- supports `--output-schema`
- captures structured JSON event output
- extracts the final message payload
- records usage
- records stderr
- enforces timeouts

The orchestrator must surface structured error payloads when available rather than relying only on generic stderr text.

# Worktree policy

Use git worktrees only for the optional helper.

Requirements:

- prune stale worktrees before adding a helper worktree
- remove existing registrations if needed
- support reruns after interrupted helper execution
- remove helper worktrees on success unless the user requests to keep them

The main worker should normally edit in the main workspace.

# Prompting rules for implementation workers

The main worker and optional helper must be instructed to:

- use only repository state, shared artifacts, and `Project_description.md`
- stay inside their declared editable scope
- not revert unrelated user changes
- return a structured JSON result

If a task is frontend-oriented, the worker prompt should explicitly require use of `frontend-skill`.

# Suggested output schema shapes

## Plan schema

The plan schema should be narrow, typed, and repairable.

It should include:

- `task_summary`
- `project_brief_path`
- `implementation_mode`
- `main_task`
- `helper_tasks`
- `build_proofs`
- `runtime_proofs`
- `acceptance_criteria`

## Worker result schema

The worker result schema should include:

- `final_status`
- `changed_files`
- `summary`
- `blockers`

# Failure handling

The orchestrator may retry only clearly retryable infrastructure failures such as:

- transport interruption
- timeout
- malformed transient subprocess output

It must not silently retry semantic failures indefinitely.

All failures must be persisted in logs or reports with:

- stage
- error summary
- timestamp

# Final expectation

The generated `new_orchestrator.py` should be materially simpler than a fake multi-agent hub-and-spoke system.

It should optimize for:

- operational reliability
- strict policy enforcement
- resumability
- blocking proofs
- one main worker by default
- one helper worker only when isolation is genuinely justified

It should not optimize for:

- role theater
- unnecessary subprocess proliferation
- broad fake team decomposition
