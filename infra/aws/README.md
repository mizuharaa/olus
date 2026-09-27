# Olus on AWS — one box, one CDN, API only

AWS serves **only the FastAPI API**, at `https://api.olus.sh`. The Next.js site
is on Vercel (`olus.sh`, `www.olus.sh`), deployed from `main` by Vercel's git
integration. Nothing here builds or runs the web container.

> Terraform was installed with winget; a shell opened before the install does not
> see it on PATH. Open a new terminal, or use the full path under
> `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Hashicorp.Terraform_*\terraform.exe`.

## What it costs

| Item | $/month |
| --- | --- |
| EC2 t4g.small, on demand, 730h | 12.26 |
| Elastic IP (in use) | 3.65 |
| EBS gp3 root, 20 GB | 1.60 |
| Daily snapshots, 7 retained | ~0.50 |
| ECR storage, 10 images | ~0.30 |
| CloudFront, S3, CloudWatch, SNS | 0.00 (free tier) |
| **Total** | **~18.30** |

Replaces `infra/terraform/` (ECS + ALB) at $42, $23 of it an ALB doing only TLS.
Stopped (`panic.ps1`): ~$5 — the volume and the EIP keep billing, compute does not.

## Order of operations

1. **Once per account**: `powershell -File infra/aws/bootstrap-iam.ps1` from a root
   `aws login`. It creates the `olus-admin` IAM user and CLI profile, the
   `olus-budget-killswitch` policy, and the budget action that attaches it at $30.
   The `olus-monthly` budget itself is managed by hand and Terraform never touches it.
2. **Apply**:
   ```powershell
   cd infra/aws
   cp terraform.tfvars.example terraform.tfvars   # edit if you want
   $env:AWS_PROFILE = 'olus-admin'
   terraform init
   terraform plan  -var-file=terraform.tfvars
   terraform apply -var-file=terraform.tfvars
   ```
   CloudFront takes ~5 minutes. Confirm the SNS subscription email when it arrives.
3. **GitHub**: secret `AWS_ROLE_ARN` from `terraform output github_deploy_role_arn`.
   The repo variable `API_URL` defaults to `https://api.olus.sh`, so set it only if
   the hostname changes. No `NEXT_PUBLIC_*` here — those are the Vercel project's.
4. **First image**: run the *Deploy AWS* workflow. Until it runs, ECR is empty and
   `olus.service` on the box retries `compose up` every 60s — it heals itself once
   the image lands, no second apply needed.
5. **DNS**: the cutover below.
6. **Verify**: `powershell -File infra/aws/status.ps1`.

Shell on the box (no SSH key exists): `terraform output -raw ssm_session_command`.

## Server-only copilot credential

Store the Gemini credential as an SSM **SecureString** named
`/olus/production/gemini-api-key` in the API region. Do not put it in Git,
Vercel public variables, workflow arguments, or browser code.

Each deployment runs `load-secrets.py` on the instance using its IAM role.
It atomically writes `/opt/olus/api.env` with mode `0600`; Compose loads that
file into the API container. A missing parameter preserves the existing file;
access errors or invalid values stop the deployment before the container restarts.
After changing the parameter, run **Deploy AWS** to reload it.

## The domain: api.olus.sh

`olus.sh` is registered through Vercel (registrar Name.com), so DNS lives at
Vercel, not Route 53, and Terraform cannot write the records. The apex and www
stay pointed at Vercel forever. Only the `api` record moves here, off the
existing **Railway** service `olus-api` (`0bd8wy4v.up.railway.app`).

The ACM certificate is in us-east-1 and covers `api.olus.sh` only. Two applies:

1. `terraform apply` with the default `domain_validated = false`. The certificate
   is requested; CloudFront still answers on its own `*.cloudfront.net` name, and
   the API is already live there.
2. `terraform output -raw vercel_dns_commands` prints, in order: the ACM
   validation CNAME(s), the `vercel dns rm` for the Railway api record, and the
   `vercel dns add` that points `api` at the distribution. Run the validation
   CNAME(s) first (`vercel login` first).
3. `terraform apply -var domain_validated=true`. Apply waits for ACM to issue,
   then attaches the certificate and the `api.olus.sh` alias. ACM usually issues
   within fifteen minutes of the records resolving.
4. **Cutover** is the last two printed lines: remove the Railway CNAME, add the
   CloudFront one. **Rollback** is the swap back:
   `vercel dns add olus.sh api CNAME 0bd8wy4v.up.railway.app`.

The four Amazon CAA records are already in the zone — added by hand, because
Vercel seeds three other CAs and ACM would otherwise never issue; the output does
not reprint them. The instance boots with `https://api.olus.sh` as its own URL and
`https://olus.sh,https://www.olus.sh` plus the cloudfront.net name in
`CORS_ORIGINS`, so nothing on the box changes at cutover.

## Buttons

- `panic.ps1` — stops the instance. `-Resume` starts it. The EIP stays associated,
  so CloudFront keeps working after a resume with no apply.
- `nuke.ps1` — type `NUKE`; empties the backup bucket, `terraform destroy`, then
  sweeps for strays tagged `Project=olus` and prints (does not run) the deletes.
- `status.ps1` — read-only: instance state, EIP, CloudFront URL, `/health`, MTD cost.

## Resizing

```powershell
terraform apply -var-file=terraform.tfvars -var instance_type=t4g.medium
```
Terraform stops, resizes and starts the instance in place; the EIP and the root
volume survive. `t4g.medium` is $24.53/month, over the $19 target. If the OR-Tools
solver is the reason, raise `SOLVER_TIMEOUT_SECS` first — it is free.

## Budget stop action

`bootstrap-iam.ps1` attaches the IAM deny policy at 100% of the budget, which stops
*new* spend but leaves the instance running. Add the stop action once the instance
exists:

```powershell
$acct = aws sts get-caller-identity --profile olus-admin --query Account --output text
$id   = terraform output -raw instance_id
aws budgets create-budget-action --account-id $acct --budget-name olus-monthly `
  --notification-type ACTUAL --action-type RUN_SSM_DOCUMENTS `
  --action-threshold ActionThresholdValue=100,ActionThresholdType=PERCENTAGE `
  --definition "SsmActionDefinition={ActionSubType=STOP_EC2_INSTANCES,Region=us-east-1,InstanceIds=[$id]}" `
  --execution-role-arn "arn:aws:iam::${acct}:role/olus-budgets-action" `
  --approval-model AUTOMATIC `
  --subscribers SubscriptionType=EMAIL,Address=luong.alois@gmail.com
```

## Known edges

- Live traffic is the community ADS-B feeds (`ADSB_PROVIDER=adsblol`, adsb.fi as
  fallback). OpenSky is not usable from any cloud — it blocks Vercel and AWS both.
  The old `opensky_proxy_base` / `osky_relay_key` variables are gone; if your
  `terraform.tfvars` still sets `osky_relay_key` or `custom_domain`, delete those
  lines. Terraform only *warns* about values for undeclared variables, so a stale
  line will not fail a plan.
- One uvicorn worker, by design — simulation state is in-process. Do not add
  `WEB_CONCURRENCY`; two workers means two divergent worlds.
- `user_data` changes do not replace the instance (that would delete
  `/opt/olus/state`). They land on the next reboot.
- Terraform state is local. Losing the laptop means importing or re-creating.
