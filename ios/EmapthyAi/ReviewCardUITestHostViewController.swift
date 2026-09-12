import UIKit
import SwiftUI
import KeyboardKitPro

// Debug-only host for EmapthyAiUITests to drive the real production review
// card with real touch events, since the keyboard extension itself can't be
// launched directly by XCUITest. Only reachable via a launch argument, so it
// has no effect on normal app usage.
//
// Hosts EmapthyAiCustomKeyboardView specifically (not just EmapthyAiToolbarView
// alone) — the real bug lives in how our ScrollView behaves nested inside
// KeyboardKit's real KeyboardView, where KeyboardKit's own key-touch gesture
// handling could plausibly steal the swipe before our ScrollView sees it. A
// test that only hosts the toolbar in isolation wouldn't catch that.
final class ReviewCardUITestHostViewController: UIViewController {
    static let launchArgument = "-UITestReviewCard"
    private var keyboardController: KeyboardViewController?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white

        let controller = KeyboardViewController()
        keyboardController = controller
        // EmapthyAiCustomKeyboardView reads controller.state/services, which
        // KeyboardKit Pro only populates once its async license setup (a
        // real network check) completes — attaching before that either
        // crashes or renders with an empty/invalid state.
        controller.setupCompletionForTesting = { [weak self] _ in
            DispatchQueue.main.async {
                self?.attachContent(controller: controller)
            }
        }
        controller.loadViewIfNeeded()
    }

    private func attachContent(controller: KeyboardViewController) {
        let toolbarModel = EmapthyAiToolbarModel()
        toolbarModel.hasFullAccess = true
        toolbarModel.update(ReviewFlow.State(
            status: .reviewing,
            result: RewriteResult(
                original: "this is garbage and you all need to fix it now",
                replacement: "SENTENCE-ONE this needs attention right away. "
                    + "SENTENCE-TWO could we prioritize a fix for this. "
                    + "SENTENCE-THREE I would like to understand the root cause. "
                    + "SENTENCE-FOUR so it does not happen again next time. "
                    + "SENTENCE-FIVE thank you for looking into it soon. "
                    + "SENTENCE-SIX LAST this is the final visible marker.",
                acceptable: false
            ),
            notice: nil
        ))

        let content = EmapthyAiCustomKeyboardView(controller: controller, toolbarModel: toolbarModel, keyboardContext: controller.state.keyboardContext)
        let hosting = UIHostingController(rootView: content)
        addChild(hosting)
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        hosting.view.accessibilityIdentifier = "keyboardHostContainer"
        view.addSubview(hosting.view)
        NSLayoutConstraint.activate([
            hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            hosting.view.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 40),
            hosting.view.heightAnchor.constraint(equalToConstant: KeyboardViewController.keyboardHeightForTesting)
        ])
        hosting.didMove(toParent: self)
    }
}
