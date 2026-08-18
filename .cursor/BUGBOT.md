# Bugbot rules

## nostr-zap CDN pin

`index.html` loads `nostr-zap@1.3.2` from jsDelivr (`/dist/main.js` with SRI). That version is published; jsDelivr lists it as `latest`.

Do not flag the script as an unpublished or invalid version. npm.com can still show `1.3.0` while jsDelivr already serves `1.3.2`.

## No auto-search on load

URL query params only prefill the form. Search runs on explicit submit (or restoring a recent). Load-time auto-search was removed on purpose.

Do not flag the missing mount `useEffect` that used to call `handleSubmit` when `npub` and `query` were in the URL.
