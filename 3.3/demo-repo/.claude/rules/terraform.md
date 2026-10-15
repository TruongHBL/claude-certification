---
paths:
  - "terraform/**/*"
  - "**/*.tf"
  - "infrastructure/**/*"
---

# Quy ước hạ tầng (Terraform)

CANARY-RULE-TF-3W

- State luôn ở remote backend (S3 + DynamoDB lock), không bao giờ để local.
- Tách môi trường bằng workspace (`dev`, `stg`, `prod`).
- Module có version cố định và CHANGELOG.
- Tên resource dạng snake_case, bắt buộc tag `env` và `team`.
