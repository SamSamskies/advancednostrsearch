# Bugbot rules

## No auto-search on load

URL query params only prefill the form. Search runs on explicit submit (or restoring a recent). Load-time auto-search was removed on purpose.

Do not flag the missing mount `useEffect` that used to call `handleSubmit` when `npub` and `query` were in the URL.
