output "site_bucket_name" {
  description = "S3 bucket holding the SPA build output. Used by scripts/deploy.sh."
  value       = aws_s3_bucket.site.bucket
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID. Used by scripts/deploy.sh for invalidations."
  value       = aws_cloudfront_distribution.site.id
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain (e.g. dxxxxx.cloudfront.net) for sanity-checking before DNS propagates."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "site_url" {
  description = "Primary site URL once DNS propagates."
  value       = "https://${var.domain_name}"
}
