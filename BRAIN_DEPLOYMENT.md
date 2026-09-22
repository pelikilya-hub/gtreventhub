# GTR BRO Brain Deployment Guide

## Current Status
- ✅ PowerShell script fixes committed (c351d7e + follow-ups with UTF-8 BOM)
- ✅ Code changes in main branch
- ❌ Windows machine not yet running fixed script
- ❌ Brain returning Cloudflare error 1016 (origin unreachable)
- ❌ DNS record brain.gtr.events not configured at GoDaddy

## What Was Broken
The original `setup-brain-gpu.ps1` had an unclosed quote in a Write-Host statement about GPU memory, causing PowerShell to fail parsing the entire file. This prevented the script from running at all.

**Root cause:** Line with Cyrillic text and improper quote handling
**Impact:** Brain stayed offline for 70+ hours, system fell back to CPU-based Gemini

## What Was Fixed (in code)
1. **Quote handling** (commit c351d7e): Closed unclosed quote
2. **UTF-8 BOM** (commit 25eb47d): Added proper file encoding for PowerShell 5.1
3. **Auto-start via SYSTEM** (subsequent commits): Brain now survives user logoff/reboot
4. **Self-registration** (commit features): Script calls `pult.brain` to register tunnel address
5. **Monitoring** (continuous monitoring): Added persistent monitoring with restart capability
6. **Logging** (brain.log): Full execution log for debugging

## How to Deploy

### On Windows Machine (Where RTX 5060 Ti Lives)

1. **Download the fixed script**
   ```powershell
   # Either: copy from repository or download latest
   # File should be: C:\Users\<user>\Downloads\setup-brain-gpu.ps1
   ```

2. **Run with administrative privileges (FIRST TIME ONLY)**
   ```powershell
   # Open PowerShell as Administrator
   # Navigate to Downloads folder
   cd C:\Users\<user>\Downloads
   
   # Get the pult key from /bro-dev dashboard (ask BOSS for it)
   # Then run:
   powershell -ExecutionPolicy Bypass -File .\setup-brain-gpu.ps1 -PultKey <key>
   ```

3. **Verify startup**
   - Script creates working directory: `C:\gtr-brain`
   - Downloads llama.cpp and Qwen3-8B model (~5GB)
   - Sets up Windows scheduled task for auto-start
   - Registers tunnel address via `pult.brain` action
   - Log saved to: `C:\gtr-brain\brain.log`

### DNS Configuration (GoDaddy)

Need to configure a persistent tunnel address. Two options:

#### Option A: Named Tunnel (Recommended - Permanent Address)
1. Named tunnel requires Cloudflare nameserver setup
2. Since GoDaddy holds zone, need to either:
   - Transfer zone to Cloudflare, OR
   - Point GoDaddy nameservers to Cloudflare

#### Option B: Quick Tunnel (Temporary - Changes on Reboot)
- Works immediately, no DNS setup needed
- New address generated each time (problematic for persistence)
- Script handles re-registration automatically

## Verification Steps

After script runs on Windows machine:

1. **Check local brain**
   ```powershell
   # Should return 200 with model info
   curl.exe -H "Authorization: Bearer <token>" http://127.0.0.1:8080/v1/models
   ```

2. **Check tunnel registration**
   - Visit https://gtrevent.com/api/bro-dev?pult=<key>
   - Should show brain URL in recent pult items
   - pult.brain action should show "done" status

3. **Test from product**
   - POST to https://gtrevent.com/api/bro-dev with action="pult.brainTest"
   - Should return 200 with response from model

## Current Blockers

1. **Windows machine offline**: No one has run the fixed script on the machine yet
2. **DNS not configured**: brain.gtr.events NXDOMAIN
   - GoDaddy zone needs either:
     - Cloudflare nameserver delegation, OR
     - Manual A record pointing to tunnel destination
3. **Tunnel address unregistered**: script needs to run at least once to register address

## What Happens When Script Runs

1. Detects RTX 5060 Ti GPU (or another NVIDIA GPU)
2. Downloads appropriate llama.cpp binary (CUDA/Vulkan based on GPU)
3. Downloads Qwen3-8B model to `C:\gtr-brain`
4. Generates access token
5. Starts llama-server on http://127.0.0.1:8080
6. Starts cloudflared tunnel (quick tunnel initially)
7. Registers tunnel URL via pult.brain action to /bro-dev
8. Sets up Windows scheduled task for auto-start at system boot
9. Monitors both processes, restarts if they fail
10. Re-registers tunnel URL every 10 minutes (in case it changes)

## Troubleshooting

### If script fails to run:
- Check PowerShell version (should be 5.1+)
- Run with `-Unattended` flag for silent mode
- Check logs: `Get-Content C:\gtr-brain\brain.log`

### If brain shows 401 error:
- Token in KV doesn't match token on server
- Re-run script with correct token
- Check: `C:\gtr-brain\llama-server.env` for actual token

### If tunnel isn't registered:
- Check internet connection on Windows machine
- Ensure firewall allows outbound HTTPS (cloudflared)
- Check `C:\gtr-brain\tunnel.err.log` for errors

### If GPU not detected:
- Check NVIDIA drivers are installed
- Run: `nvidia-smi` from command line
- If missing, install latest NVIDIA drivers for RTX 5060 Ti

## Files Changed

- `infra/bro-brain/gpu/setup-brain-gpu.ps1` - PowerShell automation script
- `src/routes/api.bro-dev.ts` - pult actions for brain management
- `src/gtr/bro/brain-watch.ts` - Brain monitoring logic

## Next Steps

1. Run the script on Windows machine with admin privileges
2. Wait for brain URL to appear in pult queue via pult.brain action
3. Configure DNS for permanent address (if using named tunnel)
4. Verify brain responds to test queries
5. Monitor logs: `/api/bro-dev?pult=<key>&debug=1`
