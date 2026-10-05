#!/usr/bin/env sh
# Local secret scan of staged changes. CI scans every commit in a push or pull request.
if command -v gitleaks >/dev/null 2>&1; then
  exec gitleaks git --pre-commit --staged --redact --verbose
fi

echo "gitleaks is not installed: skipping the local secret scan (CI still scans). Install it with: brew install gitleaks" >&2
