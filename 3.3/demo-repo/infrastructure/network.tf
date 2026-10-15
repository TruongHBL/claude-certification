resource "aws_vpc" "crm_main" {
  cidr_block = "10.0.0.0/16"
  tags = {
    env  = terraform.workspace
    team = "platform"
  }
}
