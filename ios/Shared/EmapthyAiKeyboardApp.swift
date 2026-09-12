import KeyboardKitPro

// Shared between the app and keyboard extension targets, per KeyboardKit's
// own Getting-Started guide — both need the same config to set up licensing
// and locales consistently.
extension KeyboardApp {
    static var emapthyAi: KeyboardApp {
        .init(
            name: "EmapthyAi",
            licenseKey: KeyboardKitLicense.key,
            locales: [.english]
        )
    }
}
