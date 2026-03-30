#!/usr/bin/env python3
"""
Pragmatic Codex supervisor/orchestrator.

This runner keeps the parts of an outer Python process that still provide
real operational value:

- unattended execution
- conservative checkpoints and resume
- crash isolation
- strict filesystem policy enforcement
- at most one isolated helper task when the work is genuinely disjoint

It deliberately avoids simulating a large fake multi-agent org chart.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import fnmatch
import hashlib
import json
import os
import re
import shlex
import shutil
import signal
import sys
import textwrap
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


ROOT = Path.cwd()
DEFAULT_BRIEF = ROOT / "Project_description.md"
STATE_DIR = ROOT / ".new_orchestrator"
SCHEMAS_DIR = STATE_DIR / "schemas"
REPORTS_DIR = STATE_DIR / "reports"
MANIFESTS_DIR = STATE_DIR / "manifests"
CHECKPOINTS_JSON = STATE_DIR / "checkpoints.json"
PLAN_JSON = STATE_DIR / "plan.json"
FINAL_SUMMARY_JSON = STATE_DIR / "final_summary.json"
DECISION_LOG = STATE_DIR / "decision_log.jsonl"
RUNTIME_CONFIG_JSON = STATE_DIR / "runtime_config.json"
WORKTREES_DIR = ROOT / "tmp" / "new_orchestrator_worktrees"

PINK_BOLD = "\033[1;95m"
RESET = "\033[0m"

MODEL = os.getenv("CODEX_MODEL", "gpt-5.1-codex")
SANDBOX = os.getenv("CODEX_SANDBOX", "workspace-write")
APPROVAL_POLICY = os.getenv("CODEX_APPROVAL_POLICY", "never")
CODEX_TIMEOUT_SECONDS = int(os.getenv("CODEX_TIMEOUT_SECONDS", "1800"))
DEV_SERVER_SMOKE_SECONDS = int(os.getenv("DEV_SERVER_SMOKE_SECONDS", "20"))
DEV_SERVER_SHUTDOWN_GRACE_SECONDS = int(os.getenv("DEV_SERVER_SHUTDOWN_GRACE_SECONDS", "10"))
MAX_JSON_LINE = 8 * 1024 * 1024
MAX_INFRA_RETRIES = 2

EXCLUDED_SNAPSHOT_DIRS = {
    ".git",
    "__pycache__",
    "node_modules",
    ".next",
    ".venv",
    ".new_orchestrator",
    "tmp",
}

RETRYABLE_RUNTIME_PATTERNS = (
    "broken pipe",
    "connection reset",
    "transport closed",
    "unexpected eof",
    "timed out",
    "json decode",
    "stream ended unexpectedly",
)

BANNED_INSTALL_PATTERNS = (
    "npm install",
    "npm ci",
    "pnpm install",
    "yarn install",
    "bun install",
)

BASIC_DEV_SERVER_PATTERNS = (
    "./node_modules/.bin/next dev",
    "next dev",
    "npm run dev",
    "pnpm dev",
    "yarn dev",
    "bun dev",
)

REQUIRED_STAGE_NAMES = [
    "Environment preflight",
    "Planning",
    "Plan validation",
    "Implementation",
    "Blocking build validation",
    "Blocking runtime validation",
    "Final acceptance summary",
]
STAGE_NAME_TO_INDEX = {name: idx for idx, name in enumerate(REQUIRED_STAGE_NAMES, start=1)}
STAGE_SLUGS = {
    re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_"): idx
    for idx, name in enumerate(REQUIRED_STAGE_NAMES, start=1)
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_step(message: str) -> None:
    print(f"{PINK_BOLD}{message}{RESET}", flush=True)


def ensure_dirs() -> None:
    for path in (STATE_DIR, SCHEMAS_DIR, REPORTS_DIR, MANIFESTS_DIR, WORKTREES_DIR):
        path.mkdir(parents=True, exist_ok=True)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def append_jsonl(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=True) + "\n")


def sha256_bytes(data: bytes) -> str:
    digest = hashlib.sha256()
    digest.update(data)
    return digest.hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def iter_workspace_files(root: Path) -> Iterable[Path]:
    for path in root.rglob("*"):
        if path.is_dir():
            continue
        if any(part in EXCLUDED_SNAPSHOT_DIRS for part in path.parts):
            continue
        yield path


def snapshot_workspace(root: Path) -> Dict[str, Dict[str, Any]]:
    snapshot: Dict[str, Dict[str, Any]] = {}
    for path in iter_workspace_files(root):
        rel = str(path.relative_to(root))
        try:
            snapshot[rel] = {
                "sha256": sha256_file(path),
                "size": path.stat().st_size,
            }
        except FileNotFoundError:
            continue
    return snapshot


def diff_snapshots(before: Dict[str, Dict[str, Any]], after: Dict[str, Dict[str, Any]]) -> Dict[str, List[str]]:
    before_keys = set(before)
    after_keys = set(after)
    modified = [key for key in sorted(before_keys & after_keys) if before[key]["sha256"] != after[key]["sha256"]]
    return {
        "created": sorted(after_keys - before_keys),
        "modified": modified,
        "deleted": sorted(before_keys - after_keys),
    }


def matches_any_glob(rel_path: str, patterns: Sequence[str]) -> bool:
    for pattern in patterns:
        normalized = pattern.rstrip("/")
        if rel_path == pattern:
            return True
        if normalized and rel_path.startswith(f"{normalized}/"):
            return True
        if fnmatch.fnmatch(rel_path, pattern):
            return True
        if not any(ch in pattern for ch in "*?"):
            if normalized and rel_path == normalized:
                return True
    return False


@dataclass(frozen=True)
class StepPolicy:
    name: str
    allowed_create_globs: Tuple[str, ...]
    allowed_modify_globs: Tuple[str, ...]
    forbidden_globs: Tuple[str, ...] = ()
    frozen_inputs: Tuple[str, ...] = ()
    required_outputs: Tuple[str, ...] = ()
    allow_delete: bool = False


def enforce_policy(
    before: Dict[str, Dict[str, Any]],
    after: Dict[str, Dict[str, Any]],
    policy: StepPolicy,
) -> Dict[str, List[str]]:
    diff = diff_snapshots(before, after)
    violations: List[str] = []

    if diff["deleted"] and not policy.allow_delete:
        violations.append(f"Unexpected deletions: {diff['deleted'][:20]}")

    for rel in diff["created"]:
        if matches_any_glob(rel, policy.forbidden_globs):
            violations.append(f"Created forbidden path: {rel}")
        elif not matches_any_glob(rel, policy.allowed_create_globs):
            violations.append(f"Created outside allowlist: {rel}")

    for rel in diff["modified"]:
        if matches_any_glob(rel, policy.forbidden_globs):
            violations.append(f"Modified forbidden path: {rel}")
        elif not matches_any_glob(rel, policy.allowed_modify_globs):
            violations.append(f"Modified outside allowlist: {rel}")

    for rel in policy.frozen_inputs:
        if rel in diff["modified"]:
            violations.append(f"Modified frozen input: {rel}")

    for rel in policy.required_outputs:
        if rel not in after:
            violations.append(f"Required output missing: {rel}")

    if violations:
        raise RuntimeError(f"[{policy.name}] policy violation(s): " + "; ".join(violations))

    return diff


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def write_manifest(stage_index: int, stage_name: str, note: str) -> Path:
    snapshot = snapshot_workspace(ROOT)
    payload = {
        "stage_index": stage_index,
        "stage_name": stage_name,
        "note": note,
        "generated_at": utc_now(),
        "workspace_root": str(ROOT),
        "snapshot_sha256": sha256_bytes(json.dumps(snapshot, sort_keys=True).encode("utf-8")),
        "files": snapshot,
    }
    path = MANIFESTS_DIR / f"{stage_index:02d}_{slugify(stage_name)}.json"
    write_text(path, json.dumps(payload, indent=2))
    return path


def checkpoint_artifacts(stage_index: int) -> List[Path]:
    mapping = {
        1: [REPORTS_DIR / "environment_preflight.json"],
        2: [PLAN_JSON],
        3: [REPORTS_DIR / "plan_validation.json"],
        4: [REPORTS_DIR / "implementation_results.json"],
        5: [REPORTS_DIR / "build_validation.json"],
        6: [REPORTS_DIR / "runtime_validation.json"],
        7: [FINAL_SUMMARY_JSON],
    }
    return mapping[stage_index]


def load_checkpoints() -> Dict[str, Any]:
    if not CHECKPOINTS_JSON.exists():
        return {}
    data = json.loads(read_text(CHECKPOINTS_JSON))
    if not isinstance(data, dict):
        raise RuntimeError("Checkpoint file must be a JSON object")
    return data


def write_checkpoint(stage_index: int, stage_name: str, note: str, project_brief_path: Path) -> None:
    checkpoints = load_checkpoints()
    payload = {
        "stage_index": stage_index,
        "stage_name": stage_name,
        "note": note,
        "completed_at": utc_now(),
        "project_brief_path": str(project_brief_path.relative_to(ROOT)),
        "project_brief_sha256": sha256_file(project_brief_path),
        "orchestrator_sha256": sha256_file(Path(__file__)),
        "artifacts": [
            str(path.relative_to(ROOT))
            for path in checkpoint_artifacts(stage_index)
            if path.exists()
        ],
    }
    checkpoints[str(stage_index)] = payload
    write_text(CHECKPOINTS_JSON, json.dumps(checkpoints, indent=2))


def parse_resume_stage(value: Optional[str]) -> int:
    if not value:
        return 1
    raw = value.strip()
    if not raw:
        return 1
    if raw.isdigit():
        index = int(raw)
        if 1 <= index <= len(REQUIRED_STAGE_NAMES):
            return index
    if raw in REQUIRED_STAGE_NAMES:
        return STAGE_NAME_TO_INDEX[raw]
    normalized = re.sub(r"[^a-z0-9]+", "_", raw.lower()).strip("_")
    if normalized in STAGE_SLUGS:
        return STAGE_SLUGS[normalized]
    raise RuntimeError(f"Unknown resume stage: {value}")


def ensure_resume_prerequisites(resume_stage_index: int, project_brief_path: Path) -> None:
    checkpoints = load_checkpoints()
    current_brief_sha = sha256_file(project_brief_path)
    for stage_index in range(1, resume_stage_index):
        checkpoint = checkpoints.get(str(stage_index))
        if not checkpoint:
            raise RuntimeError(f"Cannot resume from stage {resume_stage_index}: missing checkpoint for stage {stage_index}")
        if checkpoint.get("project_brief_sha256") != current_brief_sha:
            raise RuntimeError(
                f"Cannot resume from stage {resume_stage_index}: project brief changed since stage {stage_index}"
            )
        for rel_path in checkpoint.get("artifacts", []):
            artifact_path = ROOT / rel_path
            if not artifact_path.exists():
                raise RuntimeError(
                    f"Cannot resume from stage {resume_stage_index}: missing artifact {rel_path} from stage {stage_index}"
                )


def require_command(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise RuntimeError(f"Required command not found: {name}")
    return path


async def run_command(args: Sequence[str], cwd: Path = ROOT, timeout: int = 120) -> Tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *args,
        cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError(f"Timed out running command: {' '.join(shlex.quote(part) for part in args)}")
    return proc.returncode, stdout.decode("utf-8", errors="replace"), stderr.decode("utf-8", errors="replace")


def command_needs_dev_server_smoke(command: str) -> bool:
    normalized = " ".join(command.strip().split()).lower()
    return any(pattern in normalized for pattern in BASIC_DEV_SERVER_PATTERNS)


async def _pump_stream(reader: Optional[asyncio.StreamReader], sink: List[bytes]) -> None:
    if reader is None:
        return
    while True:
        chunk = await reader.read(1024)
        if not chunk:
            break
        sink.append(chunk)


def _decode_chunks(chunks: List[bytes]) -> str:
    if not chunks:
        return ""
    return b"".join(chunks).decode("utf-8", errors="replace")


async def run_dev_server_smoke(command: str, cwd: Path = ROOT) -> Tuple[int, str, str, str]:
    proc = await asyncio.create_subprocess_exec(
        "bash",
        "-lc",
        command,
        cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout_chunks: List[bytes] = []
    stderr_chunks: List[bytes] = []
    stdout_task = asyncio.create_task(_pump_stream(proc.stdout, stdout_chunks))
    stderr_task = asyncio.create_task(_pump_stream(proc.stderr, stderr_chunks))
    note = ""
    try:
        await asyncio.wait_for(proc.wait(), timeout=DEV_SERVER_SMOKE_SECONDS)
        rc = proc.returncode
    except asyncio.TimeoutError:
        note = f"dev server smoke-ran for ~{DEV_SERVER_SMOKE_SECONDS}s and was terminated"
        with contextlib.suppress(ProcessLookupError):
            proc.send_signal(signal.SIGINT)
        try:
            await asyncio.wait_for(proc.wait(), timeout=DEV_SERVER_SHUTDOWN_GRACE_SECONDS)
            rc = 0
        except asyncio.TimeoutError:
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
            await proc.wait()
            rc = 1
            note += "; forced kill after shutdown timeout"
    finally:
        await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)
    return rc, _decode_chunks(stdout_chunks), _decode_chunks(stderr_chunks), note


@dataclass
class CodexRunResult:
    final_text: str
    usage: Dict[str, Any]
    events_seen: int
    stderr: str
    returncode: int


async def run_codex(prompt: str, *, cwd: Path, schema_path: Optional[Path] = None, timeout: Optional[int] = None) -> CodexRunResult:
    command = [
        "codex",
        "exec",
        "--experimental-json",
        "--model",
        MODEL,
        "--sandbox",
        SANDBOX,
        "--config",
        f'approval_policy="{APPROVAL_POLICY}"',
        "--skip-git-repo-check",
    ]
    if schema_path:
        command.extend(["--output-schema", str(schema_path)])

    proc = await asyncio.create_subprocess_exec(
        *command,
        cwd=str(cwd),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        limit=MAX_JSON_LINE,
        env=os.environ.copy(),
    )

    assert proc.stdin is not None
    proc.stdin.write(prompt.encode("utf-8"))
    await proc.stdin.drain()
    proc.stdin.close()

    final_text = ""
    usage: Dict[str, Any] = {}
    events_seen = 0
    error_messages: List[str] = []
    stderr_chunks: List[str] = []

    async def consume_stdout() -> None:
        nonlocal final_text, usage, events_seen
        assert proc.stdout is not None
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            decoded = line.decode("utf-8", errors="replace").strip()
            if not decoded:
                continue
            events_seen += 1
            event = json.loads(decoded)
            item = event.get("item", {})
            if event.get("type") == "item.completed" and item.get("type") == "agent_message":
                final_text = item.get("text", "")
            elif event.get("type") == "turn.completed":
                usage = event.get("usage") or {}
            elif event.get("type") in {"error", "turn.failed"}:
                message = event.get("message") or event.get("error", {}).get("message") or decoded
                error_messages.append(str(message).strip())

    async def consume_stderr() -> None:
        assert proc.stderr is not None
        while True:
            chunk = await proc.stderr.read(4096)
            if not chunk:
                break
            stderr_chunks.append(chunk.decode("utf-8", errors="replace"))

    tasks = [asyncio.create_task(consume_stdout()), asyncio.create_task(consume_stderr())]
    timeout = timeout or CODEX_TIMEOUT_SECONDS

    try:
        returncode = await asyncio.wait_for(proc.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise RuntimeError(f"codex exec timed out after {timeout} seconds")

    await asyncio.gather(*tasks, return_exceptions=True)
    stderr_text = "".join(stderr_chunks)
    if returncode != 0:
        details = " | ".join(part for part in [stderr_text.strip(), " || ".join(error_messages).strip()] if part)
        raise RuntimeError(f"codex exec failed ({returncode}): {details}")

    return CodexRunResult(
        final_text=final_text,
        usage=usage,
        events_seen=events_seen,
        stderr=stderr_text,
        returncode=returncode,
    )


def classify_infrastructure_failure(exc: Exception) -> str:
    text = str(exc).lower()
    if any(pattern in text for pattern in RETRYABLE_RUNTIME_PATTERNS):
        return "retryable_infrastructure"
    return "semantic_or_policy_failure"


def load_json(text: str) -> Dict[str, Any]:
    data = json.loads(text)
    if not isinstance(data, dict):
        raise RuntimeError("Expected a JSON object")
    return data


def write_schema(name: str, schema: Dict[str, Any]) -> Path:
    path = SCHEMAS_DIR / f"{name}.json"
    write_text(path, json.dumps(schema, indent=2))
    return path


def narrow_string_schema(min_length: int = 1) -> Dict[str, Any]:
    return {"type": "string", "minLength": min_length}


def repo_file_listing(limit: int = 400) -> List[str]:
    paths = sorted(str(path.relative_to(ROOT)) for path in iter_workspace_files(ROOT))
    return paths[:limit]


def planning_task_schema(include_run_mode: bool = False) -> Dict[str, Any]:
    properties: Dict[str, Any] = {
        "summary": narrow_string_schema(10),
        "owned_paths": {"type": "array", "items": narrow_string_schema(1), "minItems": 1},
        "required_outputs": {"type": "array", "items": narrow_string_schema(3), "minItems": 1},
        "read_only_inputs": {"type": "array", "items": narrow_string_schema(1)},
        "forbidden_paths": {"type": "array", "items": narrow_string_schema(1)},
        "validation_focus": {"type": "array", "items": narrow_string_schema(3), "minItems": 1},
    }
    required = ["summary", "owned_paths", "required_outputs", "read_only_inputs", "forbidden_paths", "validation_focus"]
    if include_run_mode:
        properties["run_mode"] = {"type": "string", "enum": ["parallel", "after_main"]}
        properties["isolation_rationale"] = narrow_string_schema(10)
        required.extend(["run_mode", "isolation_rationale"])
    return {
        "type": "object",
        "additionalProperties": False,
        "required": required,
        "properties": properties,
    }


def proof_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["name", "command", "blocking"],
        "properties": {
            "name": narrow_string_schema(3),
            "command": narrow_string_schema(3),
            "blocking": {"type": "boolean"},
        },
    }


def acceptance_item_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["requirement", "proof_names", "blocking"],
        "properties": {
            "requirement": narrow_string_schema(10),
            "proof_names": {"type": "array", "items": narrow_string_schema(3), "minItems": 1},
            "blocking": {"type": "boolean"},
        },
    }


def plan_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "task_summary",
            "project_brief_path",
            "implementation_mode",
            "main_task",
            "helper_tasks",
            "build_proofs",
            "runtime_proofs",
            "acceptance_criteria",
        ],
        "properties": {
            "task_summary": narrow_string_schema(10),
            "project_brief_path": {"type": "string", "const": "Project_description.md"},
            "implementation_mode": {
                "type": "object",
                "additionalProperties": False,
                "required": ["mode", "rationale"],
                "properties": {
                    "mode": {"type": "string", "enum": ["single_worker", "single_worker_with_helper"]},
                    "rationale": narrow_string_schema(10),
                },
            },
            "main_task": planning_task_schema(include_run_mode=False),
            "helper_tasks": {
                "type": "array",
                "maxItems": 1,
                "items": planning_task_schema(include_run_mode=True),
            },
            "build_proofs": {"type": "array", "items": proof_schema(), "minItems": 1},
            "runtime_proofs": {"type": "array", "items": proof_schema(), "minItems": 1},
            "acceptance_criteria": {"type": "array", "items": acceptance_item_schema(), "minItems": 3},
        },
    }


def worker_result_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["final_status", "changed_files", "summary", "blockers"],
        "properties": {
            "final_status": {"type": "string", "enum": ["completed", "blocked"]},
            "changed_files": {"type": "array", "items": narrow_string_schema(1)},
            "summary": narrow_string_schema(3),
            "blockers": {"type": "array", "items": narrow_string_schema(3)},
        },
    }


class PlanValidationError(RuntimeError):
    pass


def is_relative_pattern(value: str) -> bool:
    path = Path(value)
    return (
        bool(value.strip())
        and value == value.strip()
        and not path.is_absolute()
        and not value.startswith("./")
        and ".." not in path.parts
        and "\n" not in value
        and "\r" not in value
    )


def is_concrete_relative_file_path(value: str) -> bool:
    if not is_relative_pattern(value):
        return False
    path = Path(value)
    return bool(path.suffix) or path.name in {"Dockerfile", "Makefile", "README.md"}


def validate_task_scope(task: Dict[str, Any], name: str) -> List[str]:
    errors: List[str] = []
    for idx, value in enumerate(task.get("owned_paths", [])):
        if not is_relative_pattern(str(value)):
            errors.append(f"{name}.owned_paths[{idx}] must be a relative path or narrow glob")
    for idx, value in enumerate(task.get("required_outputs", [])):
        if not is_concrete_relative_file_path(str(value)):
            errors.append(f"{name}.required_outputs[{idx}] must be a concrete relative file path")
    for bucket in ("read_only_inputs", "forbidden_paths"):
        for idx, value in enumerate(task.get(bucket, [])):
            if not is_relative_pattern(str(value)):
                errors.append(f"{name}.{bucket}[{idx}] must be a relative path or narrow glob")
    required_outputs = set(task.get("required_outputs", []))
    owned_paths = list(task.get("owned_paths", []))
    for rel in required_outputs:
        if not matches_any_glob(rel, owned_paths):
            errors.append(f"{name}.required_outputs entry '{rel}' is not covered by owned_paths")
    return errors


def validate_plan(plan: Dict[str, Any]) -> Dict[str, Any]:
    errors: List[str] = []

    if plan.get("project_brief_path") != "Project_description.md":
        errors.append("project_brief_path must equal Project_description.md")

    mode = plan.get("implementation_mode", {}).get("mode")
    helper_tasks = plan.get("helper_tasks", [])
    if mode == "single_worker" and helper_tasks:
        errors.append("helper_tasks must be empty when implementation_mode.mode is single_worker")
    if mode == "single_worker_with_helper" and len(helper_tasks) != 1:
        errors.append("implementation_mode.mode single_worker_with_helper requires exactly one helper task")

    errors.extend(validate_task_scope(plan.get("main_task", {}), "main_task"))
    if helper_tasks:
        errors.extend(validate_task_scope(helper_tasks[0], "helper_tasks[0]"))

    main_owned = set(plan.get("main_task", {}).get("required_outputs", []))
    helper_owned = set(helper_tasks[0].get("required_outputs", [])) if helper_tasks else set()
    overlap = sorted(main_owned & helper_owned)
    if overlap:
        errors.append(f"main_task and helper_tasks[0] overlap on required outputs: {overlap}")

    proof_names: set[str] = set()
    for bucket in ("build_proofs", "runtime_proofs"):
        for idx, entry in enumerate(plan.get(bucket, [])):
            name = str(entry.get("name", "")).strip()
            command = str(entry.get("command", "")).strip()
            if not name:
                errors.append(f"{bucket}[{idx}].name is required")
            if name in proof_names:
                errors.append(f"proof name duplicates existing proof: {name}")
            proof_names.add(name)
            if not command:
                errors.append(f"{bucket}[{idx}].command is required")
            lower = command.lower()
            if any(pattern in lower for pattern in BANNED_INSTALL_PATTERNS):
                errors.append(f"{bucket}[{idx}].command uses a banned install command")

    blocking_proofs = {
        entry["name"]
        for bucket in ("build_proofs", "runtime_proofs")
        for entry in plan.get(bucket, [])
        if entry.get("blocking")
    }
    if not blocking_proofs:
        errors.append("plan must contain at least one blocking proof")

    for idx, item in enumerate(plan.get("acceptance_criteria", [])):
        for proof_name in item.get("proof_names", []):
            if proof_name not in proof_names:
                errors.append(f"acceptance_criteria[{idx}] references unknown proof '{proof_name}'")
        if item.get("blocking") and not any(proof_name in blocking_proofs for proof_name in item.get("proof_names", [])):
            errors.append(f"acceptance_criteria[{idx}] is blocking but references no blocking proofs")

    if errors:
        raise PlanValidationError("; ".join(errors))

    return {
        "status": "valid",
        "proof_names": sorted(proof_names),
        "blocking_proofs": sorted(blocking_proofs),
    }


def load_project_brief(path: Path) -> str:
    if not path.exists():
        raise RuntimeError(f"Project brief not found: {path}")
    text = read_text(path)
    if len(text.strip()) < 1000:
        raise RuntimeError("Project_description.md is unexpectedly short")
    append_jsonl(
        DECISION_LOG,
        {
            "timestamp": utc_now(),
            "type": "project_brief_ingested",
            "path": str(path.relative_to(ROOT)),
            "char_count": len(text),
            "line_count": len(text.splitlines()),
            "sha256": sha256_bytes(text.encode("utf-8")),
        },
    )
    return text


def planning_prompt(project_brief: str, repo_files: Sequence[str]) -> str:
    return f"""\
You are the Planning Agent inside a pragmatic Codex supervisor/orchestrator.

Your job is to create a machine-checkable run plan for a repository implementation run.

Architectural rules:
- do not simulate a large multi-agent org chart
- default to one main worker
- create at most one helper worker
- helper worker is allowed only when its file scope is genuinely disjoint and isolation is justified
- if in doubt, keep the work in the main worker

Plan requirements:
- return only JSON matching the required schema
- read the full brief below as the canonical source of requirements
- main_task may use narrow file globs when concrete file lists would be impractical
- required_outputs must be concrete relative file paths
- helper_tasks must have length 0 or 1
- helper run_mode must be `parallel` only if file scopes are disjoint enough to safely run at the same time
- include real blocking build and runtime proofs when the local repo clearly contains the needed tooling
- do not use install commands as proofs
- final acceptance will be computed from proof results, so choose proofs carefully

Repository file listing sample:
{json.dumps(list(repo_files), indent=2)}

Project_description.md (full text):
{project_brief}
"""


def task_is_frontend_oriented(task: Dict[str, Any]) -> bool:
    fields: List[str] = [task.get("summary", "")]
    for key in ("owned_paths", "required_outputs", "read_only_inputs"):
        value = task.get(key, [])
        if isinstance(value, list):
            fields.extend(str(item) for item in value)
    haystack = "\n".join(fields).lower()
    frontend_markers = (
        "frontend",
        "ui",
        "ux",
        "next.js",
        "react",
        "webgl",
        "webgpu",
        "app/",
        "components/",
        ".tsx",
        ".jsx",
        ".css",
    )
    return any(marker in haystack for marker in frontend_markers)


def implementation_prompt(
    worker_name: str,
    task: Dict[str, Any],
    project_brief: str,
    plan_json: str,
) -> str:
    owned_paths = "\n".join(f"- {item}" for item in task["owned_paths"])
    forbidden_paths = "\n".join(f"- {item}" for item in task.get("forbidden_paths", [])) or "- (none)"
    readonly_inputs = "\n".join(f"- {item}" for item in task.get("read_only_inputs", [])) or "- (none)"
    required_outputs = "\n".join(f"- {item}" for item in task["required_outputs"])
    validation_focus = "\n".join(f"- {item}" for item in task.get("validation_focus", []))
    frontend_skill_section = ""
    if task_is_frontend_oriented(task):
        frontend_skill_section = """

Frontend skill requirement:
- Explicitly use `frontend-skill` for this task.
- Apply it as the governing rubric for visual, interaction, and layout quality in your owned scope.
"""

    return f"""\
You are the {worker_name} inside a pragmatic Codex supervisor.

This is not a fake team simulation. You are an implementation worker operating under strict filesystem policy.

Rules:
- use only repository state, shared artifacts, and the full Project_description.md below
- do not assume hidden requirements
- do not revert unrelated user changes
- stay inside the editable scope below
- do not modify forbidden or read-only inputs
- make the smallest durable changes needed
- return only JSON matching the required schema

Editable scope:
{owned_paths}

Forbidden paths:
{forbidden_paths}

Read-only inputs:
{readonly_inputs}

Required outputs:
{required_outputs}

Task summary:
{task["summary"]}

Validation focus:
{validation_focus}
{frontend_skill_section}

Plan:
{plan_json}

Project_description.md (full text):
{project_brief}
"""


@dataclass
class WorkerResult:
    worker_name: str
    final_status: str
    changed_files: List[str]
    summary: str
    blockers: List[str]
    usage: Dict[str, Any] = field(default_factory=dict)
    retries: int = 0


async def ensure_git_worktree(path: Path) -> None:
    await run_command(["git", "worktree", "prune"], cwd=ROOT, timeout=120)
    if path.exists():
        shutil.rmtree(path)
    rc, _, stderr = await run_command(["git", "worktree", "remove", "--force", str(path)], cwd=ROOT, timeout=120)
    if rc != 0 and "is not a working tree" not in stderr and "is a main working tree" not in stderr:
        raise RuntimeError(f"Failed to clear existing git worktree registration at {path}: {stderr}")
    rc, _, stderr = await run_command(["git", "worktree", "add", "--detach", "--force", str(path), "HEAD"], cwd=ROOT, timeout=120)
    if rc != 0:
        raise RuntimeError(f"Failed to create git worktree at {path}: {stderr}")


async def remove_git_worktree(path: Path) -> None:
    await run_command(["git", "worktree", "prune"], cwd=ROOT, timeout=120)
    rc, _, stderr = await run_command(["git", "worktree", "remove", "--force", str(path)], cwd=ROOT, timeout=120)
    if path.exists():
        shutil.rmtree(path)
    if rc != 0 and "is not a working tree" not in stderr:
        raise RuntimeError(f"Failed to remove git worktree {path}: {stderr}")
    await run_command(["git", "worktree", "prune"], cwd=ROOT, timeout=120)


def copy_selected_paths(source_root: Path, dest_root: Path, paths: Iterable[str]) -> List[str]:
    copied: List[str] = []
    for rel in sorted(set(paths)):
        src = source_root / rel
        dst = dest_root / rel
        if not src.exists():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied.append(rel)
    return copied


def collect_matching_files(root: Path, patterns: Sequence[str]) -> List[str]:
    concrete_files = [str(path.relative_to(root)) for path in iter_workspace_files(root)]
    return [rel for rel in concrete_files if matches_any_glob(rel, patterns)]


def hydrate_worktree_from_root(worktree_path: Path, patterns: Iterable[str], required_outputs: Iterable[str]) -> List[str]:
    hydrated: List[str] = []
    pattern_list = [pattern for pattern in patterns if pattern]
    concrete_files = [str(path.relative_to(ROOT)) for path in iter_workspace_files(ROOT)]
    candidates = set(required_outputs)
    for rel in concrete_files:
        if matches_any_glob(rel, pattern_list):
            candidates.add(rel)
    for rel in sorted(candidates):
        src = ROOT / rel
        if not src.exists():
            continue
        dst = worktree_path / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        hydrated.append(rel)
    return hydrated


async def run_worker(
    worker_name: str,
    task: Dict[str, Any],
    project_brief: str,
    plan_payload: Dict[str, Any],
    worktree_path: Optional[Path],
    keep_worktrees: bool,
) -> WorkerResult:
    schema_path = write_schema(f"{slugify(worker_name)}_result", worker_result_schema())
    prompt = implementation_prompt(worker_name, task, project_brief, json.dumps(plan_payload, indent=2))
    owned_patterns = tuple(task["owned_paths"])
    frozen_inputs = tuple(task.get("read_only_inputs", []))
    required_outputs = tuple(task["required_outputs"])
    forbidden = tuple(task.get("forbidden_paths", []))

    for attempt in range(MAX_INFRA_RETRIES + 1):
        target_root = ROOT
        if worktree_path is not None:
            await ensure_git_worktree(worktree_path)
            hydrate_worktree_from_root(
                worktree_path,
                [*task.get("owned_paths", []), *task.get("read_only_inputs", []), *task.get("forbidden_paths", [])],
                task.get("required_outputs", []),
            )
            target_root = worktree_path

        before = snapshot_workspace(target_root)
        try:
            log_step(f"Worker launch: {worker_name} (attempt {attempt + 1})")
            result = await run_codex(prompt, cwd=target_root, schema_path=schema_path)
            payload = load_json(result.final_text)
            after = snapshot_workspace(target_root)
            policy = StepPolicy(
                name=worker_name,
                allowed_create_globs=owned_patterns,
                allowed_modify_globs=owned_patterns,
                forbidden_globs=forbidden,
                frozen_inputs=frozen_inputs,
                required_outputs=required_outputs,
            )
            enforce_policy(before, after, policy)
            if worktree_path is not None:
                copied = copy_selected_paths(target_root, ROOT, collect_matching_files(target_root, owned_patterns))
            else:
                copied = payload.get("changed_files", [])
            append_jsonl(
                DECISION_LOG,
                {
                    "timestamp": utc_now(),
                    "type": "worker_completed",
                    "worker_name": worker_name,
                    "attempt": attempt + 1,
                    "copied_paths": copied,
                    "usage": result.usage,
                },
            )
            if worktree_path is not None:
                if keep_worktrees:
                    log_step(f"Preserving helper worktree: {worktree_path}")
                else:
                    await remove_git_worktree(worktree_path)
            return WorkerResult(
                worker_name=worker_name,
                final_status=payload["final_status"],
                changed_files=list(payload.get("changed_files", [])),
                summary=payload["summary"],
                blockers=list(payload.get("blockers", [])),
                usage=result.usage,
                retries=attempt,
            )
        except Exception as exc:
            failure_class = classify_infrastructure_failure(exc)
            append_jsonl(
                DECISION_LOG,
                {
                    "timestamp": utc_now(),
                    "type": "worker_failure",
                    "worker_name": worker_name,
                    "attempt": attempt + 1,
                    "failure_class": failure_class,
                    "error": str(exc),
                },
            )
            if worktree_path is not None:
                if keep_worktrees:
                    log_step(f"Preserving failed helper worktree: {worktree_path}")
                else:
                    await remove_git_worktree(worktree_path)
            if failure_class == "retryable_infrastructure" and attempt < MAX_INFRA_RETRIES:
                log_step(f"Retrying {worker_name} after retryable infrastructure failure")
                continue
            raise
    raise RuntimeError(f"Worker {worker_name} ended unexpectedly")


def load_json_file(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    data = json.loads(read_text(path))
    if not isinstance(data, dict):
        raise RuntimeError(f"Expected JSON object in {path}")
    return data


async def run_proofs(entries: Sequence[Dict[str, Any]], report_name: str) -> Dict[str, Any]:
    results: List[Dict[str, Any]] = []
    failed_blocking = False
    for entry in entries:
        command = str(entry["command"]).strip()
        lower = command.lower()
        if any(pattern in lower for pattern in BANNED_INSTALL_PATTERNS):
            results.append(
                {
                    "name": entry["name"],
                    "command": command,
                    "blocking": bool(entry.get("blocking", True)),
                    "returncode": None,
                    "status": "rejected",
                    "stdout_tail": "",
                    "stderr_tail": "",
                    "note": "banned install command rejected",
                }
            )
            if entry.get("blocking", True):
                failed_blocking = True
            continue
        note = ""
        if command_needs_dev_server_smoke(command):
            rc, stdout, stderr, note = await run_dev_server_smoke(command, cwd=ROOT)
        else:
            rc, stdout, stderr = await run_command(["bash", "-lc", command], cwd=ROOT, timeout=300)
        status = "passed" if rc == 0 else "failed"
        if rc != 0 and entry.get("blocking", True):
            failed_blocking = True
        results.append(
            {
                "name": entry["name"],
                "command": command,
                "blocking": bool(entry.get("blocking", True)),
                "returncode": rc,
                "status": status,
                "stdout_tail": stdout[-2000:],
                "stderr_tail": stderr[-2000:],
                **({"note": note} if note else {}),
            }
        )

    overall_status = "passed" if not failed_blocking else "failed"
    return {
        "status": overall_status,
        "report_name": report_name,
        "results": results,
    }


async def stage_environment_preflight(project_brief: str) -> Dict[str, Any]:
    log_step("Stage 1/7: Environment preflight")
    ensure_dirs()
    codex_path = require_command("codex")
    git_path = require_command("git")
    python_path = require_command("python3")
    node_path = shutil.which("node")
    npm_path = shutil.which("npm")

    if "Next.js" in project_brief and (not node_path or not npm_path):
        raise RuntimeError("Project brief requires Next.js, but node or npm is missing")

    versions: Dict[str, str] = {}
    for name, command in (
        ("codex", [codex_path, "--version"]),
        ("git", [git_path, "--version"]),
        ("python3", [python_path, "--version"]),
    ):
        rc, stdout, stderr = await run_command(command, cwd=ROOT, timeout=60)
        if rc != 0:
            raise RuntimeError(f"Preflight failed for {name}: {stderr}")
        versions[name] = (stdout or stderr).strip()

    if node_path:
        rc, stdout, stderr = await run_command([node_path, "--version"], cwd=ROOT, timeout=60)
        if rc == 0:
            versions["node"] = (stdout or stderr).strip()
    if npm_path:
        rc, stdout, stderr = await run_command([npm_path, "--version"], cwd=ROOT, timeout=60)
        if rc == 0:
            versions["npm"] = (stdout or stderr).strip()

    rc, stdout, stderr = await run_command(["git", "status", "--short"], cwd=ROOT, timeout=60)
    if rc != 0:
        raise RuntimeError(f"git status failed: {stderr}")

    report = {
        "status": "passed",
        "versions": versions,
        "git_status_short": stdout.splitlines(),
    }
    write_text(REPORTS_DIR / "environment_preflight.json", json.dumps(report, indent=2))
    return report


async def stage_planning(project_brief: str) -> Dict[str, Any]:
    log_step("Stage 2/7: Planning")
    schema_path = write_schema("plan", plan_schema())
    result = await run_codex(
        planning_prompt(project_brief, repo_file_listing()),
        cwd=ROOT,
        schema_path=schema_path,
    )
    payload = load_json(result.final_text)
    write_text(PLAN_JSON, json.dumps(payload, indent=2))
    append_jsonl(
        DECISION_LOG,
        {
            "timestamp": utc_now(),
            "type": "plan_generated",
            "usage": result.usage,
            "implementation_mode": payload.get("implementation_mode", {}).get("mode"),
        },
    )
    return payload


async def stage_plan_validation(plan_payload: Dict[str, Any]) -> Dict[str, Any]:
    log_step("Stage 3/7: Plan validation")
    report = validate_plan(plan_payload)
    write_text(REPORTS_DIR / "plan_validation.json", json.dumps({"status": "valid", "details": report}, indent=2))
    return report


async def stage_implementation(
    project_brief: str,
    plan_payload: Dict[str, Any],
    keep_worktrees: bool,
) -> Dict[str, Any]:
    log_step("Stage 4/7: Implementation")
    main_task = plan_payload["main_task"]
    helper_tasks = plan_payload.get("helper_tasks", [])
    helper_task = helper_tasks[0] if helper_tasks else None

    main_future = asyncio.create_task(
        run_worker("Main Worker", main_task, project_brief, plan_payload, None, keep_worktrees)
    )

    helper_result: Optional[WorkerResult] = None
    main_result: WorkerResult

    if helper_task and helper_task.get("run_mode") == "parallel":
        helper_future = asyncio.create_task(
            run_worker(
                "Helper Worker",
                helper_task,
                project_brief,
                plan_payload,
                WORKTREES_DIR / "helper_worker",
                keep_worktrees,
            )
        )
        main_result, helper_result = await asyncio.gather(main_future, helper_future)
    else:
        main_result = await main_future
        if helper_task:
            helper_result = await run_worker(
                "Helper Worker",
                helper_task,
                project_brief,
                plan_payload,
                WORKTREES_DIR / "helper_worker",
                keep_worktrees,
            )

    results = {
        "status": "completed" if main_result.final_status == "completed" and (helper_result is None or helper_result.final_status == "completed") else "blocked",
        "workers": [asdict(main_result)] + ([asdict(helper_result)] if helper_result else []),
    }
    write_text(REPORTS_DIR / "implementation_results.json", json.dumps(results, indent=2))
    return results


async def stage_build_validation(plan_payload: Dict[str, Any]) -> Dict[str, Any]:
    log_step("Stage 5/7: Blocking build validation")
    report = await run_proofs(plan_payload["build_proofs"], "build_validation")
    write_text(REPORTS_DIR / "build_validation.json", json.dumps(report, indent=2))
    if report["status"] != "passed":
        raise RuntimeError("Blocking build validation failed")
    return report


async def stage_runtime_validation(plan_payload: Dict[str, Any]) -> Dict[str, Any]:
    log_step("Stage 6/7: Blocking runtime validation")
    report = await run_proofs(plan_payload["runtime_proofs"], "runtime_validation")
    write_text(REPORTS_DIR / "runtime_validation.json", json.dumps(report, indent=2))
    if report["status"] != "passed":
        raise RuntimeError("Blocking runtime validation failed")
    return report


def summarize_acceptance(plan_payload: Dict[str, Any], build_report: Dict[str, Any], runtime_report: Dict[str, Any]) -> List[Dict[str, Any]]:
    proof_status = {
        item["name"]: item["status"]
        for report in (build_report, runtime_report)
        for item in report.get("results", [])
    }
    acceptance_summary: List[Dict[str, Any]] = []
    for item in plan_payload.get("acceptance_criteria", []):
        proof_results = {name: proof_status.get(name, "missing") for name in item.get("proof_names", [])}
        passed = all(status == "passed" for status in proof_results.values())
        acceptance_summary.append(
            {
                "requirement": item["requirement"],
                "blocking": bool(item.get("blocking", False)),
                "proof_results": proof_results,
                "status": "passed" if passed else "failed",
            }
        )
    return acceptance_summary


async def stage_final_summary(project_brief_path: Path, plan_payload: Dict[str, Any]) -> Dict[str, Any]:
    log_step("Stage 7/7: Final acceptance summary")
    implementation_results = load_json_file(REPORTS_DIR / "implementation_results.json")
    build_report = load_json_file(REPORTS_DIR / "build_validation.json")
    runtime_report = load_json_file(REPORTS_DIR / "runtime_validation.json")
    acceptance = summarize_acceptance(plan_payload, build_report, runtime_report)
    blocking_failures = [
        item for item in acceptance if item.get("blocking") and item.get("status") != "passed"
    ]
    summary = {
        "status": "passed" if not blocking_failures else "failed",
        "project_brief_path": str(project_brief_path.relative_to(ROOT)),
        "project_brief_sha256": sha256_file(project_brief_path),
        "implementation_mode": plan_payload.get("implementation_mode", {}),
        "implementation_results": implementation_results,
        "build_validation": build_report,
        "runtime_validation": runtime_report,
        "acceptance": acceptance,
        "generated_at": utc_now(),
    }
    write_text(FINAL_SUMMARY_JSON, json.dumps(summary, indent=2))
    if summary["status"] != "passed":
        raise RuntimeError("Final acceptance failed because one or more blocking requirements did not pass")
    return summary


def write_runtime_config(project_brief_path: Path, keep_worktrees: bool) -> None:
    payload = {
        "model": MODEL,
        "sandbox_mode": SANDBOX,
        "approval_policy": APPROVAL_POLICY,
        "workspace_root": str(ROOT),
        "timeout_policy_seconds": CODEX_TIMEOUT_SECONDS,
        "project_brief_path": str(project_brief_path.relative_to(ROOT)),
        "state_dir": str(STATE_DIR.relative_to(ROOT)),
        "keep_worktrees": keep_worktrees,
    }
    write_text(RUNTIME_CONFIG_JSON, json.dumps(payload, indent=2))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Pragmatic Codex supervisor/orchestrator")
    parser.add_argument("--project-brief", default=str(DEFAULT_BRIEF), help="Path to Project_description.md")
    parser.add_argument("--resume-from-stage", default="", help="Resume from a stage index, exact stage name, or stage slug")
    parser.add_argument("--keep-worktrees", action="store_true", help="Preserve helper worktrees under tmp/new_orchestrator_worktrees")
    parser.add_argument("--dry-run-preflight", action="store_true", help="Run only environment preflight and exit")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    ensure_dirs()

    project_brief_path = Path(args.project_brief)
    if not project_brief_path.is_absolute():
        project_brief_path = ROOT / project_brief_path
    project_brief = load_project_brief(project_brief_path)
    write_runtime_config(project_brief_path, args.keep_worktrees)

    resume_stage_index = parse_resume_stage(args.resume_from_stage)
    if resume_stage_index > 1:
        ensure_resume_prerequisites(resume_stage_index, project_brief_path)
        log_step(f"Resuming from Stage {resume_stage_index}/7: {REQUIRED_STAGE_NAMES[resume_stage_index - 1]}")

    if resume_stage_index <= 1:
        await stage_environment_preflight(project_brief)
        write_manifest(1, REQUIRED_STAGE_NAMES[0], "Environment preflight complete")
        write_checkpoint(1, REQUIRED_STAGE_NAMES[0], "Environment preflight complete", project_brief_path)
    else:
        log_step("Resume skip: Stage 1/7: Environment preflight")
    if args.dry_run_preflight:
        log_step("Dry-run preflight completed")
        return

    if resume_stage_index <= 2:
        plan_payload = await stage_planning(project_brief)
        write_manifest(2, REQUIRED_STAGE_NAMES[1], "Planning complete")
        write_checkpoint(2, REQUIRED_STAGE_NAMES[1], "Planning complete", project_brief_path)
    else:
        log_step("Resume skip: Stage 2/7: Planning")
        plan_payload = load_json_file(PLAN_JSON)

    if resume_stage_index <= 3:
        await stage_plan_validation(plan_payload)
        write_manifest(3, REQUIRED_STAGE_NAMES[2], "Plan validation complete")
        write_checkpoint(3, REQUIRED_STAGE_NAMES[2], "Plan validation complete", project_brief_path)
    else:
        log_step("Resume skip: Stage 3/7: Plan validation")

    if resume_stage_index <= 4:
        await stage_implementation(project_brief, plan_payload, args.keep_worktrees)
        write_manifest(4, REQUIRED_STAGE_NAMES[3], "Implementation complete")
        write_checkpoint(4, REQUIRED_STAGE_NAMES[3], "Implementation complete", project_brief_path)
    else:
        log_step("Resume skip: Stage 4/7: Implementation")

    if resume_stage_index <= 5:
        await stage_build_validation(plan_payload)
        write_manifest(5, REQUIRED_STAGE_NAMES[4], "Build validation complete")
        write_checkpoint(5, REQUIRED_STAGE_NAMES[4], "Build validation complete", project_brief_path)
    else:
        log_step("Resume skip: Stage 5/7: Blocking build validation")

    if resume_stage_index <= 6:
        await stage_runtime_validation(plan_payload)
        write_manifest(6, REQUIRED_STAGE_NAMES[5], "Runtime validation complete")
        write_checkpoint(6, REQUIRED_STAGE_NAMES[5], "Runtime validation complete", project_brief_path)
    else:
        log_step("Resume skip: Stage 6/7: Blocking runtime validation")

    if resume_stage_index <= 7:
        await stage_final_summary(project_brief_path, plan_payload)
        write_manifest(7, REQUIRED_STAGE_NAMES[6], "Final summary complete")
        write_checkpoint(7, REQUIRED_STAGE_NAMES[6], "Final summary complete", project_brief_path)

    append_jsonl(
        DECISION_LOG,
        {
            "timestamp": utc_now(),
            "type": "run_complete",
            "resume_from_stage": resume_stage_index,
            "status": "passed",
        },
    )
    log_step("Workflow completed successfully")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        sys.exit(130)
