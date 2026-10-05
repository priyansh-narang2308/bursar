#!/usr/bin/env sh
# Local secret scan of staged changes. The authoritative full-history scan runs in CI.
if command -v gitleaks >/dev/null 2>&1; then
  exec gitleaks git --pre-commit --staged --redact --verbose
fi

echo "gitleaks is not installed: skipping the local secret scan (CI still scans). Install it with: brew install gitleaks" >&2
