terraform {
  backend "s3" {
    bucket         = "crm-tfstate"
    key            = "matching/terraform.tfstate"
    dynamodb_table = "crm-tf-lock"
  }
}

resource "aws_s3_bucket" "matching_assets" {
  bucket = "crm-matching-assets-${terraform.workspace}"
  tags = {
    env  = terraform.workspace
    team = "matching"
  }
}
