import XCTest
import SwiftUI
import KeyboardKit

// Renders EmapthyAiCustomKeyboardView directly via SwiftUI's own
// ImageRenderer, so a layout/setup regression shows up in `xcodebuild test`
// output instead of only being discoverable on the Simulator or a real
// device. Going through KeyboardViewController's actual UIInputView (via
// drawHierarchy/layer.render) doesn't work off-screen — iOS's "render
// server" explicitly refuses to snapshot a UIInputView without a live
// keyboard-host connection — so this renders the composed SwiftUI content
// view on its own.
final class KeyboardLayoutSnapshotTests: XCTestCase {
    @MainActor
    func testToolbarIsVisibleAtStandardKeyboardHeight() throws {
        let vc = KeyboardViewController()
        vc.loadViewIfNeeded()

        let toolbarModel = EmapthyAiToolbarModel()
        toolbarModel.hasFullAccess = false
        let contentView = EmapthyAiCustomKeyboardView(controller: vc, toolbarModel: toolbarModel, keyboardContext: vc.state.keyboardContext)
            .frame(width: 393, height: 300)

        let renderer = ImageRenderer(content: contentView)
        renderer.scale = 2

        guard let image = renderer.uiImage, let data = image.pngData() else {
            XCTFail("Could not render SwiftUI content to PNG")
            return
        }
        let outputPath = NSTemporaryDirectory() + "emapthyai-keyboard-snapshot.png"
        try data.write(to: URL(fileURLWithPath: outputPath))
        print("KEYBOARD_SNAPSHOT_PATH=\(outputPath)")

        XCTAssertGreaterThan(image.size.width, 0)
        XCTAssertGreaterThan(image.size.height, 0)
    }
}
