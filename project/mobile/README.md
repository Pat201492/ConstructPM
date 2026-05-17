# Mobile App Setup Guide

## Quick Start (Development)

### Prerequisites
- Node.js 18+
- Expo Go app on your phone (App Store / Play Store)
- Backend server running (`docker compose up`)

### Steps
```bash
cd mobile
npm install

# IMPORTANT: Edit the API URL to point to your dev machine
# Open src/services/api.js, line 7:
#   const BASE_URL = __DEV__ ? 'http://YOUR_IP:3000' : ...
# Replace YOUR_IP with your computer's local network IP (not localhost)
# Find it with: ipconfig (Windows) or ifconfig (Mac/Linux)

npx expo start
# Scan the QR code with Expo Go on your phone
# Both phone and computer must be on the same WiFi network
```

### Test Accounts
| Email | Password | Role | Mobile Tabs |
|-------|----------|------|-------------|
| admin@company.com | ChangeMe123! | Admin | Requests overview |
| mike.torres@company.com | Password123! | PM | Equipment Requests + Quick Bid |
| ray.jackson@company.com | Password123! | Shop Staff | Open / Return / Maintenance |
| carlos.mendez@company.com | Password123! | Foreman | Field Notes + Oil Samples |

---

## Push Notifications Setup

Push notifications require real device tokens (not available in Expo Go simulator).

### Android (Firebase Cloud Messaging)
1. Create a Firebase project at https://console.firebase.google.com
2. Add an Android app with package name `com.constructpm.mobile`
3. Download `google-services.json` → place in `mobile/` root
4. Copy the FCM Server Key → set as `FIREBASE_SERVER_KEY` in backend `.env`

### iOS (Apple Push Notification Service)
1. Apple Developer account ($99/year) at https://developer.apple.com
2. Create App ID with Push Notifications capability
3. Generate APN Auth Key → configure in Expo dashboard or EAS

### Backend Push Delivery
The backend uses the Expo Push Service to send notifications:
```
Backend → Expo Push API → Apple APN / Google FCM → Device
```
Push tokens are registered automatically when the user logs in on mobile.
The `user_devices` table stores tokens. `NotificationService` sends to all registered devices.

---

## Production Build

### Install EAS CLI
```bash
npm install -g eas-cli
eas login
```

### Build for Testing
```bash
cd mobile
# Android APK (sideload for testing)
eas build --platform android --profile preview

# iOS (TestFlight)
eas build --platform ios --profile preview
```

### Build for Store Release
```bash
# Android AAB (Play Store)
eas build --platform android --profile production

# iOS (App Store)
eas build --platform ios --profile production
```

### Submit to Stores
```bash
# Before first submit, configure eas.json with your Apple ID and Google Play key

# iOS → App Store Connect
eas submit --platform ios

# Android → Google Play Console
eas submit --platform android
```

---

## Production API URL

Before building for production, update `src/services/api.js`:

```javascript
const BASE_URL = __DEV__
  ? 'http://192.168.1.100:3000'     // ← dev machine IP
  : 'https://your-domain.com';       // ← production server URL
```

The production server must have:
- HTTPS (TLS certificate)
- Port 443 open
- The same backend API running

---

## App Structure

```
mobile/
├── App.js                    # Entry + auth routing
├── app.json                  # Expo config
├── eas.json                  # Build profiles
├── package.json
├── babel.config.js
├── assets/                   # App icons, splash (replace placeholders!)
└── src/
    ├── theme.js              # Dark theme constants
    ├── contexts/
    │   └── AuthContext.js    # Login/logout, token storage, push registration
    ├── services/
    │   └── api.js            # API client with auto-refresh
    ├── components/
    │   └── UI.js             # Shared components (16 exports)
    ├── navigation/
    │   └── AppNavigator.js   # Role-based tab bars
    └── screens/
        ├── shared/           # Login, Profile, Notifications
        ├── admin/            # Equipment request overview
        ├── pm/               # Equipment Requests + Quick Bid
        ├── shop/             # Open / Return / Maintenance (barcode)
        └── foreman/          # Field Notes + Oil Samples (vision)
```

## Role → Tab Mapping

| Role | Tab 1 | Tab 2 | Tab 3 | Tab 4 |
|------|-------|-------|-------|-------|
| Admin | Requests | Notifications | Profile | — |
| PM | Equipment Requests | Quick Bid | Notifications | Profile |
| Shop Staff | Open Requests | Return | Maintenance | Profile |
| Foreman | Field Notes | Oil Samples | Profile | — |

All roles get a bell icon (🔔) in the header for quick notification access.
