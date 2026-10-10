# Controlled release gate

Before promoting a release, confirm the exact commit passed CI, review Railway pending changes individually, and verify the production identity provider and AI service settings. Keep the previous deployment available for rollback.

After deployment, confirm that `/api/health` and `/api/ready` both return HTTP 200. If readiness fails or authentication boundaries regress, stop the rollout and restore the last known-good application deployment. Do not roll back database schema blindly.
