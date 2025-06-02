# Complete Railway Deployment Guide for Storywink.ai Monorepo

This guide will walk you through deploying the Storywink.ai monorepo to Railway, including all services (Next.js web app, Express API, Workers, PostgreSQL, and Redis).

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Overview](#overview)
3. [Step 1: Prepare Your Repository](#step-1-prepare-your-repository)
4. [Step 2: Create Railway Project](#step-2-create-railway-project)
5. [Step 3: Deploy PostgreSQL](#step-3-deploy-postgresql)
6. [Step 4: Deploy Redis](#step-4-deploy-redis)
7. [Step 5: Deploy Web Application](#step-5-deploy-web-application)
8. [Step 6: Deploy API Server](#step-6-deploy-api-server)
9. [Step 7: Deploy Workers](#step-7-deploy-workers)
10. [Step 8: Configure Clerk Webhooks](#step-8-configure-clerk-webhooks)
11. [Step 9: Verify Deployment](#step-9-verify-deployment)
12. [Troubleshooting](#troubleshooting)

## Prerequisites

Before starting, ensure you have:
- A GitHub account with your repository pushed
- A Railway account (sign up at [railway.app](https://railway.app))
- A Clerk account with a project created
- Cloudinary account credentials
- OpenAI API key

## Overview

You'll be deploying 5 services:
1. **PostgreSQL** - Database
2. **Redis** - Queue/Cache
3. **Web** - Next.js frontend (port 3000)
4. **API** - Express backend (port 4000)
5. **Workers** - Background job processors

### Quick Deployment Summary
Thanks to the `railway.json` configuration files, most settings are automated. You'll mainly need to:
1. Create services and link to GitHub repo
2. Set root directories
3. Add environment variables
4. Generate domains

## Step 1: Prepare Your Repository

1. Ensure your repository is pushed to GitHub
2. The repository already includes `railway.json` files for each service, which will automatically configure:
   - Build commands
   - Start commands
   - Health checks
   - Restart policies
   - Watch patterns for rebuilds

### Pre-configured Files:
- `apps/web/railway.json` - Web service configuration
- `apps/api/railway.json` - API service configuration
- `apps/workers/railway.json` - Workers service configuration
- `railway-migrate.json` - Database migration configuration
- `nixpacks.toml` - Build environment configuration

These files eliminate most manual configuration in the Railway dashboard!

### Benefits of railway.json Configuration:
- **Automatic Setup**: No need to manually configure build/start commands
- **Health Checks**: Automatically configured for web and API services
- **Smart Rebuilds**: Only rebuilds when relevant files change
- **Region Optimization**: All services deploy to US-East for better inter-service communication
- **Restart Policies**: Appropriate retry strategies for each service type
- **Version Control**: All deployment settings tracked in Git

## Step 2: Create Railway Project

1. Log in to [Railway](https://railway.app)
2. Click **"New Project"**
3. Select **"Empty Project"**
4. Give your project a name (e.g., "storywink-production")

## Step 3: Deploy PostgreSQL

1. In your Railway project, click **"+ New"**
2. Select **"Database"** → **"Add PostgreSQL"**
3. Railway will automatically provision PostgreSQL
4. Click on the PostgreSQL service and go to **"Variables"** tab
5. Note down these values (you'll need them later):
   - `PGHOST`
   - `PGPORT`
   - `PGUSER`
   - `PGPASSWORD`
   - `PGDATABASE`
   - `DATABASE_URL`

## Step 4: Deploy Redis

1. Click **"+ New"** in your project
2. Select **"Database"** → **"Add Redis"**
3. Railway will automatically provision Redis
4. Click on the Redis service and go to **"Variables"** tab
5. Note down the `REDIS_URL`

## Step 5: Deploy Web Application

1. Click **"+ New"** → **"GitHub Repo"**
2. Select your repository
3. Click on the service and rename it to **"web"**
4. Go to **"Settings"** tab and configure:
   - **Root Directory**: `/apps/web`
   - **Config Path**: `railway.json` (Railway will auto-detect this)
   
   The `railway.json` file will automatically configure:
   - Build command
   - Start command
   - Health check at `/api/health`
   - Watch patterns for auto-rebuilds
   - Restart policy

5. Go to **"Variables"** tab and add:
   ```
   # Clerk Authentication
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
   CLERK_SECRET_KEY=sk_test_your_key_here
   CLERK_WEBHOOK_SECRET=whsec_your_secret_here

   # API URL (will be updated after API deployment)
   NEXT_PUBLIC_API_URL=https://your-api-service.railway.app

   # Database (reference the PostgreSQL service)
   DATABASE_URL=${{PostgreSQL.DATABASE_URL}}

   # Port
   PORT=3000
   ```

6. Go to **"Settings"** → **"Networking"** and click **"Generate Domain"**
7. Note down the generated domain (e.g., `storywink-web.railway.app`)

## Step 6: Deploy API Server

1. Click **"+ New"** → **"GitHub Repo"**
2. Select your repository again
3. Click on the service and rename it to **"api"**
4. Go to **"Settings"** tab and configure:
   - **Root Directory**: `/apps/api`
   - **Config Path**: `railway.json` (Railway will auto-detect this)
   
   The `railway.json` file will automatically configure:
   - Build command
   - Start command
   - Health check at `/api/health`
   - Watch patterns for auto-rebuilds
   - Restart policy

5. Go to **"Variables"** tab and add:
   ```
   # Database
   DATABASE_URL=${{PostgreSQL.DATABASE_URL}}

   # Redis
   REDIS_URL=${{Redis.REDIS_URL}}

   # Clerk
   CLERK_SECRET_KEY=sk_test_your_key_here

   # Cloudinary
   CLOUDINARY_CLOUD_NAME=your_cloud_name
   CLOUDINARY_API_KEY=your_api_key
   CLOUDINARY_API_SECRET=your_api_secret

   # OpenAI
   OPENAI_API_KEY=sk-your_openai_key

   # Port
   PORT=4000
   ```

6. Go to **"Settings"** → **"Networking"** and click **"Generate Domain"**
7. Note down the generated domain (e.g., `storywink-api.railway.app`)

8. **Important**: Go back to the **web** service and update:
   ```
   NEXT_PUBLIC_API_URL=https://storywink-api.railway.app
   ```

## Step 7: Deploy Workers

1. Click **"+ New"** → **"GitHub Repo"**
2. Select your repository again
3. Click on the service and rename it to **"workers"**
4. Go to **"Settings"** tab and configure:
   - **Root Directory**: `/apps/workers`
   - **Config Path**: `railway.json` (Railway will auto-detect this)
   
   The `railway.json` file will automatically configure:
   - Build command
   - Start command
   - Watch patterns for auto-rebuilds
   - Restart policy with higher retry count for workers

5. Go to **"Variables"** tab and add:
   ```
   # Database
   DATABASE_URL=${{PostgreSQL.DATABASE_URL}}

   # Redis
   REDIS_URL=${{Redis.REDIS_URL}}

   # OpenAI
   OPENAI_API_KEY=sk-your_openai_key

   # Cloudinary (formatted as URL)
   CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
   ```

## Step 8: Configure Clerk Webhooks

1. Go to your [Clerk Dashboard](https://dashboard.clerk.com)
2. Navigate to **"Webhooks"**
3. Click **"Add Endpoint"**
4. Enter the URL: `https://storywink-web.railway.app/api/webhooks/clerk`
5. Select the following events:
   - `user.created`
   - `user.updated`
   - `user.deleted`
6. Copy the **Signing Secret**
7. Update the `CLERK_WEBHOOK_SECRET` in your Railway web service variables

## Step 9: Verify Deployment

### 1. Check Service Health
- Visit `https://storywink-web.railway.app` - Should see the landing page
- Visit `https://storywink-api.railway.app/api/health` - Should return `{"status":"ok"}`

### 2. Run Database Migrations

#### Option A: Using Migration Service (Recommended)
1. Click **"+ New"** → **"GitHub Repo"**
2. Select your repository
3. Rename the service to **"migrate"**
4. Go to **"Settings"** tab:
   - **Root Directory**: `/`
   - **Config Path**: `railway-migrate.json`
5. Add the same database URL variable:
   ```
   DATABASE_URL=${{PostgreSQL.DATABASE_URL}}
   ```
6. Deploy and wait for migrations to complete
7. Once done, you can remove this service

#### Option B: Manual Migration
1. Go to any service with database access
2. Use the Railway CLI or dashboard to run:
   ```
   npm run db:migrate
   ```

### 3. Test User Authentication
1. Visit your web app and sign up
2. Check Railway logs to ensure webhook was received
3. Verify user was created in database

### 4. Test File Upload
1. Create a new book
2. Upload test images
3. Verify they appear in Cloudinary

### 5. Monitor Background Jobs
1. Check the **workers** service logs
2. Ensure story generation and illustration jobs process correctly

## Environment Variable Reference

### Web Service (.env.local equivalent)
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_API_URL=https://your-api.railway.app
DATABASE_URL=${{PostgreSQL.DATABASE_URL}}
PORT=3000
```

### API Service (.env equivalent)
```
DATABASE_URL=${{PostgreSQL.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
CLERK_SECRET_KEY=sk_test_...
OPENAI_API_KEY=sk-...
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
PORT=4000
```

### Workers Service (.env equivalent)
```
DATABASE_URL=${{PostgreSQL.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
OPENAI_API_KEY=sk-...
CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
```

## Troubleshooting

### Build Failures
1. Check the deploy logs in Railway
2. Ensure all dependencies are listed in package.json
3. Verify build commands are correct

### Database Connection Issues
1. Ensure DATABASE_URL is properly referenced using `${{PostgreSQL.DATABASE_URL}}`
2. Check if migrations have been run
3. Verify PostgreSQL service is running

### Redis Connection Issues
1. Ensure REDIS_URL is properly referenced using `${{Redis.REDIS_URL}}`
2. Check Redis service status
3. Try setting region to "US East" for all services

### API Communication Issues
1. Verify NEXT_PUBLIC_API_URL is set correctly in web service
2. Check CORS configuration in API
3. Ensure API service has a public domain

### Worker Job Processing Issues
1. Check worker logs for errors
2. Verify Redis connection
3. Ensure OpenAI API key is valid
4. Check Cloudinary credentials

### Clerk Webhook Issues
1. Verify webhook URL is correct
2. Check CLERK_WEBHOOK_SECRET matches
3. Review webhook logs in Clerk dashboard
4. Check web service logs for webhook receipts

## Advanced Configuration

### Custom Domains
1. Go to service **"Settings"** → **"Networking"**
2. Add your custom domain
3. Configure DNS as instructed

### Scaling
1. Go to service **"Settings"** → **"Deploy"**
2. Adjust **"Replicas"** count
3. Configure horizontal autoscaling if needed

### Monitoring
1. Use Railway's built-in metrics
2. Set up error tracking (e.g., Sentry)
3. Configure uptime monitoring

## Cost Optimization

1. **Development vs Production**
   - Use sleep settings for development environments
   - Scale down replicas when not needed

2. **Database Optimization**
   - Monitor query performance
   - Set up connection pooling
   - Regular maintenance

3. **Caching Strategy**
   - Utilize Redis effectively
   - Implement CDN for static assets
   - Cache API responses where appropriate

## Next Steps

1. Set up staging environment
2. Configure CI/CD pipeline
3. Implement monitoring and alerting
4. Set up database backups
5. Configure rate limiting
6. Implement error tracking

## Support

- Railway Documentation: [docs.railway.app](https://docs.railway.app)
- Railway Discord: [discord.gg/railway](https://discord.gg/railway)
- Storywink Issues: [GitHub Issues](https://github.com/yourusername/storywink-monorepo/issues)