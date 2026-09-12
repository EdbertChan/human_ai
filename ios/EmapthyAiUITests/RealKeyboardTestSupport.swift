import XCTest

// Shared real-device helpers for every test that drives the actual,
// system-hosted EmapthyAi keyboard extension (not a hand-built host).
extension XCTestCase {
    /// Cells come first: Settings frequently has a section header (e.g. the
    /// uppercase "KEYBOARDS" group label) whose accessibility label text
    /// collides with a real, tappable row's label ("Keyboards") — matching
    /// bare staticTexts first previously grabbed the inert header instead
    /// of the actual navigable cell.
    func tapCell(_ app: XCUIApplication, _ label: String, timeout: TimeInterval = 15) throws {
        let candidates = [
            app.cells[label].firstMatch,
            app.buttons[label].firstMatch,
            app.cells.staticTexts[label].firstMatch,
            app.staticTexts[label].firstMatch
        ]
        for _ in 0..<3 {
            for candidate in candidates {
                if candidate.waitForExistence(timeout: timeout / TimeInterval(candidates.count * 3)), candidate.isHittable {
                    candidate.tap()
                    return
                }
            }
            // iOS 26's Settings root puts most rows below the fold; a row
            // that exists but isn't hittable needs scrolling into view.
            app.swipeUp()
        }
        let dump = app.debugDescription
        print("DIAG could not find hittable '\(label)'. Hierarchy dump:\n\(dump.prefix(6000))")
        throw XCTSkip("Could not find tappable element labeled '\(label)' — see DIAG dump in test output")
    }

    /// Idempotent: does nothing if the keyboard is already added with Full
    /// Access, since device state (unlike the app under test) persists
    /// across rebuilds/reinstalls.
    func enableKeyboardWithFullAccessIfNeeded() throws {
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        settings.terminate()
        settings.launch()

        // Settings restores its last-visited pane across launches (even
        // after terminate), so a previous run that died mid-navigation
        // strands the next run on a sub-page where "General" doesn't exist.
        // Pop back to root until General is actually tappable.
        for _ in 0..<6 {
            let general = settings.cells["General"].firstMatch
            if general.exists && general.isHittable { break }
            let back = settings.navigationBars.buttons.firstMatch
            guard back.waitForExistence(timeout: 2), back.isHittable else { break }
            back.tap()
        }

        try tapCell(settings, "General")
        try tapCell(settings, "Keyboard")
        try tapCell(settings, "Keyboards")

        let emapthyAiRow = settings.staticTexts["EmapthyAi"].firstMatch
        if !emapthyAiRow.waitForExistence(timeout: 3) {
            try tapCell(settings, "Add New Keyboard")
            try tapCell(settings, "EmapthyAi")
        }

        try tapCell(settings, "EmapthyAi")

        let fullAccessSwitch = settings.switches["Allow Full Access"].firstMatch
        XCTAssertTrue(fullAccessSwitch.waitForExistence(timeout: 10), "Allow Full Access switch not found")
        if fullAccessSwitch.value as? String == "0" {
            fullAccessSwitch.tap()
            let allowButton = settings.alerts.buttons["Allow"].firstMatch
            if allowButton.waitForExistence(timeout: 5) {
                allowButton.tap()
            }
        }

        settings.terminate()
    }

    /// Cycles the globe key until the live EmapthyAi extension (identified
    /// by its realKeyboardRoot accessibility id) is the frontmost keyboard.
    /// Tries the direct switch first — on a device where the keyboard is
    /// already enabled this avoids the fragile Settings navigation entirely
    /// — and only walks Settings when cycling never reaches EmapthyAi.
    func switchToEmapthyAiKeyboard(in app: XCUIApplication) throws {
        if trySwitchToEmapthyAiKeyboard(in: app) { return }
        try enableKeyboardWithFullAccessIfNeeded()
        app.activate()
        XCTAssertTrue(
            trySwitchToEmapthyAiKeyboard(in: app),
            "Never switched to the EmapthyAi keyboard, even after enabling it in Settings"
        )
    }

    private func trySwitchToEmapthyAiKeyboard(in app: XCUIApplication) -> Bool {
        let systemKeyboard = app.keyboards.element
        _ = systemKeyboard.waitForExistence(timeout: 10)
        if app.otherElements["realKeyboardRoot"].waitForExistence(timeout: 2) { return true }

        // A quick globe tap only toggles between the two most recent
        // keyboards, so cycling can never reach EmapthyAi from e.g. a
        // third-position keyboard. Long-press opens the keyboard menu,
        // which lists every enabled keyboard by name.
        let globeCandidates = [
            app.buttons["Next keyboard"].firstMatch,
            app.keys["Next keyboard"].firstMatch
        ]
        guard let globe = globeCandidates.first(where: { $0.waitForExistence(timeout: 3) }) else {
            return false
        }
        globe.press(forDuration: 1.2)
        let menuRow = [
            app.staticTexts["EmapthyAi"].firstMatch,
            app.buttons["EmapthyAi"].firstMatch
        ].first { $0.waitForExistence(timeout: 3) }
        guard let menuRow else {
            print("DIAG keyboard menu never showed a EmapthyAi row. Hierarchy dump:\n\(app.debugDescription.prefix(6000))")
            return false
        }
        menuRow.tap()
        return app.otherElements["realKeyboardRoot"].waitForExistence(timeout: 10)
    }

    /// Types on the real keyboard's own keys. KeyboardKit renders keys as
    /// plain Buttons (not XCUIElementType.Key), so app.keys never matches —
    /// queries are Button-typed and scoped to our keyboard root. Tries both
    /// cases for each letter, since auto-capitalization changes the label
    /// (sentence start shows "T", not "t").
    func typeOnRealKeyboard(_ text: String, in app: XCUIApplication) {
        let root = app.otherElements["realKeyboardRoot"]
        // The key layout appears asynchronously after the extension loads
        // (license setup + SwiftUI composition); typing immediately after
        // the root view exists races that render.
        if !root.buttons["Q"].firstMatch.waitForExistence(timeout: 20), !root.buttons["q"].firstMatch.exists {
            let dump = app.debugDescription
            print("DIAG no letter keys after 20s. Hierarchy dump:\n\(dump.prefix(8000))")
            XCTFail("Keyboard keys never appeared — see DIAG hierarchy dump")
            return
        }
        for letter in text {
            if !tapRealKey(String(letter), in: app) {
                XCTFail("No key found for '\(letter)' in either case")
                return
            }
        }
    }

    /// Taps one key on the live keyboard by label; returns false when no
    /// matching key exists in either letter case.
    @discardableResult
    func tapRealKey(_ label: String, in app: XCUIApplication) -> Bool {
        let root = app.otherElements["realKeyboardRoot"]
        var labels = [label == " " ? "space" : label]
        if label.count == 1, label != " " {
            labels.append(label == label.lowercased() ? label.uppercased() : label.lowercased())
        }
        for candidate in labels {
            let button = root.buttons[candidate].firstMatch
            if button.waitForExistence(timeout: 2) {
                button.tap()
                return true
            }
        }
        return false
    }
}
