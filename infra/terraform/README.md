# Olus AWS deployment

Retired ECS/ALB reference. The current deployment is documented in [infra/aws](../aws/README.md).

This stack runs both Olus containers on one `t3a.small` ECS container
instance behind an Application Load Balancer. It deliberately targets a
$40–50/month portfolio budget instead of maximum availability.

## Architecture

- One VPC with two public subnets and no NAT Gateway.
- One ECS cluster backed by a one-instance Auto Scaling Group.
- One ECS task containing the Next.js and FastAPI containers.
- One ALB with path routing:
  - `/api/v1/*`, `/ws/*`, and `/health` route to FastAPI.
  - All other paths route to Next.js, including its native API routes.
- EFS stores `apps/api/state/olus.db` across task replacements.
- ECR stores five recent API and web images.
- CloudWatch retains seven days of logs.
- AWS Budgets enforces a $50/month guardrail.
- GitHub Actions deploys through short-lived OIDC credentials.

The service remains at one task because simulation and WebSocket state are
process-local. Do not increase `service_desired_count` until that state is
externalized.

## Estimated monthly cost

The expected low-traffic cost in `us-east-1` is about $43–48/month:

| Resource | Approximate monthly cost |
| --- | ---: |
| `t3a.small` EC2 | $14 |
| EC2 public IPv4 | $3.60 |
| ALB hourly charge | $16.20 |
| Two ALB public IPv4 addresses | $7.20 |
| 20 GB gp3, EFS, ECR, logs, and light LCU usage | $2–7 |

Taxes, domain registration, unusually high traffic, and T3 surplus CPU credits
are not included. The launch template uses `standard` CPU credits, which caps
that last risk by throttling sustained CPU after the burst balance is depleted.

## First deployment

Prerequisites:

- Terraform 1.6 or newer.
- An authenticated AWS CLI session with permission to create the resources.
- Optional: a Route 53 hosted zone and hostname for HTTPS/WSS.

Create the local variable file:

```powershell
Copy-Item terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`. Keep `service_desired_count = 0` on the first apply,
because the ECR repositories do not contain images yet.

```powershell
terraform init
terraform plan -out olus.tfplan
terraform apply olus.tfplan
terraform output
```

Set the `github_deploy_role_arn` output as the repository secret
`AWS_ROLE_ARN`. If non-default names or regions are used, also configure these
GitHub repository variables:

- `AWS_REGION`
- `ECS_CLUSTER`
- `ECS_SERVICE`
- `API_ECR_REPOSITORY`
- `WEB_ECR_REPOSITORY`

Set `NEXT_PUBLIC_MAPBOX_TOKEN` as a repository secret when the production map
should use Mapbox. It is embedded into the browser bundle by Next.js and is not
a confidential runtime credential, but keeping it in repository settings avoids
committing it to source.

Run the **Deploy AWS** workflow manually. It builds both images, pushes them to
ECR, sets the ECS service desired count to one, and waits for it to stabilize.
After it succeeds, change `service_desired_count` to `1` in the local tfvars so
future Terraform applies do not scale the service back to zero.

The workflow intentionally starts as manual-only so committing the migration
files cannot deploy before the role and repository settings exist. A `push`
trigger can be added after the first successful cutover.

## HTTPS

Without both `domain_name` and `hosted_zone_id`, the stack exposes the ALB over
HTTP for initial smoke testing. Supplying both creates an ACM certificate,
Route 53 alias, HTTPS listener, HTTP-to-HTTPS redirect, and secure WebSocket
endpoint automatically.

## Operational trade-offs

- One EC2 host means deployments and host replacement can cause brief downtime.
- EFS persists scenarios, but SQLite remains appropriate only for a single API
  task.
- The public ECS host security group accepts no inbound application traffic;
  only task ENIs accept ports 3000 and 8000 from the ALB security group.
- The AWS state is local initially. Before team use, migrate it to a versioned,
  encrypted S3 backend with state locking.
