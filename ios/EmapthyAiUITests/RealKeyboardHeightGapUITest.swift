import XCTest

// Genuine repro of the "huge gap below the keys" bug: enables the actual
// EmapthyAiKeyboard extension via Settings (the same way a real user
// would), switches to it in a live text field, and measures the REAL
// system-hosted keyboard view's frame vs. the bottom-most key's frame.
//
// Every earlier test in this file hosts EmapthyAiCustomKeyboardView through
// a hand-built UIHostingController, bypassing KeyboardInputViewController's
// real extension lifecycle (viewWillSetupKeyboardView -> setupKeyboardView
// -> KeyboardHostingController.add(to:)) entirely. That earlier host never
// showed the gap. This test goes through the real path, so it's the first
// one actually capable of reproducing (or ruling out) the reported bug.
final class RealKeyboardHeightGapUITest: XCTestCase {
    func testMeasureRealExtensionHeight() throws {
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
        print("DIAG realKeyboardRoot.frame=\(rootFrame)")

        // Query a few specific, known bottom-row keys directly instead of
        // enumerating every element — a live, still-animating keyboard's
        // full element list can go stale mid-enumeration (index-based
        // snapshot access failing), which is exactly what happened on the
        // first attempt here.
        var maxY: CGFloat = 0
        var maxYLabel = ""
        let candidateLabels = ["space", "Return", "return", "Keyboard Type - numeric", "123", "Next keyboard"]
        for label in candidateLabels {
            for element in [app.keys[label], app.buttons[label]] {
                guard element.exists else { continue }
                let frame = element.frame
                guard frame.height > 0, frame.width > 0 else { continue }
                // Exclude elements outside our own keyboard's bounds — a
                // "Next keyboard" match landed far below rootBottom on one
                // run, clearly a leftover/unrelated system element, not one
                // of our own keys.
                guard frame.origin.y >= rootFrame.origin.y, frame.origin.y < rootFrame.origin.y + rootFrame.height else {
                    print("DIAG candidate '\(label)' frame=\(frame) — OUTSIDE keyboard bounds, excluded")
                    continue
                }
                let bottom = frame.origin.y + frame.height
                print("DIAG candidate '\(label)' frame=\(frame)")
                if bottom > maxY {
                    maxY = bottom
                    maxYLabel = label
                }
            }
        }
        let rootBottom = rootFrame.origin.y + rootFrame.height
        print("DIAG bottom-most key in real keyboard: '\(maxYLabel)' bottom=\(maxY) rootBottom=\(rootBottom) gap=\(rootBottom - maxY)")

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "real-keyboard-gap"
        attachment.lifetime = .keepAlways
        add(attachment)

        // Now verify the NEW code path — dynamic resize on state change —
        // actually works live, not just that each hardcoded constant is
        // individually correct. Type real text with the keyboard's own
        // keys, trigger a real rewrite (real network call), and remeasure.
        typeOnRealKeyboard("please fix this now", in: app)
        let rewriteButton = app.buttons["rewriteButton"]
        XCTAssertTrue(rewriteButton.waitForExistence(timeout: 5), "Rewrite button not found")
        // The button's accessibility frame reports a bogus y (≈ -1, far off
        // the keyboard) on iOS 26, so element.tap() fails hit-point
        // computation. Its x/width are sane, and the button sits at the top
        // of the toolbar, so tap the visual spot inside the reliably-framed
        // keyboard root instead.
        let liveRootFrame = root.frame
        let tapPoint = root.coordinate(withNormalizedOffset: CGVector(
            dx: (rewriteButton.frame.midX - liveRootFrame.minX) / liveRootFrame.width,
            dy: 22.0 / liveRootFrame.height
        ))
        tapPoint.tap()

        let suggestionScrollView = app.scrollViews["suggestionScrollView"]
        XCTAssertTrue(suggestionScrollView.waitForExistence(timeout: 30), "Never entered reviewing state (suggestionScrollView never appeared) after tapping Rewrite")

        let expandedRootFrame = root.frame
        print("DIAG expanded realKeyboardRoot.frame=\(expandedRootFrame)")
        print("DIAG expanded suggestionScrollView.frame=\(suggestionScrollView.frame)")

        let expandedAttachment = XCTAttachment(screenshot: app.screenshot())
        expandedAttachment.name = "real-keyboard-expanded"
        expandedAttachment.lifetime = .keepAlways
        add(expandedAttachment)

        // 451 = expandedKeyboardHeight in KeyboardViewController (the UI
        // test target compiles no keyboard sources, so the constant can't be
        // referenced directly) — keep in sync when retuning heights.
        XCTAssertEqual(expandedRootFrame.height, 451, accuracy: 1, "Height did not transition to the expanded value on entering reviewing state")
        XCTAssertEqual(suggestionScrollView.frame.height, 70, accuracy: 1, "Suggestion scroll view did not get its full 70pt after the live resize")
    }
}
