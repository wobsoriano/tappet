---
'touchpress': minor
---

Add `device.goBack`, `device.keyboard.type`, `device.clearState`, and `device.clearKeychain`. `goBack` presses the platform gesture on Android and the app's own control on iOS. `keyboard.type` types into whatever holds focus, for a field with nothing to select on. `clearState` discards the app's stored state, then relaunches and waits for the ready gate. `clearKeychain` resets the simulator keychain on iOS, which every app on it shares, and does nothing on Android.
