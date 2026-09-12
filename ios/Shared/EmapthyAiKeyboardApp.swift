import KeyboardKit

// Shared between the app and keyboard extension targets so both use the same
// KeyboardKit app configuration and locale set.
extension KeyboardApp {
    static var emapthyAi: KeyboardApp {
        .init(
            name: "EmapthyAi",
            locales: [.english]
        )
    }
}
