import XCTest

// One-off measurement: dumps the NATIVE Apple keyboard's frame and key
// geometry on this device so EmapthyAi's KeyboardKit layout can be matched
// against it. No assertions — read the DIAG lines.
final class NativeKeyboardMeasurementUITest: XCTestCase {
    func testMeasureNativeKeyboard() throws {
        let app = XCUIApplication()
        app.terminate()
        app.launch()

        let textField = app.textViews["testTextField"]
        XCTAssertTrue(textField.waitForExistence(timeout: 10), "test text field never appeared")
        textField.tap()

        let systemKeyboard = app.keyboards.element
        _ = systemKeyboard.waitForExistence(timeout: 10)

        // Switch via the globe long-press menu: a quick globe tap only
        // toggles the two most recent keyboards, so cycling can strand the
        // test on e.g. EmapthyAi <-> Chinese forever. Native English QWERTY
        // exposes letter Key elements; other keyboards don't.
        func onNativeQwerty() -> Bool {
            (app.keys["q"].firstMatch.exists || app.keys["Q"].firstMatch.exists)
                && !app.otherElements["realKeyboardRoot"].exists
        }
        if !onNativeQwerty() {
            let globe = [
                app.buttons["Next keyboard"].firstMatch,
                app.keys["Next keyboard"].firstMatch
            ].first { $0.waitForExistence(timeout: 3) }
            XCTAssertNotNil(globe, "globe key not found")
            globe?.press(forDuration: 1.2)
            let row = [
                app.staticTexts["English (US)"].firstMatch,
                app.buttons["English (US)"].firstMatch,
                app.staticTexts["English"].firstMatch
            ].first { $0.waitForExistence(timeout: 3) }
            XCTAssertNotNil(row, "keyboard menu never showed an English row")
            row?.tap()
            sleep(1)
        }
        XCTAssertTrue(onNativeQwerty(), "never reached the native English QWERTY keyboard")

        print("DIAG native keyboard frame=\(systemKeyboard.frame)")
        for key in app.keys.allElementsBoundByIndex.prefix(40) {
            print("DIAG native key '\(key.label)' frame=\(key.frame)")
        }
        for element in app.otherElements.allElementsBoundByIndex.prefix(40) where element.frame.intersects(systemKeyboard.frame) {
            print("DIAG native other '\(element.identifier)|\(element.label)' frame=\(element.frame)")
        }
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "native-keyboard"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
