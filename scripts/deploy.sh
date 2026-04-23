#!/usr/bin/env bash
set -euo pipefail

# Build the Vite SPA, sync it to S3, and invalidate CloudFront.
#
# Reads bucket name + distribution id from `terraform output` so there's
# only one source of truth. Requires aws, terraform, npm on PATH and
# AWS credentials in the environment.
#
# Usage:
#   scripts/deploy.sh           # build + sync + invalidate
#   scripts/deploy.sh --dry-run # build + print sync/invalidate commands

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '3,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
tf_main_dir="$repo_root/infra/terraform/main"

# ---- 1. Preflight ---------------------------------------------------------
# Vite inlines import.meta.env.VITE_* at build time, so the bundle bakes in
# whatever values are set right now. Bail out loudly if they're missing.
required_env=(VITE_SPACETIMEDB_HOST VITE_SPACETIMEDB_DB_NAME)
missing=()
for v in "${required_env[@]}"; do
  if [[ -z "${!v:-}" ]]; then
    missing+=("$v")
  fi
done
if (( ${#missing[@]} > 0 )); then
  echo "ERROR: missing required env vars: ${missing[*]}" >&2
  echo "These get baked into the bundle by Vite. Export them first, e.g.:" >&2
  echo "  export VITE_SPACETIMEDB_HOST=wss://maincloud.spacetimedb.com" >&2
  echo "  export VITE_SPACETIMEDB_DB_NAME=idle-survivor" >&2
  exit 1
fi

for cmd in aws terraform npm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: '$cmd' not found on PATH" >&2
    exit 1
  fi
done

# ---- 2. Build -------------------------------------------------------------
echo "==> Building SPA"
cd "$repo_root"
npm ci
npm run build

if [[ ! -f "$repo_root/dist/index.html" ]]; then
  echo "ERROR: build did not produce dist/index.html" >&2
  exit 1
fi

# ---- 3. Resolve infra outputs --------------------------------------------
echo "==> Reading Terraform outputs"
bucket="$(terraform -chdir="$tf_main_dir" output -raw site_bucket_name)"
dist_id="$(terraform -chdir="$tf_main_dir" output -raw cloudfront_distribution_id)"

if [[ -z "$bucket" || -z "$dist_id" ]]; then
  echo "ERROR: terraform outputs are empty — has the main stack been applied?" >&2
  exit 1
fi

echo "    bucket          : $bucket"
echo "    distribution id : $dist_id"

# ---- 4. Sync hashed assets first (long cache) ----------------------------
# Order matters: assets must land before index.html points at them, otherwise
# users hitting the site mid-deploy load an index.html that 404s on chunks.
sync_assets=(
  aws s3 sync "$repo_root/dist/" "s3://$bucket/"
  --delete
  --exclude "index.html"
  --cache-control "public, max-age=31536000, immutable"
)

# ---- 5. Upload index.html last (no cache) --------------------------------
upload_index=(
  aws s3 cp "$repo_root/dist/index.html" "s3://$bucket/index.html"
  --cache-control "no-cache, no-store, must-revalidate"
  --content-type "text/html; charset=utf-8"
)

# ---- 6. Invalidate ---------------------------------------------------------
# Hashed assets don't need invalidation (their filenames change). Only
# index.html and the implicit "/" (default root object) need busting.
invalidate=(
  aws cloudfront create-invalidation
  --distribution-id "$dist_id"
  --paths "/" "/index.html"
)

if (( DRY_RUN )); then
  echo "==> [dry-run] would run:"
  printf '    %q ' "${sync_assets[@]}"; echo
  printf '    %q ' "${upload_index[@]}"; echo
  printf '    %q ' "${invalidate[@]}"; echo
  exit 0
fi

echo "==> Syncing hashed assets"
"${sync_assets[@]}"

echo "==> Uploading index.html"
"${upload_index[@]}"

echo "==> Invalidating CloudFront"
"${invalidate[@]}"

echo "==> Done."
