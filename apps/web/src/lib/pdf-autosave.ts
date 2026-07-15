/**
 * Decides whether the PDF export dialog may fire its silent auto-save (a
 * synthetic `anchor.click()`) the moment the blob lands, or whether it should
 * skip straight to the ready phase and let a real Save tap carry the download.
 *
 * iOS/iPadOS Safari swallows a programmatic download unless the page still
 * holds transient activation — and a multi-second server render usually
 * outlives the tap that opened the dialog. So on iOS we only auto-save while a
 * gesture is provably still live; otherwise the primary Save button is the one
 * obvious (and gesture-fresh) tap.
 *
 * Desktop is deliberately untouched: those browsers download a fetched blob
 * without any live gesture, so auto-save always fires there — passing this the
 * expired (or absent) `userActivation` state must not change that.
 *
 * @param userActivationActive `navigator.userActivation?.isActive` — `true`/
 *   `false` when the API exists, `undefined` when the browser lacks it.
 * @param isIOSUA whether the user agent is iOS/iPadOS Safari.
 */
export function shouldAutoSave(
  userActivationActive: boolean | undefined,
  isIOSUA: boolean,
): boolean {
  if (!isIOSUA) return true;
  return userActivationActive === true;
}
