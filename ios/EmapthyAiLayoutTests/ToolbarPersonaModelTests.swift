import XCTest

// Persona selection contract for the toolbar: available personas submit a
// rewrite, locked personas only open the honest request-only prompt, and a
// request event fires solely on explicit confirmation. Compiled directly
// against the keyboard sources (same pattern as the other layout tests),
// with no live PostHog or production API involved.
final class ToolbarPersonaModelTests: XCTestCase {
    @MainActor
    private func makeModel() -> EmapthyAiToolbarModel {
        let model = EmapthyAiToolbarModel()
        model.hasFullAccess = true
        return model
    }

    @MainActor
    func testDefaultsAreEmptyUntilServerConfigArrives() {
        let model = makeModel()
        XCTAssertTrue(model.personas.isEmpty)
    }

    @MainActor
    func testCorporateTapSubmitsWithoutPrompt() {
        let model = makeModel()
        var submitted: [String?] = []
        var tapped: [PersonaOption] = []
        model.onSubmit = { submitted.append($0) }
        model.onPersonaTap = { tapped.append($0) }

        model.personaTapped(model.personas[0])

        XCTAssertEqual(submitted, ["corporate"])
        XCTAssertEqual(tapped.map(\.id), ["corporate"])
        XCTAssertNil(model.requestPrompt)
    }

    @MainActor
    func testLockedEmpathyTapPromptsWithoutSubmitting() {
        let model = makeModel()
        var submitted: [String?] = []
        var requested: [String] = []
        var tapped: [PersonaOption] = []
        model.onSubmit = { submitted.append($0) }
        model.onPersonaRequest = { requested.append($0) }
        model.onPersonaTap = { tapped.append($0) }

        model.personaTapped(model.personas[1])

        XCTAssertTrue(submitted.isEmpty)
        XCTAssertTrue(requested.isEmpty)
        XCTAssertEqual(tapped.map(\.id), ["empathy"])
        XCTAssertEqual(model.requestPrompt?.id, "empathy")
    }

    @MainActor
    func testConfirmedRequestEmitsCallbackOnce() {
        let model = makeModel()
        var requested: [String] = []
        model.onPersonaRequest = { requested.append($0) }

        model.personaTapped(model.personas[1])
        model.confirmPersonaRequest()

        XCTAssertEqual(requested, ["empathy"])
        XCTAssertNil(model.requestPrompt)

        // A second confirm without a fresh prompt must be a no-op.
        model.confirmPersonaRequest()
        XCTAssertEqual(requested, ["empathy"])
    }


    @MainActor
    func testConfirmShowsTransientAcknowledgment() {
        let model = makeModel()
        model.onPersonaRequest = { _ in }

        model.personaTapped(model.personas[1])
        XCTAssertNil(model.requestAcknowledgedLabel)
        model.confirmPersonaRequest()
        XCTAssertEqual(model.requestAcknowledgedLabel, "Empathy")

        // Opening a new prompt clears the stale acknowledgment.
        model.personaTapped(model.personas[2])
        XCTAssertNil(model.requestAcknowledgedLabel)
        XCTAssertEqual(model.requestPrompt?.id, "small_talk")
    }
    @MainActor
    func testNotNowDismissesWithoutRequesting() {
        let model = makeModel()
        var requested: [String] = []
        model.onPersonaRequest = { requested.append($0) }

        model.personaTapped(model.personas[1])
        model.dismissPersonaRequest()

        XCTAssertTrue(requested.isEmpty)
        XCTAssertNil(model.requestPrompt)
    }

    @MainActor
    func testServerConfigReplacesOptionsAndFailureFailsClosed() {
        let model = makeModel()
        let unlocked = PersonaConfig(
            personas: [
                PersonaOption(id: "corporate", label: "Corporate", available: true, requestable: false),
                PersonaOption(id: "empathy", label: "Empathy", available: true, requestable: false),
                PersonaOption(id: "small_talk", label: "Small Talk", available: false, requestable: true),
                PersonaOption(id: "warm", label: "Warm", available: false, requestable: true),
                PersonaOption(id: "polite", label: "Polite", available: false, requestable: true)
            ],
            variant: "empathy_available"
        )
        model.beginPersonaLoad()
        XCTAssertTrue(model.personasLoading)
        model.applyPersonaConfig(unlocked)
        XCTAssertFalse(model.personasLoading)
        XCTAssertEqual(model.personas.filter(\.available).map(\.id), ["corporate", "empathy"])

        let fresh = makeModel()
        fresh.beginPersonaLoad()
        fresh.failPersonaLoad("offline")
        XCTAssertTrue(fresh.personas.isEmpty)
        XCTAssertEqual(fresh.personasError, "offline")
    }

    @MainActor
    func testAcceptAndCancelClosuresRetainTheirActions() {
        let model = makeModel()
        var accepted = 0
        var kept = 0
        model.onAccept = { accepted += 1 }
        model.onKeepOriginal = { kept += 1 }

        model.onAccept?()
        model.onKeepOriginal?()

        XCTAssertEqual(accepted, 1)
        XCTAssertEqual(kept, 1)
    }
}
