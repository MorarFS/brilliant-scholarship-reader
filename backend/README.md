# Chronicle protected summary API

This directory is a deployable Cloud Run scaffold for optional Vertex AI paper summaries. It is deliberately separate from the GitHub Pages frontend.

## Security boundary

- The browser uses Google Identity Services to obtain a Google ID token. The token is kept only in React memory and is never written to local storage, IndexedDB, the repository, or an export.
- `POST /v1/summaries` verifies that token against one configured web client ID, requires a verified email, and then checks an explicit `ALLOWED_EMAILS` allowlist **before** any Vertex request.
- CORS permits only the configured Pages/local origins. Requests and responses use `Cache-Control: no-store`.
- The request contract accepts only bounded citation metadata and an abstract. PDFs, Reading Room text, highlights, annotations, library information, and browser storage are not accepted.
- Vertex AI uses Application Default Credentials supplied by the Cloud Run service identity. The service refuses to start when `GOOGLE_APPLICATION_CREDENTIALS` is set. Do not create, download, upload, paste, or store a service-account key.
- The runtime service account needs only `roles/aiplatform.user`. It should not receive Owner, Editor, storage, repository, or GitHub permissions.
- A per-user in-memory request limit provides an additional small-deployment guard. It resets on an instance restart and is not a billing cap; set Vertex quotas, Cloud Run maximum instances, and a Google Cloud budget/alert as separate controls.

The health route is public and does not call Vertex. The summary route is never an unauthenticated model proxy.

## Prerequisites

1. A Google Cloud project with billing enabled.
2. An authenticated Google Cloud administrator/deployer who can enable APIs, create a service account, deploy Cloud Run, and grant `roles/aiplatform.user` plus `roles/iam.serviceAccountUser` on the runtime service account.
3. A chosen Cloud Run region and Vertex model/location. The checked-in default is `gemini-2.5-flash` at Vertex location `global`; confirm current model availability and pricing before deployment.
4. Vertex AI, Cloud Run, Cloud Build, and Artifact Registry APIs enabled.
5. An OAuth consent screen and an OAuth 2.0 **Web application** client ID. Add `https://morarfs.github.io` as an authorized JavaScript origin; add `http://localhost:5173` only for local development.
6. At least one verified Google account email for `ALLOWED_EMAILS`.

No OAuth client secret is used by the static popup flow. The web client ID and Cloud Run URL are public identifiers, not credentials.

## Local verification

```bash
npm ci
npm test
```

Copy `.env.example` to an untracked local environment file only if you are testing the server. Use `gcloud auth application-default login` for local ADC. Never place the resulting local credentials or raw tokens in this project.

## Deployment outline — run only after reviewing project context

Set shell variables locally; do not commit their values:

```bash
PROJECT_ID="your-project-id"
RUN_REGION="your-cloud-run-region"
SERVICE_ACCOUNT="chronicle-summary-api@${PROJECT_ID}.iam.gserviceaccount.com"
```

Enable the required services and create the dedicated identity:

```bash
gcloud services enable aiplatform.googleapis.com run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project "$PROJECT_ID"
gcloud iam service-accounts create chronicle-summary-api --project "$PROJECT_ID" --display-name "Chronicle Vertex summary API"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${SERVICE_ACCOUNT}" --role roles/aiplatform.user
```

Deploy from this directory. `--allow-unauthenticated` makes the HTTPS service reachable from GitHub Pages; application code still rejects the cost-bearing route until it verifies a Google ID token and email allowlist. Start with one maximum instance for a personal research service.

```bash
gcloud run deploy chronicle-summary-api \
  --source . \
  --project "$PROJECT_ID" \
  --region "$RUN_REGION" \
  --service-account "$SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 1 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=global,VERTEX_MODEL=gemini-2.5-flash,GOOGLE_WEB_CLIENT_ID=YOUR_PUBLIC_WEB_CLIENT_ID,ALLOWED_EMAILS=YOUR_AUTHORIZED_EMAIL,ALLOWED_ORIGINS=https://morarfs.github.io,MAX_REQUESTS_PER_USER_PER_HOUR=20"
```

For more than one allowed email, use a Cloud Run environment-variable file rather than shell comma escaping. The file must remain untracked.

After deployment, add these **GitHub repository variables** (not secrets) and rerun the Pages workflow:

- `VITE_SUMMARY_API_URL`: the HTTPS Cloud Run service URL.
- `VITE_GOOGLE_CLIENT_ID`: the public OAuth web client ID.

The frontend stays disabled when either variable is absent. Never add a service-account key, access token, OAuth client secret, or `GOOGLE_APPLICATION_CREDENTIALS` to GitHub variables, secrets, Pages assets, or Actions logs.

## Verification checklist

- `GET /healthz` returns `200` without calling Vertex.
- `POST /v1/summaries` without a bearer token returns `401` and incurs no model call.
- A valid but non-allowlisted Google account returns `401` and incurs no model call.
- A disallowed browser origin returns `403`.
- An allowed signed-in user can summarize a paper with an abstract.
- Built Pages assets contain only the public service URL and web client ID—no service identity, token, key, or allowlist.
