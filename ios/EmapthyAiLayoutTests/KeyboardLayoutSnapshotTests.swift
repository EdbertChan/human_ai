import XCTest
import SwiftUI
import KeyboardKitPro

// Renders EmapthyAiCustomKeyboardView directly via SwiftUI's own
// ImageRenderer, so a layout/setup regression shows up in `xcodebuild test`
// output instead of only being discoverable on the Simulator or a real
// device. Going through KeyboardViewController's actual UIInputView (via
// drawHierarchy/layer.render) doesn't work off-screen — iOS's "render
// server" explicitly refuses to snapshot a UIInputView without a live
// keyboard-host connection — so this renders the composed SwiftUI content
// view on its own instead, after waiting for the real controller's
// KeyboardKit Pro setup (network license check) to finish.
final class KeyboardLayoutSnapshotTests: XCTestCase {
    @MainActor
    func testToolbarIsVisibleAtStandardKeyboardHeight() throws {
        let vc = KeyboardViewController()
        let setupDone = expectation(description: "KeyboardKit Pro setup completes")
        var setupResult: Result<License, Error>?
        vc.setupCompletionForTesting = { result in
            setupResult = result
            setupDone.fulfill()
        }
        vc.loadViewIfNeeded()
        wait(for: [setupDone], timeout: 15)

        switch setupResult {
        case .success:
            print("LICENSE_SETUP_RESULT=success")
        case .failure(let error):
            print("LICENSE_SETUP_RESULT=failure error=\(error)")
            XCTFail("KeyboardKit Pro license setup failed: \(error)")
        case nil:
            XCTFail("License setup completion never fired")
        }

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
