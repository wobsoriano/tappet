---
'touchpress': minor
---

Add `device.goBack`, `device.keyboard.type`, and `device.clearState`. `goBack` presses the platform gesture on Android and the app's own control on iOS. `keyboard.type` types into whatever holds focus, for a field with nothing to select on. `clearState` discards the app's stored state, resets the simulator keychain on iOS, then relaunches and waits for the ready gate.
