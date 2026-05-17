# Mobile App Assets

Replace these placeholder files with your actual brand assets before building for production.

## Required files

| File | Size | Purpose |
|------|------|---------|
| `icon.png` | 1024×1024 | App icon (iOS + Android) |
| `splash.png` | 1284×2778 | Splash/loading screen |
| `adaptive-icon.png` | 1024×1024 | Android adaptive icon foreground |
| `notification-icon.png` | 96×96 | Push notification icon (Android) |

## Design specs
- Background color: `#0F1923` (dark blue-grey)
- Primary color: `#3B82F6` (blue)
- Icon should be simple, readable at small sizes
- Splash should have logo centered on the dark background

## Quick placeholder generation
Run this from the `mobile/` directory to generate placeholder PNGs:
```bash
# Requires ImageMagick
convert -size 1024x1024 xc:#0F1923 -fill '#3B82F6' -gravity center -pointsize 200 -annotate 0 'CPM' assets/icon.png
convert -size 1024x1024 xc:#0F1923 -fill '#3B82F6' -gravity center -pointsize 200 -annotate 0 'CPM' assets/adaptive-icon.png
convert -size 1284x2778 xc:#0F1923 -fill '#3B82F6' -gravity center -pointsize 120 -annotate 0 'ConstructPM' assets/splash.png
convert -size 96x96 xc:#3B82F6 -fill white -gravity center -pointsize 40 -annotate 0 'C' assets/notification-icon.png
```
