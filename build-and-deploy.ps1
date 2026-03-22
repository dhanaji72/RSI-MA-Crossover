# =============================================================================
# Finvasia Trading Bot - Build and Deploy Script (Windows)
# =============================================================================
# Run this on your LOCAL Windows machine to build and deploy to server
# =============================================================================

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Finvasia Trading Bot - Build & Deploy" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Check if in correct directory
if (-not (Test-Path "package.json")) {
    Write-Host "Error: package.json not found. Run this script from the Finvasia directory." -ForegroundColor Red
    exit 1
}

# Clean previous build
Write-Host "[1/5] Cleaning previous build..." -ForegroundColor Yellow
if (Test-Path "build") {
    Remove-Item -Recurse -Force build
    Write-Host "✓ Build directory cleaned" -ForegroundColor Green
}
if (Test-Path "tsconfig.tsbuildinfo") {
    Remove-Item -Force tsconfig.tsbuildinfo
}

# Install dependencies
Write-Host "[2/5] Installing dependencies..." -ForegroundColor Yellow
npm install
Write-Host "✓ Dependencies installed" -ForegroundColor Green

# Build application
Write-Host "[3/5] Building TypeScript application..." -ForegroundColor Yellow
Write-Host "This may take 1-2 minutes..." -ForegroundColor Gray
npm run build:prod

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Build failed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "1. Close other applications to free up memory" -ForegroundColor Gray
    Write-Host "2. Increase virtual memory in Windows settings" -ForegroundColor Gray
    Write-Host "3. Try running: npm run clean, wait 30 seconds, then npm run build" -ForegroundColor Gray
    exit 1
}

Write-Host "✓ Build successful" -ForegroundColor Green

# Check build directory
if (-not (Test-Path "build\index.js")) {
    Write-Host "✗ Build output not found!" -ForegroundColor Red
    exit 1
}

# Commit to git
Write-Host "[4/5] Committing to git..." -ForegroundColor Yellow
git add build/ package.json ecosystem.config.js tsconfig.json
git add -f build/  # Force add build directory even if in .gitignore

$commitMessage = "Production build - $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git commit -m $commitMessage

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Changes committed" -ForegroundColor Green
} else {
    Write-Host "! No changes to commit or commit failed" -ForegroundColor Yellow
}

# Push to remote
Write-Host "[5/5] Pushing to remote repository..." -ForegroundColor Yellow
git push

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Changes pushed to remote" -ForegroundColor Green
} else {
    Write-Host "✗ Push failed!" -ForegroundColor Red
    Write-Host "You may need to pull first: git pull" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Build Complete! Now deploy on server:" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "On your server, run:" -ForegroundColor Yellow
Write-Host "  cd ~/apps/Finvasia" -ForegroundColor White
Write-Host "  ./deploy.sh" -ForegroundColor White
Write-Host ""
Write-Host "Or manually:" -ForegroundColor Yellow
Write-Host "  git pull" -ForegroundColor White
Write-Host "  pm2 restart finvasia-trading" -ForegroundColor White
Write-Host ""
Write-Host "Build artifacts:" -ForegroundColor Gray
Write-Host "  build/index.js - Main application" -ForegroundColor Gray
Write-Host "  build/strategies/ - Trading strategies" -ForegroundColor Gray
Write-Host "  build/services/ - Core services" -ForegroundColor Gray
Write-Host ""
