# Remote state backend. The bucket and lock table are created by the
# `infra/terraform/bootstrap` stack — apply that first, then `terraform init`
# this stack and answer "yes" to migrate state.
#
# The bucket name uses the AWS account ID as a suffix; replace
# <account-id> below with the value printed by:
#   cd ../bootstrap && terraform output -raw state_bucket_name
terraform {
  backend "s3" {
    bucket         = "hasan-tf-bucket"
    key            = "main/idle-survivor/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
  }
}
