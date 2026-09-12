import SwiftUI
import KeyboardKitPro

// Wraps KeyboardKit's real keyboard (real key layout, real Pro autocomplete)
// and adds our own rewrite bar above KeyboardKit's own toolbar, rather than
// replacing it — `params.view` below is KeyboardKit's default autocomplete
// toolbar, so it stays intact.
struct EmapthyAiCustomKeyboardView: View {
    unowned let controller: KeyboardInputViewController
    @ObservedObject var toolbarModel: EmapthyAiToolbarModel
    // Observed so the patched layout below is recomputed when the context
    // changes (orientation, locale, screen) — the layout: parameter is
    // resolved per body evaluation, not live like the service-based init.
    @ObservedObject var keyboardContext: KeyboardContext

    var body: some View {
        KeyboardView(
            layout: NativeKeyboardMetrics.patchedLayout(
                from: controller.services.layoutService,
                for: keyboardContext
            ),
            state: controller.state,
            services: controller.services,
            buttonContent: { $0.view },
            buttonView: { $0.view },
            collapsedView: { $0.view },
            emojiKeyboard: { $0.view },
            toolbar: { params in
                VStack(spacing: 4) {
                    EmapthyAiToolbarView(model: toolbarModel)
                    params.view
                }
            }
        )
    }
}
