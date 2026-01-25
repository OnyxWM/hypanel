# Testing Docker Build

This guide walks you through testing the Docker installation of Hypanel.

## Prerequisites

- Docker 20.10+ and Docker Compose 2.0+ installed
- Ports 3000 and 3001 available on your system

## Step 1: Install Backend Dependencies (for password hash generation)

First, install bcrypt locally so you can generate password hashes:

```bash
cd apps/backend
npm install
cd ../..
```

## Step 2: Generate a Password Hash

Generate a bcrypt hash for your password (recommended for testing):

```bash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('testpassword123', 10).then(h => console.log(h));"
```

Copy the output hash (it will look like `$2b$10$...`).

## Step 3: Configure docker-compose.yml

Edit `docker-compose.yml` and uncomment/add one of these authentication options:

**Option A: Use bcrypt hash (recommended)**
```yaml
environment:
  - HYPANEL_AUTH_METHOD=ENV
  - HYPANEL_PASSWORD_HASH=$2b$10$...  # Paste your hash here
```

**Option B: Use plaintext password (for quick testing)**
```yaml
environment:
  - HYPANEL_AUTH_METHOD=ENV
  - HYPANEL_PASSWORD=testpassword123
```

## Step 4: Build the Docker Image

Build the image (this may take several minutes on first build):

```bash
docker-compose build
```

**Troubleshooting build issues:**
- If build fails, check logs: `docker-compose build --no-cache 2>&1 | tee build.log`
- Verify Node.js and Java downloads are accessible
- Check that all source files are present

## Step 5: Start the Container

Start the container:

```bash
docker-compose up -d
```

## Step 6: Check Container Status

Verify the container is running:

```bash
docker-compose ps
```

You should see the container status as "Up".

## Step 7: View Logs

Watch the logs to ensure everything starts correctly:

```bash
docker-compose logs -f
```

**What to look for:**
- ✅ "Initializing Hypanel daemon..."
- ✅ "Database initialized"
- ✅ "HTTP server listening on port 3000"
- ✅ "WebSocket server initialized"
- ✅ "Hypanel daemon initialized successfully"

**If you see errors:**
- Authentication error: Check that `HYPANEL_PASSWORD_HASH` or `HYPANEL_PASSWORD` is set
- Port conflict: Ensure ports 3000/3001 aren't in use: `lsof -i :3000 -i :3001`
- Permission errors: Check volume mount permissions

## Step 8: Test Health Endpoint

Test that the API is responding:

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{"status":"ok","timestamp":"2026-01-25T..."}
```

## Step 9: Test Web Interface

1. Open your browser and navigate to: `http://localhost:3000`

2. You should see the Hypanel login page.

3. **Test login:**
   - Username: `hypanel` (required)
   - Password: The password you used to generate the hash (or the plaintext password)

4. **Verify authentication:**
   - ✅ Correct password → Should log in successfully
   - ✅ Wrong password → Should show "Invalid username or password"
   - ✅ Wrong username → Should show "Invalid username or password"

## Step 10: Test Authentication Methods

### Test ENV Mode with Bcrypt Hash

1. Stop the container:
   ```bash
   docker-compose down
   ```

2. Update `docker-compose.yml` to use hash:
   ```yaml
   - HYPANEL_PASSWORD_HASH=$2b$10$...  # Your hash
   ```

3. Start and test:
   ```bash
   docker-compose up -d
   docker-compose logs -f
   ```

### Test ENV Mode with Plaintext

1. Update `docker-compose.yml`:
   ```yaml
   - HYPANEL_PASSWORD=testpassword123
   ```

2. Restart and test:
   ```bash
   docker-compose restart
   ```

### Test Fail-Fast (No Credentials)

1. Remove both password env vars from `docker-compose.yml`

2. Try to start:
   ```bash
   docker-compose up -d
   docker-compose logs
   ```

3. **Expected:** Container should exit with error:
   ```
   ERROR: HYPANEL_AUTH_METHOD=ENV requires HYPANEL_PASSWORD_HASH or HYPANEL_PASSWORD to be set
   ```

## Step 11: Verify Data Persistence

1. Create a test server or make some changes in the web interface

2. Stop the container:
   ```bash
   docker-compose down
   ```

3. Verify data directories exist:
   ```bash
   ls -la data/ servers/ logs/ backup/
   ```

4. Restart the container:
   ```bash
   docker-compose up -d
   ```

5. **Verify:** Your data should still be there after restart

## Step 12: Test Container Commands

```bash
# View logs
docker-compose logs --tail=50

# Access container shell
docker-compose exec hypanel bash

# Check Java version (inside container)
docker-compose exec hypanel java -version

# Check Node.js version
docker-compose exec hypanel node --version

# Check hytale-downloader
docker-compose exec hypanel hytale-downloader --version

# Restart container
docker-compose restart

# Stop container
docker-compose stop

# Remove container (keeps volumes)
docker-compose down
```

## Step 13: Test Multi-Architecture (Optional)

If you want to test ARM64 build:

```bash
docker buildx build --platform linux/arm64 -t hypanel:arm64 .
```

## Common Issues and Solutions

### Issue: "Permission denied" errors
**Solution:** Check volume permissions:
```bash
sudo chown -R $USER:$USER data/ servers/ logs/ backup/
```

### Issue: "Port already in use"
**Solution:** Change ports in `docker-compose.yml` or stop conflicting service:
```bash
lsof -ti:3000 | xargs kill -9
```

### Issue: "Container exits immediately"
**Solution:** Check logs for errors:
```bash
docker-compose logs
```

### Issue: "Cannot connect to web interface"
**Solution:** 
- Verify container is running: `docker-compose ps`
- Check firewall settings
- Try `curl http://localhost:3000/health` from host

### Issue: "Authentication fails"
**Solution:**
- Verify password hash was generated correctly
- Check `docker-compose.yml` has correct env vars
- View logs: `docker-compose logs | grep -i auth`

## Clean Up

To completely remove the test installation:

```bash
# Stop and remove container
docker-compose down

# Remove volumes (deletes all data)
docker-compose down -v

# Remove image
docker rmi hypanel:latest
```

## Next Steps

Once testing is complete:
1. Use a strong password hash in production
2. Set up proper volume backups
3. Configure reverse proxy if needed
4. Set up monitoring/logging
