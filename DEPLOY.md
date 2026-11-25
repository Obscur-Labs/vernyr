# Deploying Vernyr

Vernyr is La Europa's platform. One repo, five pieces, two hosts:

| Piece | Folder | Host | Address |
|---|---|---|---|
| API | `backend/` | Render (`render.yaml`) | `api.vernyr.com` |
| Admin portal (staff + admin) | `crm/` | Vercel | `crm.vernyr.com` |
| Student portal | `portal/` | Vercel | `portal.vernyr.com` |
| University partner portal (on hold) | `partner/` | Vercel | `partner.vernyr.com` |
| Public website | `website/` | Vercel | `vernyr.com`, `www.vernyr.com` |

Database: MongoDB Atlas, database `vernyr` (live) and `vernyr_dev` (local). Files: Cloudinary.

## Every deploy (after the one-time setup)

```bash
npm run doctor        # checks every .env; fix anything marked FIX
npm run build         # optional: the same build the hosts run
git push origin main  # Render and Vercel deploy on their own
```

Only what changed is rebuilt: Render watches `backend/**` and the lockfile (`buildFilter` in `render.yaml`),
and each Vercel project skips the build when its own folder did not change (`ignoreCommand` in its `vercel.json`).

If you changed an environment value: `npm run deploy:env`, paste the changed file into its host, redeploy that one.

## One-time setup

### 1. Values

```bash
npm run doctor            # every check green
npm run doctor -- --connect   # also connects to both databases and Cloudinary
npm run deploy:env        # writes deploy/out/*.env, ready to paste (git-ignored, contains secrets)
```

### 2. MongoDB Atlas

- Network Access: allow `0.0.0.0/0` (Render's free plan has no fixed IP).
- The live URI must name the database: `.../vernyr?appName=Cluster0`. `npm run doctor` refuses a URI without one.

### 3. Render (API)

1. Render > New > Blueprint > pick the `Obscur-Labs/vernyr` repo. It reads `render.yaml` and creates `studycrm-api`.
   (Already created? Open the service > Settings and it keeps following `render.yaml`.)
2. Environment > "Add from .env" > paste `deploy/out/render.env`.
3. Custom domain: `api.vernyr.com` (add the CNAME Render shows at your DNS provider).
4. Check: `https://api.vernyr.com/api/health` answers `{"status":"ok","storage":"cloudinary"}`.

### 4. Vercel (four projects, same repo)

For each row: Vercel > Add New > Project > `Obscur-Labs/vernyr`, then:

| Project | Root Directory | Paste | Domain |
|---|---|---|---|
| crm | `crm` | `deploy/out/vercel-crm.env` | `crm.vernyr.com` |
| portal | `portal` | `deploy/out/vercel-portal.env` | `portal.vernyr.com` |
| partner | `partner` | `deploy/out/vercel-partner.env` | `partner.vernyr.com` |
| website | `website` | nothing | `vernyr.com`, `www.vernyr.com` |

Leave Framework, Install and Build on their defaults; each app's `vercel.json` only adds the rule that skips a build when that app did not change.

> The existing student project was pointed at `student/`. That folder is now `portal/`:
> Vercel > that project > Settings > Build & Deployment > Root Directory > `portal`.

### 5. First Admin on the live database (once)

From your machine, in any terminal (it connects with the LIVE_ values in `backend/.env`):

```bash
npm run bootstrap -- --live --email you@laeuropa.com --name "Your Name"
```

Leave out `--email` and it asks. Without `--password` it prints a one-time password: sign in at `crm.vernyr.com` and change it.
Without `--live` it creates the Admin in the local database (`vernyr_dev`).

## Local development

```bash
npm install
npm run bootstrap     # first Admin in vernyr_dev (asks for the email)
npm run dev           # API :5000, crm :3000, portal :3001, website :3002
npm run dev:all       # the same plus partner :3003
```

`npm run seed` fills `vernyr_dev` with demo data (it wipes it first and refuses to run in live mode).

## Rules that keep production safe

- Never set `ENABLE_DEV_ROUTES` on Render. `deploy:env` never copies it.
- Never point `LOCAL_MONGODB_URI` at the live database. `npm run doctor` stops you.
- `.env` files and `deploy/out/` are git-ignored. Do not commit them or paste them into chats.
