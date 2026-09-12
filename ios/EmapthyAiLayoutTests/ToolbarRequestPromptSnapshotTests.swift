import XCTest
import SwiftUI

// Renders the locked-persona request prompt and its post-confirm
// acknowledgment via ImageRenderer, so the redesign is visually inspectable
// from `xcodebuild test` output without a device. The toolbar view alone
// needs no KeyboardKit license, unlike the full-keyboard snapshot test.
final class ToolbarRequestPromptSnapshotTests: XCTestCase {
    @MainActor
    private func render(_ model: EmapthyAiToolbarModel, name: String) throws {
        let view = EmapthyAiToolbarView(model: model)
            .frame(width: 393)
            .background(Color(white: 0.85))
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        guard let image = renderer.uiImage, let data = image.pngData() else {
            XCTFail("Could not render \(name) to PNG")
            return
        }
        let outputPath = NSTemporaryDirectory() + "emapthyai-\(name).png"
        try data.write(to: URL(fileURLWithPath: outputPath))
        print("TOOLBAR_SNAPSHOT_PATH=\(outputPath)")
        XCTAssertGreaterThan(image.size.width, 0)
        // image.size is already in points (the renderer's scale only adds
        // pixels); the prompt must stay a compact single row, not balloon
        // the keyboard's idle height budget.
        XCTAssertLessThan(image.size.height, 80)
    }

    @MainActor
    func testRequestPromptRendersCompact() throws {
        let model = EmapthyAiToolbarModel()
        model.hasFullAccess = true
        model.personaTapped(model.personas[1]) // locked Empathy -> prompt
        XCTAssertNotNil(model.requestPrompt)
        try render(model, name: "request-prompt")
    }

    @MainActor
    func testAcknowledgementRendersCompact() throws {
        let model = EmapthyAiToolbarModel()
        model.hasFullAccess = true
        model.personaTapped(model.personas[1])
        model.confirmPersonaRequest()
        XCTAssertEqual(model.requestAcknowledgedLabel, "Empathy")
        try render(model, name: "request-ack")
    }
    @MainActor
    func testIdlePersonaRowRendersUnclipped() throws {
        let model = EmapthyAiToolbarModel()
        model.hasFullAccess = true
        let view = EmapthyAiToolbarView(model: model)
            .frame(width: 393)
            .background(Color(white: 0.85))
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        guard let image = renderer.uiImage, let data = image.pngData() else {
            XCTFail("Could not render idle row to PNG")
            return
        }
        let outputPath = NSTemporaryDirectory() + "emapthyai-idle-personas.png"
        try data.write(to: URL(fileURLWithPath: outputPath))
        // The persona buttons (~38pt) are taller than the 34pt logo circle;
        // a row sized to the circle (54pt total) clipped the buttons flat.
        // fixedSize on the ScrollView makes it 38 + 12 + 8 = ~58pt. Sizes
        // are points; the renderer scale only affects pixels.
        XCTAssertGreaterThanOrEqual(image.size.height, 56)
        XCTAssertLessThan(image.size.height, 80)
    }
}
