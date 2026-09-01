/**
 * Asks the browser where the customer is, and gives up quickly if it cannot say.
 *
 * Location is strictly optional. Most people decline the prompt, and a
 * verification that fails — or hangs — because a permission was refused would
 * be worse than useless: it would teach customers that checking a box is not
 * worth the trouble. So every failure path resolves to `null` and the scan
 * proceeds without coordinates.
 */
const TIMEOUT_MS = 4000;

export function requestPosition() {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    // The browser's own timeout is not always honoured on desktop Safari, so
    // we keep our own. Four seconds is longer than a GPS fix and shorter than
    // a customer's patience.
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        finish({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      () => {
        clearTimeout(timer);
        finish(null);
      },
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: 60_000 }
    );
  });
}
