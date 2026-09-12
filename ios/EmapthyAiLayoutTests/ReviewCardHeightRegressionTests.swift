import XCTest
import SwiftUI
import KeyboardKit

// Proves the root cause of the "review card collapses, only scrolling
// reveals the rest" bug: the keyboard-based controller has no explicit
// self-sizing height request, so iOS gives it the standard custom-keyboard
// default (documented/commonly measured as ~216pt on non-Pro-Max iPhones in
// portrait) — which is smaller than what the review card actually needs.
final class ReviewCardHeightRegressionTests: XCTestCase {
    // The height iOS gives a custom keyboard extension by default when it
    // does NOT request self-sizing. This is the pre-fix, real-world value —
    // not arbitrary — and matches what the earlier (pre-KeyboardKit) keyboard
    // was ALSO too short at before that first self-sizing fix was added.
    static let defaultUnfixedHeight: CGFloat = 216

    @MainActor
    private func makeReviewingContentView() async throws -> (view: EmapthyAiCustomKeyboardView, controller: KeyboardViewController) {
        let vc = KeyboardViewController()
        vc.loadViewIfNeeded()

        let toolbarModel = EmapthyAiToolbarModel()
        toolbarModel.hasFullAccess = true
        // Force the review-card state with a realistic 3-sentence suggestion,
        // matching what the user actually reported seeing collapse.
        let result = RewriteResult(
            original: "this is garbage and you all need to fix it now",
            replacement: "This isn't meeting expectations and needs attention. Could we prioritize a fix? I'd like to understand the root cause so it doesn't happen again.",
            acceptable: false
        )
        toolbarModel.update(ReviewFlow.State(status: .reviewing, result: result, notice: nil))

        let contentView = EmapthyAiCustomKeyboardView(controller: vc, toolbarModel: toolbarModel, keyboardContext: vc.state.keyboardContext)
        return (contentView, vc)
    }

    /// Renders at a generous, effectively-unconstrained height to measure
    /// the content's real natural size — this tells us what height the fix
    /// actually needs to request, instead of guessing.
    @MainActor
    func testMeasureNaturalHeight() async throws {
        let (contentView, controller) = try await makeReviewingContentView()
        _ = controller
        let hosting = UIHostingController(rootView: contentView.frame(width: 393))
        hosting.view.frame = CGRect(x: 0, y: 0, width: 393, height: 1000)
        hosting.view.layoutIfNeeded()
        let natural = hosting.view.systemLayoutSizeFitting(
            CGSize(width: 393, height: UIView.layoutFittingCompressedSize.height),
            withHorizontalFittingPriority: .required,
            verticalFittingPriority: .fittingSizeLevel
        )
        print("MEASURED_NATURAL_HEIGHT=\(natural.height)")
        XCTAssertGreaterThan(natural.height, 0)
    }

    /// THE REPRO: renders the real production view at the documented
    /// pre-fix default height and proves the content is taller than the
    /// space it's given — i.e. it WILL be clipped/compressed, exactly
    /// matching the reported "collapses to one line" symptom.
    @MainActor
    func testContentOverflowsAtUnfixedDefaultHeight() async throws {
        let (contentView, controller) = try await makeReviewingContentView()
        XCTAssertEqual(controller.inputView?.allowsSelfSizing, true, "Controller must request self-sizing or iOS gives it the too-small default height.")
        let heightConstraint = controller.view.constraints.first { $0.firstAttribute == .height && $0.firstItem === controller.view }
        // Heights are dynamic per state: a fresh controller pins the compact
        // idle height; the expanded height is applied on entering reviewing.
        XCTAssertEqual(heightConstraint?.constant, KeyboardViewController.initialKeyboardHeightForTesting, "Controller must pin an explicit height constraint.")
        let constrainedHeight = Self.defaultUnfixedHeight

        let renderer = ImageRenderer(content: contentView.frame(width: 393, height: constrainedHeight))
        renderer.scale = 2
        guard let image = renderer.uiImage, let data = image.pngData() else {
            XCTFail("Could not render SwiftUI content to PNG")
            return
        }
        // NSTemporaryDirectory() lives inside the simulator's per-run app
        // container and is gone by the time `xcodebuild test` exits, so
        // write somewhere durable on the host instead.
        let outputDir = "/tmp/emapthyai-repro-snapshots"
        try? FileManager.default.createDirectory(atPath: outputDir, withIntermediateDirectories: true)
        let outputPath = outputDir + "/repro-collapsed-review-card.png"
        try data.write(to: URL(fileURLWithPath: outputPath))
        print("REPRO_SNAPSHOT_PATH=\(outputPath)")

        // Measure natural height for the assertions below (same content).
        let hosting = UIHostingController(rootView: contentView.frame(width: 393))
        hosting.view.frame = CGRect(x: 0, y: 0, width: 393, height: 1000)
        hosting.view.layoutIfNeeded()
        let natural = hosting.view.systemLayoutSizeFitting(
            CGSize(width: 393, height: UIView.layoutFittingCompressedSize.height),
            withHorizontalFittingPriority: .required,
            verticalFittingPriority: .fittingSizeLevel
        )
        print("NATURAL_HEIGHT=\(natural.height) CONSTRAINED_HEIGHT=\(constrainedHeight)")

        XCTAssertGreaterThan(
            natural.height, constrainedHeight,
            "Root cause not reproduced: content (\(natural.height)pt) should need MORE space than the unfixed default (\(constrainedHeight)pt) to prove it gets clipped/compressed."
        )

        // AFTER: the real controller now requests self-sizing at a fixed
        // height. Prove that height comfortably fits the same content that
        // just got proven to overflow the unfixed default.
        let fixedRenderer = ImageRenderer(content: contentView.frame(width: 393, height: KeyboardViewController.keyboardHeightForTesting))
        fixedRenderer.scale = 2
        if let fixedImage = fixedRenderer.uiImage, let fixedData = fixedImage.pngData() {
            let fixedPath = outputDir + "/fixed-review-card.png"
            try fixedData.write(to: URL(fileURLWithPath: fixedPath))
            print("FIXED_SNAPSHOT_PATH=\(fixedPath)")
        }
        XCTAssertGreaterThanOrEqual(
            KeyboardViewController.keyboardHeightForTesting, natural.height,
            "Fix height (\(KeyboardViewController.keyboardHeightForTesting)pt) must cover the content's natural need (\(natural.height)pt)."
        )
    }

}
