terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

# us-east-1 is required: ACM certs consumed by CloudFront must live there.
# Everything else (S3, Route 53) is regionless or tolerates any region, so we
# keep a single provider for simplicity.
provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
      Stack     = "main"
    }
  }
}
