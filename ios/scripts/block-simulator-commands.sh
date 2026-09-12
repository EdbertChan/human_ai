#!/usr/bin/env bash
# PreToolUse hook (Bash matcher). Blocks iOS Simulator / Android emulator
# invocations in this project — the user has corrected this twice in one
# session (once for an interactive install, once for the assistant's own
# internal test verification). Real-device testing only: xcrun devicectl
# for iOS, adb -s <real-device-id> for Android.
set -euo pipefail

input="$(cat)"
command="$(echo "$input" | jq -r '.tool_input.command // empty')"

if [ -z "$command" ]; then
  exit 0
fi

if echo "$command" | grep -qE \
  -e 'simctl +(boot|install|launch|erase)' \
  -e 'emulator +-avd' \
  -e 'open +-a +Simulator' \
  -e 'xcodebuild.*-sdk +iphonesimulator' \
  -e 'xcodebuild.*-destination[^|&]*[Ss]imulator'; then
  cat >&2 <<'EOF'
Blocked: this command targets the iOS Simulator or Android emulator.

This project requires real-device testing only — the user has corrected
this twice in the same session, including once for the assistant's own
internal verification steps (not just user-facing installs).

Use the real device instead:
  iOS:     xcrun devicectl device install app --device <udid> <app>
  Android: adb -s <real-device-id> install -r <apk>

If there's a genuine reason a Simulator/emulator is actually needed this
time, ask the user first — don't just retry.
EOF
  exit 2
fi

exit 0
