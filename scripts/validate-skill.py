#!/usr/bin/env python3
"""Portable repository checks for the watch Agent Skill."""

from pathlib import Path
import re
import sys


def fail(message: str) -> None:
    print(f"Skill validation failed: {message}", file=sys.stderr)
    raise SystemExit(1)


root = Path(sys.argv[1] if len(sys.argv) > 1 else "skills/watch")
skill_path = root / "SKILL.md"
agent_path = root / "agents" / "openai.yaml"
if not skill_path.is_file() or not agent_path.is_file():
    fail("SKILL.md and agents/openai.yaml are required")

text = skill_path.read_text(encoding="utf-8")
match = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
if not match:
    fail("SKILL.md must start with YAML frontmatter")
frontmatter = match.group(1)
name_match = re.search(r"^name:\s*(.+)$", frontmatter, re.MULTILINE)
description_match = re.search(r"^description:\s*(.+)$", frontmatter, re.MULTILINE)
if not name_match or name_match.group(1).strip() != root.name:
    fail("frontmatter name must match the skill directory")
if not re.fullmatch(r"[a-z0-9-]{1,64}", root.name):
    fail("skill name must be lowercase kebab-case")
if not description_match or not 1 <= len(description_match.group(1).strip()) <= 1024:
    fail("description is required and must be at most 1024 characters")

agent = agent_path.read_text(encoding="utf-8")
for field in ("display_name", "short_description", "default_prompt"):
    if not re.search(rf"^\s+{field}:\s+\".+\"$", agent, re.MULTILINE):
        fail(f"agents/openai.yaml must contain a quoted {field}")
if "$watch" not in agent:
    fail("default_prompt must mention $watch")
if not re.search(r"^\s+allow_implicit_invocation:\s+false$", agent, re.MULTILINE):
    fail("allow_implicit_invocation must be false")

for reference in re.findall(r"\]\((references/[^)]+)\)", text):
    if not (root / reference).is_file():
        fail(f"missing referenced file: {reference}")

print("Skill is valid!")

