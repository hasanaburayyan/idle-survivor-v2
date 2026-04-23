# Deployment

Static-site deployment for the SPA at `https://r2ts.io`.

The web build is the Expo Web export (`expo export -p web`, configured by
`expo.web.output = "single"` in `app.json` → static single-page app in `dist/`).
Native iOS/Android builds are out of scope for this script.

Architecture: S3 (private, OAC) → CloudFront (HTTPS, ACM cert in us-east-1, SPA fallback) → Route 53 (apex + www alias).

## One-time setup

Remote state lives in the existing `hasan-tf-bucket` S3 bucket under
`main/idle-survivor/terraform.tfstate` (configured in
`infra/terraform/main/backend.tf`). No state locking — don't run two
`terraform apply`s concurrently.

```sh
cd infra/terraform/main
terraform init
terraform apply
```

ACM DNS validation can take a few minutes; CloudFront distribution creation typically takes 5–15 minutes.

## Ongoing deploys

Set the build-time env vars (Expo inlines `process.env.EXPO_PUBLIC_*` into the
bundle), then run the deploy script:

```sh
export EXPO_PUBLIC_SPACETIMEDB_HOST=wss://maincloud.spacetimedb.com
export EXPO_PUBLIC_SPACETIMEDB_DB_NAME=idle-survivor

scripts/deploy.sh
```

What it does:
1. Verifies env vars + required CLIs are present.
2. `npm ci && npm run build:web` (`expo export -p web` → `dist/`).
3. Reads bucket name + distribution id from `terraform output`.
4. Syncs hashed assets to S3 with `cache-control: public, max-age=31536000, immutable`.
5. Uploads `index.html` last with `cache-control: no-cache` (so users see new builds immediately).
6. Invalidates `/` and `/index.html` in CloudFront. Hashed assets don't need invalidation.

`scripts/deploy.sh --dry-run` prints the AWS commands without running them.

## Verifying

```sh
dig +short r2ts.io                      # CloudFront IPs
curl -sI https://r2ts.io                # HTTP/2 200 + via: ... CloudFront
curl -sI https://www.r2ts.io            # HTTP/2 301, Location: https://r2ts.io/
```

Then load `https://r2ts.io` in a browser — game UI should render and the SpacetimeDB websocket should connect.
