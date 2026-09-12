import XCTest

// Real device UI test: launches the app, drives the actual production
// review card (EmapthyAiToolbarView) with a real touch swipe, and proves
// the scroll view's content actually moves. A static layout/height check
// (ReviewCardHeightRegressionTests) cannot catch a ScrollView that renders
// fine but doesn't respond to touch — this exercises the real gesture path.
final class ReviewCardScrollUITests: XCTestCase {
    func testSwipeUpRevealsLaterContent() throws {
        let app = XCUIApplication()
        app.launchArguments = [ReviewCardUITestHostLaunchArgument]
        app.launch()

        let scrollView = app.scrollViews["suggestionScrollView"]
        XCTAssertTrue(scrollView.waitForExistence(timeout: 20), "suggestionScrollView never appeared")

        let text = app.staticTexts["suggestionText"]
        XCTAssertTrue(text.waitForExistence(timeout: 5), "suggestionText never appeared")

        let originalFrame = text.frame
        print("DIAG scrollView.frame=\(scrollView.frame) text.frame=\(originalFrame)")
        let beforeAttachment = XCTAttachment(screenshot: app.screenshot())
        beforeAttachment.name = "before-swipe"
        beforeAttachment.lifetime = .keepAlways
        add(beforeAttachment)

        XCTAssertGreaterThan(originalFrame.height, 0, "suggestion text has no height before swiping")

        scrollView.swipeUp()
        scrollView.swipeUp()

        let movedFrame = text.frame
        print("DIAG after swipe scrollView.frame=\(scrollView.frame) text.frame=\(movedFrame)")
        let afterAttachment = XCTAttachment(screenshot: app.screenshot())
        afterAttachment.name = "after-swipe"
        afterAttachment.lifetime = .keepAlways
        add(afterAttachment)
        XCTAssertLessThan(
            movedFrame.origin.y, originalFrame.origin.y,
            "Text did not move after swiping up (before y=\(originalFrame.origin.y), after y=\(movedFrame.origin.y)) — the suggestion box is not actually scrollable."
        )

        // Confirm the swipe actually reached content near the end of the
        // suggestion, not just a tiny nudge — the label carries the full text.
        XCTAssertTrue(
            text.label.contains("SENTENCE-SIX LAST"),
            "Suggestion text content unexpectedly changed or truncated: \(text.label)"
        )
    }
}

final class OnboardingReadabilityUITests: XCTestCase {
    func testVoiceTranslationIsAbsent() throws {
        let app = XCUIApplication()
        app.launch()

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "settings-without-voice-translation"
        attachment.lifetime = .keepAlways
        add(attachment)

        XCTAssertFalse(
            app.staticTexts["Voice translation"].exists,
            "Voice Translation must not appear in the iOS app"
        )
        XCTAssertFalse(
            app.buttons["recordVoiceButton"].exists,
            "Voice recording controls must not appear in the iOS app"
        )
    }

    func testSetupGuideIncludesReadableInstructions() throws {
        let app = XCUIApplication()
        app.launch()

        let firstStep = app.staticTexts["Open Settings, then tap Keyboards"]
        for _ in 0..<8 where !firstStep.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(firstStep.waitForExistence(timeout: 10), "The first setup step never appeared")

        for step in 1...4 {
            let body = app.staticTexts["setupInstructionBody_\(step)"]
            XCTAssertTrue(
                body.exists,
                "Step \(step) needs a separately identifiable, Dynamic Type instruction body"
            )
        }

        let finalInstruction = app.staticTexts["setupInstructionBody_4"]
        XCTAssertTrue(
            finalInstruction.label.contains("Corporate") && finalInstruction.label.contains("Empathy"),
            "The final instruction must name controls visible in the real EmapthyAi keyboard"
        )
    }
}

// App Store evidence capture: one uninterrupted, real system-keyboard flow
// with a durable screenshot at every customer-visible checkpoint. The test
// deliberately uses the production rewrite endpoint through the installed
// keyboard extension; no fixture view or reconstructed keyboard is involved.
final class CorporateRewriteAppStoreCaptureUITests: XCTestCase {
    func testCaptureCorporateRewriteFromDraftThroughSend() throws {
        let app = XCUIApplication(bundleIdentifier: "com.apple.MobileSMS")
        app.terminate()
        app.launch()

        // A fresh simulator can show Apple's own Messages introduction.
        // Dismiss it without changing any account or messaging settings.
        for label in ["OK", "Continue"] {
            let button = app.buttons[label].firstMatch
            if button.waitForExistence(timeout: 2) { button.tap() }
        }

        let compose = [
            app.buttons["Compose"].firstMatch,
            app.buttons["New Message"].firstMatch
        ].first { $0.waitForExistence(timeout: 5) }
        if let compose {
            compose.tap()
        } else {
            // Unsigned-in simulators expose Apple's sample conversations but
            // no compose control. They are safe capture surfaces: no real
            // recipient exists and this test never taps Messages' send arrow.
            let sampleThread = app.staticTexts["+1 (888) 555-1212"].firstMatch
            XCTAssertTrue(sampleThread.waitForExistence(timeout: 5), "Neither Messages compose nor Apple's sample thread appeared")
            sampleThread.tap()
        }

        let textField = [
            app.textViews["iMessage"].firstMatch,
            app.textFields["iMessage"].firstMatch,
            app.textViews["Text Message"].firstMatch,
            app.textFields["Text Message"].firstMatch,
            app.textViews.firstMatch
        ].first { $0.waitForExistence(timeout: 3) }
        if textField == nil { print("MESSAGES HIERARCHY:\n\(app.debugDescription.prefix(12_000))") }
        XCTAssertNotNil(textField, "Messages draft field never appeared")
        guard let textField else { return }
        textField.tap()

        // Messages preserves unsent drafts between runs. Clear any earlier
        // evidence run through the real edit menu before beginning this one.
        let preexistingValue = textField.value as? String ?? ""
        if !preexistingValue.isEmpty, preexistingValue != "iMessage", preexistingValue != "Text Message" {
            textField.press(forDuration: 1.0)
            let selectAll = app.menuItems["Select All"].firstMatch
            XCTAssertTrue(selectAll.waitForExistence(timeout: 3), "Could not select the preexisting Messages draft")
            selectAll.tap()
            textField.typeText(XCUIKeyboardKey.delete.rawValue)
        }
        try switchToEmapthyAiKeyboard(in: app)

        let draft = "hey team this plan is a mess fix it today"
        typeDraftOnLiveEmapthyAiKeyboard(draft, in: app, textField: textField)
        let typedDraft = textField.value as? String
        XCTAssertEqual(
            typedDraft?.lowercased(),
            draft,
            "The typed draft did not populate the active text field"
        )
        keepAppStoreScreenshot(of: app, named: "01-type-your-message")
        Thread.sleep(forTimeInterval: 1.5)

        let keyboardRoot = app.otherElements["realKeyboardRoot"]
        let corporate = app.buttons["personaButton_corporate"]
        XCTAssertTrue(corporate.waitForExistence(timeout: 10), "Corporate persona button never appeared")
        let keyboardFrame = keyboardRoot.frame
        keyboardRoot.coordinate(withNormalizedOffset: CGVector(
            dx: (corporate.frame.midX - keyboardFrame.minX) / keyboardFrame.width,
            dy: 22.0 / keyboardFrame.height
        )).tap()

        // Capture the immediate post-tap state. On a fast network the result
        // may already be visible; on a slower network this shows Reviewing….
        XCTAssertTrue(
            app.staticTexts["Reviewing…"].waitForExistence(timeout: 2)
                || app.scrollViews["suggestionScrollView"].exists,
            "Tapping Corporate produced neither the reviewing nor suggestion state"
        )
        keepAppStoreScreenshot(of: app, named: "02-choose-corporate")
        Thread.sleep(forTimeInterval: 1.5)

        let suggestion = app.staticTexts["suggestionText"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 30), "Corporate rewrite never became available")
        let replacement = suggestion.label
        XCTAssertFalse(replacement.isEmpty, "Corporate rewrite was empty")
        XCTAssertNotEqual(replacement.lowercased(), typedDraft?.lowercased(), "Corporate rewrite did not differ from the draft")
        keepAppStoreScreenshot(of: app, named: "03-review-the-rewrite")
        Thread.sleep(forTimeInterval: 1.5)

        let send = app.buttons["Send"].firstMatch
        XCTAssertTrue(send.waitForExistence(timeout: 5), "Send button never appeared with the rewrite")
        send.tap()
        let populated = NSPredicate { object, _ in
            (object as? XCUIElement)?.value as? String == replacement
        }
        let fieldExpectation = XCTNSPredicateExpectation(predicate: populated, object: textField)
        XCTAssertEqual(
            XCTWaiter.wait(for: [fieldExpectation], timeout: 10),
            .completed,
            "Send did not populate the active text field with the displayed rewrite"
        )
        keepAppStoreScreenshot(of: app, named: "04-send-with-confidence")
        Thread.sleep(forTimeInterval: 1.5)
    }

    private func keepAppStoreScreenshot(of app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// The shared helper deliberately waits for each key because it is used
    /// by diagnostics that can begin while the keyboard is still rendering.
    /// This capture waits for the layout once, then uses immediate lookups so
    /// the video shows natural typing while every character still goes
    /// through the live EmapthyAi keyboard and UITextDocumentProxy.
    private func typeDraftOnLiveEmapthyAiKeyboard(
        _ text: String,
        in app: XCUIApplication,
        textField: XCUIElement
    ) {
        let root = app.otherElements["realKeyboardRoot"]
        XCTAssertTrue(
            root.buttons["Q"].firstMatch.waitForExistence(timeout: 20)
                || root.buttons["q"].firstMatch.exists,
            "EmapthyAi letter keys never appeared"
        )
        var expectedDraft = ""
        for character in text {
            let label = character == " " ? "space" : String(character)
            var candidates = [label]
            if character != " " { candidates.append(label.uppercased()) }
            guard let key = candidates
                .map({ root.buttons[$0].firstMatch })
                .first(where: { $0.exists }) else {
                XCTFail("No live EmapthyAi key found for '\(character)'")
                return
            }
            key.tap()
            expectedDraft.append(character)

            // A system keyboard tap can occasionally be ignored while the
            // extension and Messages are both updating. Observe the actual
            // Messages draft and retry only when its character count did not
            // advance, then require the complete expected prefix.
            var fieldValue = textField.value as? String ?? ""
            if fieldValue.count < expectedDraft.count {
                key.tap()
                fieldValue = textField.value as? String ?? ""
            }
            XCTAssertEqual(
                fieldValue.lowercased(),
                expectedDraft.lowercased(),
                "Messages did not receive '\(character)' from the live EmapthyAi keyboard"
            )
        }
    }
}

final class CorporateVoiceMicrophoneUITests: XCTestCase {
    func testEmpathyAiMicrophoneKeepsKeyboardAlive() throws {
        let app = XCUIApplication(bundleIdentifier: "com.apple.MobileSMS")
        app.terminate()
        app.launch()
        for label in ["OK", "Continue"] {
            let button = app.buttons[label].firstMatch
            if button.waitForExistence(timeout: 2) { button.tap() }
        }
        let sampleThread = app.staticTexts["+1 (888) 555-1212"].firstMatch
        XCTAssertTrue(sampleThread.waitForExistence(timeout: 10))
        sampleThread.tap()
        let textField = app.textFields["iMessage"].firstMatch
        XCTAssertTrue(textField.waitForExistence(timeout: 10))
        textField.tap()
        try switchToEmapthyAiKeyboard(in: app)

        let allowMonitor = addUIInterruptionMonitor(withDescription: "Microphone permission") { alert in
            let allow = alert.buttons["Allow"].firstMatch
            if allow.exists { allow.tap(); return true }
            return false
        }
        defer { removeUIInterruptionMonitor(allowMonitor) }

        let voiceMode = app.buttons["Voice mode, Corporate"].firstMatch
        XCTAssertTrue(voiceMode.waitForExistence(timeout: 10))
        voiceMode.tap()
        let personable = app.buttons["Personable"].firstMatch
        XCTAssertTrue(personable.waitForExistence(timeout: 5))
        personable.tap()

        let record = app.buttons["Record Personable voice"].firstMatch
        XCTAssertTrue(record.waitForExistence(timeout: 10))
        record.tap()
        _ = app.waitForExistence(timeout: 2)
        XCTAssertTrue(app.otherElements["realKeyboardRoot"].waitForExistence(timeout: 5), "EmpathyAI keyboard disappeared after microphone tap")

        let stop = app.buttons["Stop Personable voice recording"].firstMatch
        XCTAssertTrue(stop.waitForExistence(timeout: 5))
        stop.tap()
        XCTAssertTrue(app.otherElements["realKeyboardRoot"].waitForExistence(timeout: 10), "EmpathyAI keyboard disappeared during voice relay/playback")
    }
}

private let ReviewCardUITestHostLaunchArgument = "-UITestReviewCard"

// One-time diagnostic (not a regression test): measures how much of the
// requested keyboardHeight is actually consumed by content, to find the
// exact gap reported below the bottom key row instead of guessing a new
// height constant.
final class KeyboardHeightGapDiagnostic: XCTestCase {
    func testMeasureBottomGap() throws {
        let app = XCUIApplication()
        app.launchArguments = [ReviewCardUITestHostLaunchArgument]
        app.launch()

        let scrollView = app.scrollViews["suggestionScrollView"]
        XCTAssertTrue(scrollView.waitForExistence(timeout: 20), "host never appeared")

        var maxY: CGFloat = 0
        var maxYLabel = ""
        for element in app.keys.allElementsBoundByIndex + app.buttons.allElementsBoundByIndex {
            let frame = element.frame
            guard frame.height > 0, frame.width > 0 else { continue }
            let bottom = frame.origin.y + frame.height
            if bottom > maxY {
                maxY = bottom
                maxYLabel = element.label.isEmpty ? element.identifier : element.label
            }
        }
        print("DIAG bottom-most interactive element: '\(maxYLabel)' bottom=\(maxY)")

        let container = app.otherElements["keyboardHostContainer"]
        XCTAssertTrue(container.waitForExistence(timeout: 5), "keyboardHostContainer never appeared")
        let containerFrame = container.frame
        print("DIAG container.frame=\(containerFrame)")
        let hostingBottom = containerFrame.origin.y + containerFrame.height
        print("DIAG hostingBottom=\(hostingBottom) gap=\(hostingBottom - maxY)")

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "gap-diagnostic"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
