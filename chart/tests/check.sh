#!/usr/bin/env bash
# Offline contract checks. No cluster access or dependency downloads.
set -euo pipefail
chart_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
check_dir="$(mktemp -d /tmp/games-chart-check.XXXXXX)"
trap 'rm -f -- "$check_dir/render.yaml" "$check_dir/error.log"; rmdir -- "$check_dir"' EXIT
helm lint "$chart_root"
helm template check "$chart_root" > "$check_dir/render.yaml"
helm lint "$chart_root" -f "$chart_root/tests/production.yaml"
helm template check "$chart_root" -f "$chart_root/tests/production.yaml" > "$check_dir/render.yaml"
grep -E -q 'type: Recreate' "$check_dir/render.yaml"
grep -E -q 'kind: NetworkPolicy' "$check_dir/render.yaml"
grep -E -q 'kind: ScheduledBackup' "$check_dir/render.yaml"
grep -E -q 'automountServiceAccountToken: false' "$check_dir/render.yaml"
grep -E -q 'readOnlyRootFilesystem: true' "$check_dir/render.yaml"
grep -E -q 'name: GAMES_PRODUCTION' "$check_dir/render.yaml"
if grep -E -q 'GAMES_SMTP_|GAMES_MAIL_|port: (25|465|587)$' "$check_dir/render.yaml"; then
  printf 'FAIL: retired mail dependency rendered\n' >&2
  exit 1
fi
grep -E -A3 'livenessProbe:' "$check_dir/render.yaml" | grep -E -q 'path: /livez'
grep -E -A3 'readinessProbe:' "$check_dir/render.yaml" | grep -E -q 'path: /healthz'
reject() {
  local label="$1"
  shift
  if helm template check "$chart_root" -f "$chart_root/tests/production.yaml" "$@" > /dev/null 2> "$check_dir/error.log"; then
    printf 'FAIL: unsafe chart accepted (%s)\n' "$label" >&2
    exit 1
  fi
  printf 'Rejected: %s\n' "$label"
}
reject "multiple replicas" --set replicaCount=2
reject "retired mail configuration" --set-string mail.relay=relay.mail.svc:587
reject "missing DNS egress peers" --set-json 'networkPolicy.dnsTo=[]'
reject "missing canonical URL" --set-string publicUrl=
reject "HTTP origin" --set-string publicUrl=http://games.example.invalid
reject "missing backups" --set database.cnpg.backup.enabled=false
reject "floating image" --set-string image.tag=latest
reject "missing backup credential reference" --set-string database.cnpg.backup.credentialsSecret=
reject "disabled isolation" --set networkPolicy.enabled=false
reject "missing proxy peers" --set-json 'networkPolicy.ingressFrom=[]'
reject "non-TLS ingress" --set ingress.enabled=true --set-string ingress.host=games.example.invalid --set ingress.tls.enabled=false
reject "mismatched ingress origin" --set ingress.enabled=true --set-string ingress.host=other.example.invalid
reject "direct public service" --set service.type=LoadBalancer
reject "external database without recovery owner" --set database.cnpg.enabled=false --set-string database.existingSecret.name=example-database
reject "missing recovery source generation" --set database.cnpg.recovery.enabled=true
reject "recovery archive overwrite" --set database.cnpg.recovery.enabled=true --set-string database.cnpg.recovery.serverName=games-postgresql-g1
reject "admin without HTTPS issuer" --set admin.enabled=true
reject "admin HTTP issuer" --set admin.enabled=true --set-string admin.issuer=http://auth.example.invalid/application/o/games-admin/
reject "admin without dedicated identity" --set admin.enabled=true --set-string admin.issuer=https://auth.example.invalid/application/o/games-admin/ --set-string admin.username=
reject "admin without explicit HTTPS egress" --set admin.enabled=true --set-string admin.issuer=https://auth.example.invalid/application/o/games-admin/
reject "admin unrestricted IPv4 egress" --set admin.enabled=true --set-string admin.issuer=https://auth.example.invalid/application/o/games-admin/ --set-json 'networkPolicy.adminTo=[{"ipBlock":{"cidr":"0.0.0.0/0"}}]'
reject "admin unrestricted IPv6 egress" --set admin.enabled=true --set-string admin.issuer=https://auth.example.invalid/application/o/games-admin/ --set-json 'networkPolicy.adminTo=[{"ipBlock":{"cidr":"::/0"}}]'
helm template check "$chart_root" -f "$chart_root/tests/production.yaml" --set admin.enabled=true --set-string admin.issuer=https://auth.example.invalid/application/o/games-admin/ --set-json 'networkPolicy.adminTo=[{"ipBlock":{"cidr":"192.0.2.0/24"}}]' > "$check_dir/render.yaml"
grep -E -q 'name: GAMES_ADMIN_ISSUER' "$check_dir/render.yaml"
grep -E -q 'port: 443$' "$check_dir/render.yaml"
grep -E -q 'cidr: 192.0.2.0/24' "$check_dir/render.yaml"
# Ingress cannot quietly switch a development chart into an unsafe public one.
if helm template check "$chart_root" --set ingress.enabled=true --set-string ingress.host=games.example.invalid > /dev/null 2> "$check_dir/error.log"; then
  printf 'FAIL: public ingress bypassed production validation\n' >&2
  exit 1
fi
helm template check "$chart_root" -f "$chart_root/tests/production.yaml" --set-string image.digest=sha256:0000000000000000000000000000000000000000000000000000000000000000 --set-string image.tag=latest > /dev/null
helm template restore-check "$chart_root" -f "$chart_root/tests/production.yaml" --set database.cnpg.recovery.enabled=true --set-string database.cnpg.recovery.serverName=games-postgresql-g0 --set-string database.cnpg.recovery.targetTime=2026-10-01T00:00:00Z > "$check_dir/render.yaml"
grep -E -q 'source: games-recovery' "$check_dir/render.yaml"
grep -E -q 'owner: games' "$check_dir/render.yaml"
grep -E -q 'targetTime: "2026-10-01T00:00:00Z"' "$check_dir/render.yaml"
if grep -E -q 'initdb:' "$check_dir/render.yaml"; then
  printf 'FAIL: restore rendered an empty database bootstrap\n' >&2
  exit 1
fi
printf 'Chart security checks passed\n'
# Shared credentials must preserve the original cluster and its backups:
# disabling CNPG during cutover would let GitOps prune the source database.
helm template check "$chart_root" -f "$chart_root/tests/production.yaml" --set database.sharedAccounts=true --set-string database.existingSecret.name=arcade-postgresql-app --set-string database.existingSecret.backupRunbook=apps/workloads/arcade/README.md --set-json 'networkPolicy.databaseTo=[{"podSelector":{"matchLabels":{"cnpg.io/cluster":"arcade-postgresql"}}}]' > "$check_dir/render.yaml"
grep -E -q 'name: arcade-postgresql-app' "$check_dir/render.yaml"
grep -E -q 'kind: Cluster' "$check_dir/render.yaml"
grep -E -q 'name: GAMES_SHARED_ACCOUNTS' "$check_dir/render.yaml"
helm template check "$chart_root" -f "$chart_root/tests/production.yaml" --set maintenance=true > "$check_dir/render.yaml"
grep -E -q 'replicas: 0' "$check_dir/render.yaml"
grep -E -q 'kind: Cluster' "$check_dir/render.yaml"
