variable "domain_name" {
  description = "Apex domain to serve the SPA from. Hosted zone with this name must already exist in Route 53."
  type        = string
}

variable "project_name" {
  description = "Short identifier used in resource names and tags."
  type        = string
  default     = "r2ts"
}
