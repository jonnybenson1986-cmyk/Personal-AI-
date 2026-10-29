// What kind of device the app is on, for the few places iPhones and iPads need different handling.

/** iPhone, iPad (which reports itself as a Mac with touch), or iPod. */
export const isIOS = () =>
  typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))

/** Opened from the home screen rather than in a browser tab. */
export const isStandalone = () =>
  typeof window !== "undefined" && ((navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches)
