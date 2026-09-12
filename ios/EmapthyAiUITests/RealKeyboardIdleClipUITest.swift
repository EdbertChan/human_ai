import XCTest

// Measures the REAL system-hosted keyboard's idle persona row, the same
// way RealKeyboardHeightGapUITest measures the reviewing state: root frame,
// persona-button frames, and the bottom-most key, so the compact height
// constant can be tuned from observed numbers instead of guesses. Attaches
// a screenshot for pixel-level inspection of the reported button-top clip.
final class RealKeyboardIdleClipUITest: XCTestCase {
    func testMeasureIdlePersonaRow() throws {
        let app = XCUIApplication()
        app.terminate()
        app.launch()

        let textField = app.textViews["testTextField"]
        XCTAssertTrue(textField.waitForExistence(timeout: 10), "test text field never appeared")
        textField.tap()

        try switchToEmapthyAiKeyboard(in: app)

        let root = app.otherElements["realKeyboardRoot"]
        XCTAssertTrue(root.waitForExistence(timeout: 10), "realKeyboardRoot never appeared")
        let rootFrame = root.frame
        print("DIAG idle realKeyboardRoot.frame=\(rootFrame)")

        // Corporate always exists (defaults and every server config).
        let corporate = app.buttons["personaButton_corporate"]
        XCTAssertTrue(corporate.waitForExistence(timeout: 10), "corporate persona button never appeared")
        let corporateFrame = corporate.frame
        print("DIAG corporate.frame=\(corporateFrame)")
        print("DIAG buttonTopInset=\(corporateFrame.minY - rootFrame.minY) buttonHeight=\(corporateFrame.height)")

        let empathy = app.buttons["empathyRewriteButton"]
        if empathy.exists {
            print("DIAG empathy.frame=\(empathy.frame)")
        }

        // Bottom-most key bounds the other side of the height budget: the
        // dead-gray-space check.
        var maxY: CGFloat = 0
        var maxYLabel = ""
        for label in ["space", "Return", "return", "Keyboard Type - numeric", "123", "Next keyboard"] {
            for element in [app.keys[label], app.buttons[label]] {
                guard element.exists else { continue }
                let frame = element.frame
                guard frame.height > 0, frame.width > 0 else { continue }
                guard frame.origin.y >= rootFrame.origin.y, frame.origin.y < rootFrame.maxY else { continue }
                if frame.maxY > maxY {
                    maxY = frame.maxY
                    maxYLabel = label
                }
            }
        }
        print("DIAG idle bottom key '\(maxYLabel)' maxY=\(maxY) rootBottom=\(rootFrame.maxY) bottomGap=\(rootFrame.maxY - maxY)")

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "idle-persona-row-live"
        attachment.lifetime = .keepAlways
        add(attachment)

        XCTAssertGreaterThan(corporateFrame.height, 0)
    }
}
