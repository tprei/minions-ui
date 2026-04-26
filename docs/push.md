# Web Push notifications

`minions-ui` can subscribe to a minion's Web Push channel so the browser shows a
notification (and focuses the app on click) when the minion has news — typically
when a session needs attention or a long-running task finishes.

The flow is opt-in per connection and gated behind a build flag, because the
Web Push API throws `SecurityError` on non-HTTPS origins.

## Build-time flag

The "Enable notifications" UI only renders when the app is built with:

```sh
VITE_ENABLE_PUSH=1 npm run build
```

For local development against a real minion over HTTPS:

```sh
VITE_ENABLE_PUSH=1 npm run dev
```

When the flag is **off** (the default), the UI is hidden entirely. This avoids
shipping a button that silently fails on `http://localhost`.

## Server requirements

The connected minion must:

1. Advertise the `web-push` capability in `GET /api/version` →
   `features: [..., "web-push"]`.
2. Expose the VAPID public key at `GET /api/push/vapid-public-key` →
   `{ data: { key: "<base64url>" } }`.
3. Accept a `PushSubscriptionJSON` payload at `POST /api/push-subscribe` and
   return `{ data: { ok: true, id: "<sub-id>" } }`.
4. Accept `DELETE /api/push-subscribe` with `{ "endpoint": "<endpoint>" }` to
   remove a subscription.

If `web-push` is missing from `features`, the UI shows
"This minion does not advertise the web-push feature" instead of the toggle.

## Client flow

1. User opens a connection in **Settings → Edit connection**.
2. The Notifications panel calls `Notification.requestPermission()`.
3. On `granted`, the client fetches the VAPID public key and subscribes via
   `registration.pushManager.subscribe({ userVisibleOnly: true, ... })`.
4. The resulting `PushSubscriptionJSON` is POSTed to `/api/push-subscribe`.
5. To turn notifications off, the client calls `DELETE /api/push-subscribe`
   with the endpoint and `subscription.unsubscribe()`.

## Notification payload

The service worker (`src/sw.ts`) treats the push payload as JSON:

```json
{
  "title": "Session needs attention",
  "body":  "fluffy-otter is waiting for feedback",
  "tag":   "session:abc-123",
  "url":   "/#/s/fluffy-otter",
  "icon":  "/icons/icon-192.png",
  "badge": "/icons/icon-192.png",
  "actions": [
    { "action": "approve", "title": "Approve" },
    { "action": "reject", "title": "Reject" }
  ],
  "data": {
    "sessionId": "abc-123",
    "slug": "fluffy-otter",
    "baseUrl": "https://api.example.com",
    "token": "bearer-token"
  }
}
```

`title` and `body` are optional; missing fields fall back to a generic title and
the default app icon. `url` controls where `notificationclick` focuses or opens
the app — open windows pointing at the same URL are reused, then re-navigated,
then opened fresh as a last resort.

### Interactive action buttons

Notifications can include up to 2 action buttons that send commands directly to
the minion without opening the app:

- **Approve/Reject** — shown for `waiting_for_feedback` attention reason. Clicking sends `/approve` or `/reject` to the session.
- **Continue** — shown for `interrupted` attention reason. Clicking sends `/continue` to the session.

Action handlers require `baseUrl`, `token`, and `sessionId` in the notification
`data` object. The service worker makes an authenticated `POST /api/messages`
request with the corresponding command text.

## Why HTTPS only?

Per the W3C Web Push spec, `PushManager.subscribe` rejects with `SecurityError`
on non-secure origins. We could detect this at runtime and show an inline
message, but that still leaves a "broken button" trail on `localhost`. The
build-time flag means notifications never render in dev unless you've
deliberately opted in (e.g., behind `https://localhost` via `mkcert` or a
reverse proxy that terminates TLS).

## Testing

Unit tests live in `test/pwa/push.test.ts` and cover the URL-base64 conversion,
support detection, and the subscribe/unsubscribe flow against a mocked
service-worker registration. End-to-end tests skip push by default — toggling
`VITE_ENABLE_PUSH=1` in a Playwright project runs the panel checks.
