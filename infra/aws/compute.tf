# Latest Amazon Linux 2023 arm64. The SSM alias means a new AMI is picked up on
# the next apply without hunting for an ID.
data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

# An in-use Elastic IP now costs the same $3.65/month as the auto-assigned
# public IPv4 it replaces, and associating it releases the auto-assigned one, so
# only one address is ever billed. In exchange the origin hostname survives a
# stop/start, which an auto-assigned IP does not: without this, every panic-stop
# would need a terraform apply to repoint CloudFront.
resource "aws_eip" "app" {
  domain = "vpc"
  tags   = { Name = "olus-app" }
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}

resource "aws_instance" "app" {
  ami           = data.aws_ssm_parameter.al2023_arm64.value
  instance_type = var.instance_type

  # sort() so the chosen subnet is stable across applies; "eligible" excludes
  # AZs that do not offer var.instance_type (see network.tf).
  subnet_id              = sort(data.aws_subnets.eligible.ids)[0]
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name

  # Standard, not unlimited: burst overage stops the instance from throttling
  # into a surprise bill. The CPUCreditBalance alarm is the warning.
  credit_specification {
    cpu_credits = "standard"
  }

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size_gb
    encrypted             = true
    delete_on_termination = true
    # Project is repeated explicitly so the DLM tag filter matches regardless of
    # how default_tags propagate to block devices.
    tags = {
      Name    = "olus-app-root"
      Project = "olus"
    }
  }

  user_data = templatefile("${path.module}/templates/user_data.sh.tftpl", {
    region                 = var.aws_region
    ecr_registry           = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
    backup_bucket          = aws_s3_bucket.backups.bucket
    backup_script          = file("${path.module}/backup.sh")
    docker_compose_version = var.docker_compose_version
    compose_file = templatefile("${path.module}/templates/docker-compose.yml.tftpl", {
      api_image    = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"
      region       = var.aws_region
      log_group    = aws_cloudwatch_log_group.app.name
      cors_origins = local.cors_origins
    })
  })

  # Deliberately NOT user_data_replace_on_change: replacing the instance throws
  # away /opt/olus/state and the SQLite scenario history with it. A user_data
  # script runs only on first boot; existing hosts receive backup updates via SSM.

  tags = { Name = "olus-app" }
}

# Daily snapshots of anything tagged Project=olus, which is just the root
# volume. 7 x 20 GB incremental is roughly $0.50/month and is the only thing
# standing between a bad `docker compose down -v` and a lost database.
resource "aws_dlm_lifecycle_policy" "daily" {
  description        = "olus daily EBS snapshots"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = { Project = "olus" }

    schedule {
      name = "daily"

      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["07:00"] # UTC, roughly 2am US Eastern
      }

      retain_rule {
        count = var.snapshot_retain_count
      }

      copy_tags = true

      tags_to_add = {
        Project        = "olus"
        SnapshotSource = "dlm"
      }
    }
  }
}
