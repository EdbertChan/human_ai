import XCTest

// Native-parity autocorrect check against the real, system-hosted EmapthyAi
// extension: typing a misspelling and then space must replace the word the
// way Apple's own keyboard does. KeyboardKit only applies an autocorrection
// when its autocomplete service has published an
// autocorrect suggestion — with a failed/absent license the keyboard still
// types fine but silently never corrects, so this test is the one signal
// that the whole chain (license -> LocalAutocompleteService -> suggestion ->
// apply-on-space) is alive on a real device.
final class RealKeyboardAutocorrectUITest: XCTestCase {
    func testMisspelledWordAutocorrectsOnSpace() throws {
        let app = XCUIApplication()
        app.terminate()
        app.launch()

        let textField = app.textViews["testTextField"]
        XCTAssertTrue(textField.waitForExistence(timeout: 10), "test text field never appeared")
        textField.tap()

        try switchToEmapthyAiKeyboard(in: app)

        typeOnRealKeyboard("teh", in: app)

        let root = app.otherElements["realKeyboardRoot"]
        print("DIAG live action handler: \(String(describing: root.value))")

        // Distinguishes "autocorrect not applied" from "no suggestions at
        // all" (dead autocomplete service, e.g. license validation failed):
        // KeyboardKit's toolbar shows suggestion candidates as tappable text.
        var sawAnySuggestion = false
        for label in ["the", "The", "teh", "Teh", "\u{201C}teh\u{201D}", "\u{201C}Teh\u{201D}"] {
            for query in [app.buttons[label].firstMatch, app.staticTexts[label].firstMatch] {
                if query.exists {
                    sawAnySuggestion = true
                    print("DIAG suggestion candidate visible: '\(label)'")
                }
            }
        }
        print("DIAG sawAnySuggestion=\(sawAnySuggestion)")

        XCTAssertTrue(tapRealKey(" ", in: app), "space key not found on the live keyboard")

        let value = (textField.value as? String ?? "").lowercased()
        print("DIAG field value after typing 'teh<space>': '\(value)'")
        print("DIAG trace after space: \(String(describing: root.value))")
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "autocorrect-after-space"
        attachment.lifetime = .keepAlways
        add(attachment)

        XCTAssertEqual(
            value, "the ",
            sawAnySuggestion
                ? "Suggestions were shown but the autocorrection was not applied on space"
                : "No suggestions appeared at all — autocomplete service looks dead (check KeyboardKit license validation in the extension log)"
        )

        // Apple parity part 2: one backspace right after the correction must
        // revert to the typed word (space consumed too), and the next space
        // must NOT re-correct it.
        var tappedBackspace = false
        for label in ["delete", "Delete", "backspace", "Backspace", "\u{232B}"] where tapRealKey(label, in: app) {
            tappedBackspace = true
            break
        }
        XCTAssertTrue(tappedBackspace, "backspace key not found on the live keyboard")

        let afterRevert = (textField.value as? String ?? "").lowercased()
        print("DIAG trace after backspace: \(String(describing: root.value))")
        print("DIAG field value after backspace: '\(afterRevert)'")
        XCTAssertEqual(afterRevert, "teh", "One backspace after an autocorrection should revert to the typed word like the native keyboard")

        XCTAssertTrue(tapRealKey(" ", in: app), "space key not found on the live keyboard")
        let afterSecondSpace = (textField.value as? String ?? "").lowercased()
        print("DIAG field value after post-revert space: '\(afterSecondSpace)'")
        XCTAssertEqual(afterSecondSpace, "teh ", "Space right after a revert must keep the reverted word instead of re-correcting it")
    }
}
