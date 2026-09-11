Electron main process.

Owns the overlay window: transparency, always-on-top, click-through regions,
and content protection (setContentProtection). Screen-share exclusion behaviour
is unverified until spike S1 reports — do not assume it works. Windows and
macOS use different mechanisms.
