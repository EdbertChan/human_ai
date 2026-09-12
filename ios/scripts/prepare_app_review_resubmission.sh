#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 VIDEO_PATH OUTPUT_DIR \"DEVICE MODEL | OS VERSION\"" >&2
  echo "The device argument is required so simulator recordings cannot be mislabeled." >&2
}

if [[ $# -ne 3 ]]; then
  usage
  exit 2
fi

video_path=$1
output_dir=$2
physical_device=$3
project_file="$(cd "$(dirname "$0")/.." && pwd)/EmapthyAi.xcodeproj/project.pbxproj"

if [[ ! -f "$video_path" ]]; then
  echo "ERROR: recording not found: $video_path" >&2
  exit 3
fi
if [[ -z "$physical_device" || "$physical_device" == *simulator* || "$physical_device" == *Simulator* ]]; then
  echo "ERROR: provide a physical device model and OS, not a simulator label" >&2
  exit 4
fi
if ! command -v ffprobe >/dev/null 2>&1; then
  echo "ERROR: ffprobe is required to inspect the recording" >&2
  exit 5
fi

marketing_version=$(sed -n 's/^[[:space:]]*MARKETING_VERSION = \([^;]*\);/\1/p' "$project_file" | head -n 1)
build_number=$(sed -n 's/^[[:space:]]*CURRENT_PROJECT_VERSION = \([^;]*\);/\1/p' "$project_file" | head -n 1)
bundle_id=$(sed -n 's/^[[:space:]]*PRODUCT_BUNDLE_IDENTIFIER = \([^;]*\);/\1/p' "$project_file" | rg '^com\.nekocatpitalventures\.emapthyai$' | head -n 1)

if [[ -z "$marketing_version" || -z "$build_number" || -z "$bundle_id" ]]; then
  echo "ERROR: could not read version/build/bundle metadata from $project_file" >&2
  exit 6
fi

mkdir -p "$output_dir"
ffprobe_output=$(ffprobe -v error \
  -show_entries format=duration,size:stream=codec_name,width,height,pix_fmt \
  -of default=noprint_wrappers=1 "$video_path")
printf '%s\n' "$ffprobe_output" > "$output_dir/recording-validation.txt"

recording_name=$(basename "$video_path")
cat > "$output_dir/app-review-notes.txt" <<EOF
App: EmapthyAi
Bundle ID: $bundle_id
Version: $marketing_version ($build_number)

1. Physical-device screen recording
Recording: $recording_name
Device/OS: $physical_device
The recording starts by launching EmapthyAi and demonstrates the core flow: type a message in Apple Messages, tap Corporate, review the suggested rewrite, and tap EmapthyAi's Send action so the rewrite populates the message field. The Messages send arrow is not tapped; no message is transmitted during the demonstration.

2. Devices and operating systems tested
- $physical_device
- iPhone 16 Pro Max simulator, iOS 18.6 (used for supplementary UI capture only)

3. App functions, audience, and value
EmapthyAi is an iOS custom keyboard for people who want help rewriting messages before sending them. Corporate rewrites informal wording into a clearer, professional tone while allowing the user to review the suggestion first. It helps users communicate confidently at work without changing the recipient or sending anything automatically.

4. Setup and access
Install EmapthyAi, then enable Settings > General > Keyboard > Keyboards > EmapthyAi and Allow Full Access. Open Apple Messages, select a conversation or create a draft, type a message, switch to the EmapthyAi keyboard, tap Corporate, review the suggestion, and tap Send. No account, login credentials, or sample files are required.

5. External services, tools, and platforms
The app uses Apple's Messages app and custom-keyboard APIs, and sends rewrite requests to the local EmapthyAi API during development. The server may use OpenAI or Anthropic language-model services to produce rewrites. Server-side product telemetry is collected through PostHog. No voice-translation service is required for the iOS core flow.

6. Regional behavior
EmapthyAi's core keyboard and Corporate rewrite flow are consistent across regions. Availability depends on an internet connection and the EmapthyAi API; there is no region-specific content or feature gating.

7. Regulated or protected material
EmapthyAi does not operate in a regulated industry and does not distribute protected third-party material. It uses Apple's public keyboard and messaging platform APIs; no additional authorization documentation is required.
EOF

{
  echo "bundle_id=$bundle_id"
  echo "marketing_version=$marketing_version"
  echo "build_number=$build_number"
  echo "physical_device=$physical_device"
  echo "recording=$video_path"
  echo "recording_metadata_file=$output_dir/recording-validation.txt"
  echo "notes_file=$output_dir/app-review-notes.txt"
} > "$output_dir/manifest.txt"

for heading in \
  "1. Physical-device screen recording" \
  "2. Devices and operating systems tested" \
  "3. App functions, audience, and value" \
  "4. Setup and access" \
  "5. External services, tools, and platforms" \
  "6. Regional behavior" \
  "7. Regulated or protected material"; do
  rg -F "$heading" "$output_dir/app-review-notes.txt" >/dev/null
done

echo "Prepared App Review materials for $bundle_id version $marketing_version ($build_number)"
echo "Recording metadata: $output_dir/recording-validation.txt"
echo "Notes: $output_dir/app-review-notes.txt"
echo "Manifest: $output_dir/manifest.txt"
