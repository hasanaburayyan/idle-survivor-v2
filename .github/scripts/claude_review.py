"""
Claude PR Code Reviewer
-----------------------
Reads CLAUDE.md (as system prompt), the PR diff, and the full content of changed
files, then asks Claude to produce a structured review. The result is posted back
to the PR as a formal GitHub review (APPROVE / REQUEST_CHANGES / COMMENT).
"""

import json
import os
import sys

import anthropic
import requests

# ---------------------------------------------------------------------------
# Config — all values come from environment variables set by the workflow
# ---------------------------------------------------------------------------
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
PR_NUMBER = os.environ["PR_NUMBER"]
REPO = os.environ["REPO"]  # e.g. "owner/repo"

DIFF_PATH = "/tmp/pr_diff.txt"
CHANGED_FILES_PATH = "/tmp/changed_files.txt"
CLAUDE_MD_PATH = "CLAUDE.md"

# Claude model to use
MODEL = "claude-sonnet-4-6"

# Max characters to send per changed file (guards against huge files)
MAX_FILE_CHARS = 20_000

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def read_file_safe(path: str, max_chars: int | None = None) -> str:
    """Return file contents or an empty string if the file doesn't exist."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        if max_chars:
            content = content[:max_chars]
        return content
    except FileNotFoundError:
        return ""


def collect_changed_file_contents(changed_files_path: str) -> str:
    """Read each changed file and return a combined string with headers."""
    raw = read_file_safe(changed_files_path).strip()
    if not raw:
        return ""

    parts = []
    for filepath in raw.splitlines():
        filepath = filepath.strip()
        if not filepath:
            continue
        content = read_file_safe(filepath, max_chars=MAX_FILE_CHARS)
        if content:
            parts.append(f"### {filepath}\n```\n{content}\n```")
        else:
            parts.append(f"### {filepath}\n*(file not readable or empty)*")

    return "\n\n".join(parts)


def build_system_prompt(claude_md: str) -> str:
    base = (
        "You are an expert code reviewer. "
        "Your job is to review pull request changes thoroughly and provide actionable feedback.\n\n"
        "When reviewing, focus on:\n"
        "- Correctness and logic errors\n"
        "- Security vulnerabilities\n"
        "- Performance issues\n"
        "- Adherence to the project rules listed below\n"
        "- Code clarity and maintainability\n\n"
        "You MUST respond with a single valid JSON object — no markdown fences, no extra text — "
        "using exactly this schema:\n\n"
        "{\n"
        '  "verdict": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",\n'
        '  "summary": "<overall review summary, 2-4 sentences>",\n'
        '  "issues": [\n'
        "    {\n"
        '      "severity": "critical" | "warning" | "suggestion",\n'
        '      "file": "<filename or null>",\n'
        '      "description": "<clear explanation of the issue and how to fix it>"\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "Verdict guide:\n"
        "- APPROVE: no significant issues found\n"
        "- REQUEST_CHANGES: one or more critical issues that must be fixed before merging\n"
        "- COMMENT: observations or suggestions that don't block merging\n"
    )

    if claude_md:
        base += f"\n\n---\n## Project rules (from CLAUDE.md)\n\n{claude_md}"

    return base


def call_claude(system_prompt: str, diff: str, file_contents: str) -> dict:
    """Call the Anthropic API and return the parsed JSON review."""
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    user_message = "Please review the following pull request.\n\n"

    if file_contents:
        user_message += "## Full contents of changed files\n\n" + file_contents + "\n\n"

    user_message += "## Diff\n\n```diff\n" + diff + "\n```"

    message = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )

    raw = message.content[0].text.strip()

    # Strip accidental markdown fences if Claude adds them
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    return json.loads(raw)


def format_review_body(review: dict) -> str:
    """Turn the structured review JSON into a readable markdown comment."""
    verdict_emoji = {
        "APPROVE": "✅",
        "REQUEST_CHANGES": "🚨",
        "COMMENT": "💬",
    }.get(review.get("verdict", "COMMENT"), "💬")

    severity_emoji = {
        "critical": "🔴",
        "warning": "🟡",
        "suggestion": "🔵",
    }

    lines = [
        f"## {verdict_emoji} Claude Code Review\n",
        f"{review.get('summary', '')}\n",
    ]

    issues = review.get("issues", [])
    if issues:
        lines.append("### Issues\n")
        for issue in issues:
            sev = issue.get("severity", "suggestion")
            emoji = severity_emoji.get(sev, "🔵")
            file_tag = f" — `{issue['file']}`" if issue.get("file") else ""
            lines.append(f"{emoji} **{sev.capitalize()}**{file_tag}\n{issue['description']}\n")
    else:
        lines.append("*No issues found.*\n")

    lines.append("\n---\n*Review generated by Claude via the Anthropic API.*")
    return "\n".join(lines)


def post_github_review(body: str, verdict: str) -> None:
    """Post a formal PR review via the GitHub REST API."""
    owner, repo = REPO.split("/", 1)
    url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{PR_NUMBER}/reviews"

    # Map verdict to GitHub review event
    event_map = {
        "APPROVE": "APPROVE",
        "REQUEST_CHANGES": "REQUEST_CHANGES",
        "COMMENT": "COMMENT",
    }
    event = event_map.get(verdict, "COMMENT")

    headers = {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    payload = {"body": body, "event": event}

    response = requests.post(url, headers=headers, json=payload, timeout=30)

    if not response.ok:
        print(f"GitHub API error {response.status_code}: {response.text}", file=sys.stderr)
        sys.exit(1)

    print(f"Review posted successfully (verdict: {event})")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("Reading CLAUDE.md...")
    claude_md = read_file_safe(CLAUDE_MD_PATH)
    if not claude_md:
        print("Warning: CLAUDE.md not found — proceeding without project rules.")

    print("Reading diff...")
    diff = read_file_safe(DIFF_PATH)
    if not diff:
        print("No diff found — nothing to review.")
        sys.exit(0)

    print("Reading changed file contents...")
    file_contents = collect_changed_file_contents(CHANGED_FILES_PATH)

    print("Building prompt and calling Claude...")
    system_prompt = build_system_prompt(claude_md)
    review = call_claude(system_prompt, diff, file_contents)

    print(f"Claude verdict: {review.get('verdict')}")
    print(f"Issues found: {len(review.get('issues', []))}")

    body = format_review_body(review)
    post_github_review(body, review.get("verdict", "COMMENT"))


if __name__ == "__main__":
    main()