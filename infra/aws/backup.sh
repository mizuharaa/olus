#!/bin/sh
set -eu
. /opt/olus/.env
stage=$(mktemp -d /opt/olus/state/.backup.XXXXXX)
trap 'rm -rf -- "$stage"' EXIT
chown 1001:1001 "$stage"
docker exec olus-api python -m src.store.backup "/app/apps/api/state/${stage##*/}"
aws s3 cp "$stage/" \
  "s3://$BACKUP_BUCKET/state/$(date +%F)/" --recursive --region "$AWS_REGION"
