#!/usr/bin/env bash
# Builds ModemLens and publishes dist/ to the S3 bucket behind a CloudFront distribution.
# Nothing environment-specific lives in this file; everything comes from the environment:
#
#   DEPLOY_AWS_PROFILE             AWS CLI profile to use
#   DEPLOY_AWS_REGION              region of the CloudFormation stack
#   DEPLOY_STACK                   CloudFormation stack name
#   DEPLOY_DISTRIBUTION_OUTPUT     stack output key that holds the CloudFront distribution id
#
# The bucket is derived from the S3 origin that the distribution's default cache behaviour serves.
set -euo pipefail

missing=()
for var in DEPLOY_AWS_PROFILE DEPLOY_AWS_REGION DEPLOY_STACK DEPLOY_DISTRIBUTION_OUTPUT; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing required environment variable(s): ${missing[*]}" >&2
  echo "See the comment at the top of $0 for what each one means." >&2
  exit 1
fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$PROJECT_ROOT/dist"

aws_cmd() {
  aws --profile "$DEPLOY_AWS_PROFILE" --region "$DEPLOY_AWS_REGION" "$@"
}

# The footer shows the build's commit, which a build from a dirty tree would not truthfully be.
TREE_STATE=$(git -C "$PROJECT_ROOT" status --porcelain)
if [[ -n "$TREE_STATE" ]]; then
  echo "The working tree has uncommitted changes. Commit or stash them before deploying:" >&2
  echo "$TREE_STATE" >&2
  exit 1
fi

echo "Building..."
( cd "$PROJECT_ROOT" && npm run build )

echo "Resolving the distribution from stack outputs..."
DISTRIBUTION_ID=$(aws_cmd cloudformation describe-stacks \
  --stack-name "$DEPLOY_STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='$DEPLOY_DISTRIBUTION_OUTPUT'].OutputValue" \
  --output text)

if [[ -z "$DISTRIBUTION_ID" || "$DISTRIBUTION_ID" == "None" ]]; then
  echo "Could not resolve the distribution id from the stack outputs." >&2
  exit 1
fi

TARGET_ORIGIN_ID=$(aws_cmd cloudfront get-distribution \
  --id "$DISTRIBUTION_ID" \
  --query "Distribution.DistributionConfig.DefaultCacheBehavior.TargetOriginId" \
  --output text)

ORIGIN_DOMAIN=$(aws_cmd cloudfront get-distribution \
  --id "$DISTRIBUTION_ID" \
  --query "Distribution.DistributionConfig.Origins.Items[?Id=='$TARGET_ORIGIN_ID'].DomainName | [0]" \
  --output text)

if [[ "$ORIGIN_DOMAIN" != *.s3.* && "$ORIGIN_DOMAIN" != *.s3-* ]]; then
  echo "The default cache behaviour's origin '$TARGET_ORIGIN_ID' is not an S3 origin." >&2
  exit 1
fi

BUCKET_NAME=$(printf '%s' "$ORIGIN_DOMAIN" | sed -E 's/\.s3[.-].*$//')

# 1. Hashed build assets: the file name changes with the content, so cache them for a year.
#    No --delete here: HTML that is still cached at the edge may reference older assets.
aws_cmd s3 sync "$DIST_DIR/assets" "s3://$BUCKET_NAME/assets" \
  --exclude ".DS_Store" \
  --cache-control "public, max-age=31536000, immutable"

# 2. Everything else (HTML, manifest, workbox runtime, icons): always revalidate,
#    otherwise an installed app can stay on an old version. cp rewrites the header even for
#    unchanged files.
aws_cmd s3 cp "$DIST_DIR" "s3://$BUCKET_NAME" \
  --recursive \
  --exclude "assets/*" \
  --exclude "sw.js" \
  --exclude ".DS_Store" \
  --exclude "**/.DS_Store" \
  --cache-control "no-cache"

# 3. Make sure the content types of the files that matter are right.
aws_cmd s3 cp "$DIST_DIR/manifest.webmanifest" "s3://$BUCKET_NAME/manifest.webmanifest" \
  --content-type "application/manifest+json" \
  --cache-control "no-cache"

# 4. The service worker goes last: an installed app must not pick up a new worker
#    while the files it lists are still being uploaded.
aws_cmd s3 cp "$DIST_DIR/sw.js" "s3://$BUCKET_NAME/sw.js" \
  --content-type "text/javascript; charset=utf-8" \
  --cache-control "no-cache"

echo "Invalidating the CDN cache..."
INVALIDATION_ID=$(aws_cmd cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*" \
  --query "Invalidation.Id" \
  --output text)
aws_cmd cloudfront wait invalidation-completed \
  --distribution-id "$DISTRIBUTION_ID" \
  --id "$INVALIDATION_ID"

echo "Deploy complete."

# Tell IndexNow (Bing, and so ChatGPT Search). Best effort: a failed ping must not fail the deploy.
if [[ -f "$PROJECT_ROOT/scripts/indexnow.sh" ]]; then
  bash "$PROJECT_ROOT/scripts/indexnow.sh" || echo "IndexNow ping failed (not fatal)." >&2
fi
