# Cloudflare staging secret names

Create these as **Cloudflare Worker Secrets** for the staging Worker. Do not add their values to Wrangler variables, `.env.example`, source files, or deployment logs.

- `GCP_SERVICE_ACCOUNT_EMAIL`
- `GCP_SERVICE_ACCOUNT_PRIVATE_KEY_ID`
- `GCP_SERVICE_ACCOUNT_PRIVATE_KEY`

The service account must be authorized only for Google Cloud project `tany-whatsapp`, with Secret Manager permissions needed to create a secret and add/access secret versions. Cloudflare runtime code rejects any other Secret Manager project.
