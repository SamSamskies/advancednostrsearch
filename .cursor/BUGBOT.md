# Bugbot rules

## nostr-zap CDN pin

`index.html` loads `nostr-zap@1.3.2` from jsDelivr (`/dist/main.js` with SRI). That version is published; jsDelivr lists it as `latest`.

Do not flag the script as an unpublished or invalid version. npm.com can still show `1.3.0` while jsDelivr already serves `1.3.2`.
