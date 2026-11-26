# Deploy Arisanly on a single host

Use a Linux host with Docker Engine, Docker Compose v2 supporting `!reset`, and a DNS hostname you control. An EC2 instance is one option. Point the hostname at the host and allow inbound TCP 80 and 443. Restrict administrative SSH to your own network, or use an existing private administrative connection. Caddy obtains and renews the certificate. [Docker Compose merge reference](https://docs.docker.com/reference/compose-file/merge/) · [Caddy HTTPS quick-start](https://caddyserver.com/docs/quick-starts/https) · [EC2 security groups](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/creating-security-group.html)

## First deployment

From the repository root, keep production settings in a separate private file. Run the copy command on first setup only.

```bash
umask 077
cp -n deploy/.env.example .env.production
openssl rand -hex 32
openssl rand -hex 24
```

Set `ARISANLY_DOMAIN` to the hostname only, with no scheme or path. Set `ARISANLY_JWT_SECRET` and `POSTGRES_PASSWORD` to the independently generated values. Keep the database password hexadecimal so it can be used directly in the PostgreSQL connection URI. Keep the file and the generated values private.

```bash
compose=(docker compose --env-file .env.production -f docker-compose.yml -f deploy/compose.yml)
"${compose[@]}" config --quiet
"${compose[@]}" up --build --detach --wait --wait-timeout 120
"${compose[@]}" ps
```

The override publishes only Caddy on ports 80 and 443. PostgreSQL, Redis, Go, and Next.js communicate on the Compose network. The database migration must succeed before the API and worker start.

From a machine outside the host, point `ARISANLY_WEB_URL` to the public HTTPS origin and run:

```bash
export ARISANLY_WEB_URL=https://arisanly.example.com
node scripts/release-smoke.mjs
```

Use Node.js 24 for the release and demo scripts. The release smoke test is read-only. On a dedicated demo deployment, run `node scripts/seed-demo.mjs` to create synthetic records and get a read-only summary URL. Each run creates a new pair of groups. To review the seeded dashboard privately, set `ARISANLY_DEMO_PASSWORD` to a private password of at least 20 bytes before seeding. The script prints the generated login emails only when this password is set. Keep those accounts private. Publish the resulting HTTPS URL in the project README only after verifying it.

## Operations before a real pilot

- Keep demo and pilot deployments on separate databases or hosts. Recruit a consenting group and make sure participants know that payments and transfers happen outside Arisanly.
- Keep encrypted, off-host PostgreSQL backups. Test restoring a backup into a separate database before inviting the group and before changing the deployed database version.
- Review container logs with `"${compose[@]}" logs --tail=100 api worker proxy`. Use `/readyz` to check PostgreSQL connectivity and check the worker logs for reconciliation and reminder activity.
- For an app update, take a backup, record the current revision, and rerun the deployment command on the reviewed revision. Check migration success and rerun the release smoke test. Recovery from an incompatible migration requires a reviewed migration or a tested database restore.
