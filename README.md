# CaeliCode Platform

An evidence-led operational atlas for the CaeliCode engineering workspace. The site distinguishes public implementations, live authenticated systems, active private automation, and reference work so each claim carries its evidence boundary.

## Local preview

Requires Node.js 20 or newer.

```sh
npm run validate
npm test
npm run preview
```

The preview is available at `http://127.0.0.1:4174/` by default. Set `PREVIEW_PORT` to use another port.

## Deployment

GitHub Pages publishes the repository root from `main`. The `CNAME` file maps the site to `platform.caelicode.com`.

Changes should be reviewed in a branch and validated locally before merge. The platform page does not display live platform-wide health; the linked status history is intentionally scoped to the endpoint(s) declared in the public status implementation.
