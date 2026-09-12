import KeyboardKit

// Restores Apple's revert-on-backspace: on the native keyboard, a single
// backspace immediately after an autocorrection undoes the correction and
// restores what was typed, and the next delimiter doesn't instantly
// re-correct it. KeyboardKit 9.x has no revert path — deleting into a
// corrected word only tells the service to ignore future corrections — so
// the revert is implemented here on top of StandardActionHandler.
final class EmapthyAiActionHandler: KeyboardAction.StandardActionHandler {
    private struct PendingRevert {
        let typed: String
        let corrected: String
        let delimiter: String
    }

    private var pendingRevert: PendingRevert?
    private var correctionAppliedInCurrentHandle = false

    // One-shot and in-memory on purpose: Apple re-corrects the same word the
    // next time it's typed (until repeated reverts teach it), so a reverted
    // word only suppresses the single delimiter press that follows the
    // revert. Using autocompleteService.ignoreWord here instead would
    // permanently stop correcting that word.
    private var oneShotSuppressedWords: Set<String> = []

    /// DEBUG-only breadcrumb sink so on-device UI tests can observe the
    /// revert flow through the accessibility tree.
    var debugTrace: ((String) -> Void)?

    override func handle(
        _ gesture: Keyboard.Gesture,
        on action: KeyboardAction,
        replaced: Bool
    ) {
        if gesture == .press, action == .backspace, let revert = pendingRevert {
            pendingRevert = nil
            debugTrace?("revert-attempt")
            if revertAutocorrection(revert, for: gesture, on: action) { return }
            debugTrace?("revert-suffix-miss")
        }
        correctionAppliedInCurrentHandle = false
        super.handle(gesture, on: action, replaced: replaced)
        // Only a gesture that actually performs something can invalidate a
        // pending revert: touch lifecycle noise (a trailing .end after the
        // space release, presses of keys that act on release) has no gesture
        // action and must not wipe the revert window.
        if !correctionAppliedInCurrentHandle,
           pendingRevert != nil,
           self.action(for: gesture, on: action) != nil {
            pendingRevert = nil
            debugTrace?("pending-cleared:\(gesture)")
        }
    }

    override func tryApplyAutocorrectSuggestion(
        before gesture: Keyboard.Gesture,
        on action: KeyboardAction
    ) {
        guard shouldApplyAutocorrectSuggestion(before: gesture, on: action) else {
            return super.tryApplyAutocorrectSuggestion(before: gesture, on: action)
        }
        let typed = keyboardContext.textDocumentProxy.currentWordPreCursorPart
        if let typed, oneShotSuppressedWords.remove(typed) != nil { return }
        // Same gate as super, evaluated on the pre-correction proxy state:
        // reading the proxy after super has replaced the word is unreliable,
        // since UITextDocumentProxy context updates lag insertText.
        if let typed, !typed.isEmpty,
           let suggestion = autocompleteContext.suggestions.first(where: { $0.isAutocorrect }),
           suggestion.text != typed {
            pendingRevert = PendingRevert(
                typed: typed,
                corrected: suggestion.text,
                delimiter: delimiterText(for: action)
            )
            correctionAppliedInCurrentHandle = true
            debugTrace?("pending-set:\(typed)->\(suggestion.text)")
        }
        super.tryApplyAutocorrectSuggestion(before: gesture, on: action)
    }

    /// Returns false when the text before the cursor no longer ends with the
    /// correction (cursor moved, host app changed the text) — the backspace
    /// then falls through to a normal delete instead of corrupting text.
    private func revertAutocorrection(
        _ revert: PendingRevert,
        for gesture: Keyboard.Gesture,
        on action: KeyboardAction
    ) -> Bool {
        let proxy = keyboardContext.textDocumentProxy
        let expectedSuffix = revert.corrected + revert.delimiter
        guard proxy.documentContextBeforeInput?.hasSuffix(expectedSuffix) == true else { return false }
        tryTriggerFeedback(for: gesture, on: action)
        for _ in 0..<expectedSuffix.count {
            proxy.deleteBackward()
        }
        proxy.insertText(revert.typed)
        oneShotSuppressedWords.insert(revert.typed)
        tryPerformAutocomplete(after: gesture, on: action)
        return true
    }

    private func delimiterText(for action: KeyboardAction) -> String {
        switch action {
        case .character(let char): char
        case .space: " "
        case .primary: "\n"
        default: ""
        }
    }
}
