import Combine
import UIKit
import AVFoundation
import os.log
import KeyboardKit

// Built on KeyboardKit instead of a hand-rolled UIStackView keyboard.
// EmapthyAiCustomKeyboardView adds our rewrite bar above KeyboardKit's own
// toolbar rather than replacing it.
final class KeyboardViewController: KeyboardInputViewController, @MainActor AVAudioPlayerDelegate {
    private var flowState = ReviewFlow.createFlow()
    private var pendingResult: RewriteResult?
    // Persona chosen by the toolbar button that started the current rewrite
    // (nil = server default, corporate). Set on every submit before the flow
    // dispatch, read once by callRewriteAPI.
    private var pendingPersona: String?
    private let toolbarModel = EmapthyAiToolbarModel()
    // /v1/personas is loaded once per keyboard session; until it answers,
    // the model keeps its locked defaults (Corporate-only).
    private var personaConfigLoaded = false
    private var voiceRecorder: AVAudioRecorder?
    private var voicePlayer: AVAudioPlayer?
    private var pendingVoiceResult: VoiceRelayResult?
    // Only used by EmapthyAiLayoutTests to know when the async KeyboardKit
    // Pro setup (network license check) has actually finished, since a
    // snapshot taken before that races the real render.
    var setupCompletionForTesting: ((Result<License, Error>) -> Void)?

    // iOS gives a custom keyboard extension a default height (~216pt) sized
    // for a plain key layout. Our review card (status text + label +
    // suggestion + Accept/Keep row) needs more than that on top of
    // KeyboardKit's own key rows — without requesting extra height, the
    // system compresses our content instead of the keys, which is what
    // caused it to visibly collapse until scrolled.
    //
    // The height need is NOT the same across states: idle (just the
    // "Rewrite with EmapthyAi" pill) needs far less than reviewing (status
    // text + label + a 70pt-tall suggestion ScrollView + Accept/Keep row).
    // A single fixed height sized for the taller reviewing state left a
    // real, measured ~73pt of dead gray space below the keys in the far
    // more common idle state — confirmed via EmapthyAiUITests.
    // RealKeyboardHeightGapUITest, which switches to the real, live
    // extension (not a test stand-in) and measures the actual system-hosted
    // frame. The height is now updated live via updateKeyboardHeight(for:)
    // whenever the toolbar's status changes, instead of picking one fixed
    // value that's wrong for every state but one.
    // 388 = the prior 332pt compact budget plus the second voice-input row.
    // Re-run EmapthyAiUITests.RealKeyboardIdleClipUITest after changing this
    // toolbar structure; it measures the real system-hosted extension and
    // catches clipped controls and dead space.
    // The original 332pt budget covered the idle persona row's 57pt (37pt
    // buttons + 12pt row padding + 8pt body padding) and
    // KeyboardKit's key area (4 rows + its own toolbar + 4pt stack spacing)
    // measured 275pt. At the old 318 the button tops sat 2.7pt from the
    // keyboard's top edge (should be ~10pt) — the visible "buttons cut off
    // flat" — while the keys were already flush at the bottom (gap 0). If
    // KeyboardKit's row pitch drifts again (54 <-> 56pt has happened),
    // re-run that UI test and retune ALL height constants together.
    private static let compactKeyboardHeight: CGFloat = 388
    // Expanded height verified against the real device via
    // EmapthyAiUITests.ReviewCardScrollUITests, which drives a real swipe
    // inside the actual KeyboardView hierarchy (not just an isolated
    // toolbar) and asserts the scroll view reaches its full 70pt and the
    // content actually moves — a static height/layout check alone can't
    // catch this, since the ScrollView still renders fine at the wrong size.
    // 451 = the 437 derived after removing the instruction line, plus the
    // same +14pt KeyboardKit key-area growth the idle measurement exposed
    // (see compactKeyboardHeight); RealKeyboardHeightGapUITest asserts the
    // suggestion ScrollView still reaches its full 70pt live.
    private static let expandedKeyboardHeight: CGFloat = 451
    static let keyboardHeightForTesting = expandedKeyboardHeight
    // Initial pinned height before any state transition — what a freshly
    // loaded controller's constraint must equal (heights are dynamic; the
    // expanded value is only reached when the flow enters reviewing).
    static let initialKeyboardHeightForTesting = compactKeyboardHeight
    // The locked-persona request prompt (and its transient confirmation)
    // render as a card taller than the idle pill row; without extra height
    // the card's top edge gets clipped flat against the container. Measured
    // against the idle row via ToolbarRequestPromptSnapshotTests.
    private static let promptExtraHeight: CGFloat = 14
    private static let voiceResultExtraHeight: CGFloat = 220
    // The "already corporate/empathetic" notice line only exists when the
    // draft was acceptable; the reviewing height tracks that so the common
    // no-notice card doesn't leave dead gray space below the keys.
    private static let acceptableNoticeHeight: CGFloat = 27

    private var heightConstraint: NSLayoutConstraint?
    private var promptCancellable: AnyCancellable?
    private var voiceResultCancellable: AnyCancellable?
    private var promptVisible = false
    private var voiceResultVisible = false

    override func viewDidLoad() {
        super.viewDidLoad()
        services.actionHandler = EmapthyAiActionHandler(controller: self)
        wireActionHandlerTrace()
        // The prompt/confirmation cards live in the toolbar model, outside
        // the ReviewFlow status that normally drives height — observe them
        // so the keyboard grows while one is on screen.
        promptCancellable = toolbarModel.$requestPrompt
            .combineLatest(toolbarModel.$requestAcknowledgedLabel)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] prompt, acknowledged in
                guard let self else { return }
                self.promptVisible = prompt != nil || acknowledged != nil
                self.updateKeyboardHeight(for: self.flowState.status)
            }
        voiceResultCancellable = toolbarModel.$voiceTranscript
            .receive(on: DispatchQueue.main)
            .sink { [weak self] transcript in
                guard let self else { return }
                self.voiceResultVisible = transcript != nil
                self.updateKeyboardHeight(for: self.flowState.status)
            }
        toolbarModel.onSubmit = { [weak self] persona in
            self?.pendingPersona = persona
            self?.dispatch(ReviewFlow.Event(type: "SUBMIT_PRESSED"))
        }
        toolbarModel.onPersonaTap = { [weak self] option in
            self?.sendProductEvent("persona_tapped", properties: [
                "persona_id": option.id,
                "available": option.available
            ])
        }
        toolbarModel.onPersonaRequest = { [weak self] personaID in
            self?.sendProductEvent("persona_requested", properties: ["persona_id": personaID])
        }
        toolbarModel.onAccept = { [weak self] in
            self?.sendProductEvent("rewrite_sent", properties: ["persona_id": self?.pendingPersona ?? "corporate"])
            self?.dispatch(ReviewFlow.Event(type: "ACCEPT_PRESSED"))
        }
        toolbarModel.onKeepOriginal = { [weak self] in
            self?.sendProductEvent("rewrite_cancelled", properties: ["persona_id": self?.pendingPersona ?? "corporate"])
            self?.dispatch(ReviewFlow.Event(type: "KEEP_ORIGINAL_PRESSED"))
        }
        toolbarModel.onVoiceTap = { [weak self] in self?.toggleVoiceRecording() }
        toolbarModel.onSpeakTap = { [weak self] in self?.speakCurrentDraft() }
        toolbarModel.onVoiceUseOriginal = { [weak self] in
            guard let self else { return }
            self.insertVoiceText(self.pendingVoiceResult?.transcript)
            self.toolbarModel.clearVoiceResult()
        }
        toolbarModel.onVoiceUseRewrite = { [weak self] in
            guard let self else { return }
            self.insertVoiceText(self.pendingVoiceResult?.replacement)
            self.toolbarModel.clearVoiceResult()
        }
        toolbarModel.onVoicePlayOriginal = { [weak self] in self?.playVoiceText(self?.pendingVoiceResult?.transcript) }
        toolbarModel.onVoicePlayRewrite = { [weak self] in self?.playVoiceText(self?.pendingVoiceResult?.replacement) }
        sendProductEvent("keyboard_session_started")
        loadPersonaConfig()
        // hasFullAccess defaults to false and the idle button's text/width
        // depends on it ("Rewrite with EmapthyAi" vs "Enable Full Access in
        // Settings", different lengths). Reading the real value here, before
        // setup(for:) composes the SwiftUI content below, means the toolbar
        // is never first drawn with the wrong default and then visibly
        // resized once corrected — hasFullAccess is a system permission
        // flag, available immediately, not gated on the async license setup.
        refreshFullAccess()
        // So EmapthyAiUITests can find and measure the real, extension-hosted
        // view (not a test stand-in) once it's actually showing as a live
        // system keyboard.
        view.accessibilityIdentifier = "realKeyboardRoot"
        inputView?.allowsSelfSizing = true
        let heightConstraint = view.heightAnchor.constraint(equalToConstant: Self.compactKeyboardHeight)
        // Was priority 999 ("one below required") from an earlier, smaller
        // keyboard, to avoid fighting iOS's own required-priority height
        // constraint when our request was TOO SMALL. That reasoning doesn't
        // hold now that our request is larger — a soft priority means iOS
        // can silently grant MORE than we asked for, leaving unfilled space
        // below our content (reported as "huge gap below the keys"). Making
        // it required forces our exact value; if iOS truly has a competing
        // required constraint, Auto Layout logs a break instead of silently
        // overriding us, which is diagnosable.
        heightConstraint.priority = .required
        heightConstraint.isActive = true
        self.heightConstraint = heightConstraint
        setup(for: .emapthyAi)
        #if DEBUG
        view.accessibilityValue = "handler=\(type(of: services.actionHandler))"
        #endif
        refreshFullAccess()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        refreshFullAccess()
    }

    private func wireActionHandlerTrace() {
        #if DEBUG
        // Read by RealKeyboardAutocorrectUITest through the accessibility
        // tree — a keyboard extension has no other test-observable channel.
        (services.actionHandler as? EmapthyAiActionHandler)?.debugTrace = { [weak self] message in
            self?.view.accessibilityValue = "trace=\(message)"
        }
        #endif
    }

    override func viewWillSetupKeyboardView() {
        setupKeyboardView { [unowned self] controller in
            EmapthyAiCustomKeyboardView(
                controller: controller,
                toolbarModel: self.toolbarModel,
                keyboardContext: controller.state.keyboardContext
            )
        }
    }

    private func refreshFullAccess() {
        let fullAccess = hasFullAccess
        toolbarModel.hasFullAccess = fullAccess
        // keyboard_enabled fires once per install (shared App Group dedupe
        // with the container app), the first time Full Access is observed.
        if fullAccess && RewriteSettings.markKeyboardEnabledReported() {
            sendProductEvent("keyboard_enabled")
        }
    }

    private func loadPersonaConfig() {
        guard !personaConfigLoaded else { return }
        personaConfigLoaded = true
        toolbarModel.beginPersonaLoad()
        let baseURL = RewriteSettings.apiURL()
        let distinctID = RewriteSettings.distinctID()
        Task { @MainActor [weak self] in
            do {
                let config = try await RewriteAPI.fetchPersonas(baseURL: baseURL, distinctID: distinctID)
                self?.toolbarModel.applyPersonaConfig(config)
            } catch {
                // A failed config load is otherwise invisible: the toolbar
                // silently keeps the locked defaults, so log the reason.
                os_log(.error, "Persona config load failed; keeping locked defaults: %{public}@", String(describing: error))
                self?.toolbarModel.failPersonaLoad("Persona config unavailable")
            }
        }
    }

    // Fire-and-forget product telemetry with the shared anonymous identity.
    // Only bounded ids/flags are ever attached — never draft text.
    private func sendProductEvent(_ name: String, properties: [String: Any] = [:]) {
        RewriteAPI.sendEvent(
            baseURL: RewriteSettings.apiURL(),
            distinctID: RewriteSettings.distinctID(),
            name: name,
            properties: properties
        )
    }

    // MARK: - Same dispatch/runAction shape as every other EmapthyAi surface,
    // sharing review-flow.js's spec (mirrored in ReviewFlow.swift/.java)

    private func dispatch(_ event: ReviewFlow.Event) {
        let transition = ReviewFlow.transition(flowState, event)
        flowState = transition.state
        toolbarModel.update(flowState)
        updateKeyboardHeight(for: flowState.status)
        for action in transition.actions {
            runAction(action)
        }
    }

    private func updateKeyboardHeight(for status: ReviewFlow.Status) {
        let target: CGFloat
        switch status {
        case .idle, .rewriting:
            target = Self.compactKeyboardHeight
                + (promptVisible ? Self.promptExtraHeight : 0)
                + (voiceResultVisible ? Self.voiceResultExtraHeight : 0)
        case .reviewing, .sending:
            target = Self.expandedKeyboardHeight
                + (flowState.result?.acceptable == true ? Self.acceptableNoticeHeight : 0)
        }
        guard heightConstraint?.constant != target else { return }
        heightConstraint?.constant = target
        UIView.animate(withDuration: 0.2) {
            self.view.superview?.layoutIfNeeded()
        }
    }

    private func runAction(_ action: String) {
        switch action {
        case "CALL_REWRITE_API":
            callRewriteAPI()
        case "REPLACE_DRAFT":
            pendingResult = flowState.result
        case "SEND_DRAFT":
            sendDraft()
        case "CLOSE_PREVIEW":
            pendingResult = nil
        default:
            break
        }
    }

    // UITextDocumentProxy exposes the draft in two pieces around the cursor.
    // Treat both pieces as the draft; users can tap the toolbar with the
    // cursor anywhere in the message, not only at its end.
    private func currentDraft() -> String {
        (textDocumentProxy.documentContextBeforeInput ?? "")
            + (textDocumentProxy.documentContextAfterInput ?? "")
    }

    private func replaceCurrentDraft(with text: String) {
        let afterCount = (textDocumentProxy.documentContextAfterInput ?? "").count
        if afterCount > 0 { textDocumentProxy.adjustTextPosition(byCharacterOffset: afterCount) }
        let beforeCount = (textDocumentProxy.documentContextBeforeInput ?? "").count
        for _ in 0..<beforeCount { textDocumentProxy.deleteBackward() }
        textDocumentProxy.insertText(text)
    }

    private func callRewriteAPI() {
        let original = currentDraft()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !original.isEmpty else {
            dispatch(ReviewFlow.Event(type: "REWRITE_FAILED", message: "Type a message first."))
            return
        }
        let conversation: [String]
        if toolbarModel.conversationContextEnabled {
            let after = (textDocumentProxy.documentContextAfterInput ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            conversation = [after].filter { !$0.isEmpty }.map { String($0.prefix(500)) }
        } else {
            conversation = []
        }
        let apiURL = RewriteSettings.apiURL()
        let token = RewriteSettings.apiToken()
        let distinctID = RewriteSettings.distinctID()
        Task { @MainActor [weak self] in
            guard let self else { return }
            let personaID = self.pendingPersona ?? "corporate"
            do {
                let result = try await RewriteAPI.rewriteStreaming(
                    baseURL: apiURL,
                    token: token,
                    text: original,
                    persona: self.pendingPersona,
                    surface: "ios_keyboard",
                    distinctID: distinctID,
                    conversation: conversation,
                    onPreview: { [weak self] preview in
                        Task { @MainActor in self?.dispatch(ReviewFlow.Event(type: "REWRITE_PROGRESS", preview: preview)) }
                    },
                    onPreviewRevoked: { [weak self] in
                        Task { @MainActor in self?.dispatch(ReviewFlow.Event(type: "REWRITE_PREVIEW_REVOKED")) }
                    }
                )
                self.sendProductEvent("rewrite_succeeded", properties: ["persona_id": personaID, "context_included": !conversation.isEmpty])
                self.dispatch(ReviewFlow.Event(type: "REWRITE_SUCCEEDED", result: result))
            } catch {
                self.sendProductEvent("rewrite_failed", properties: ["persona_id": personaID])
                self.dispatch(ReviewFlow.Event(type: "REWRITE_FAILED", message: self.describe(error)))
            }
        }
    }

    private func describe(_ error: Error) -> String {
        if case RewriteAPIError.server(let message) = error { return message }
        return error.localizedDescription
    }

    private func toggleVoiceRecording() {
        if voiceRecorder != nil { finishVoiceRecording(); return }
        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
            Task { @MainActor in
                guard let self else { return }
                guard granted else { self.toolbarModel.setVoiceError("Microphone access is required."); return }
                do {
                    let session = AVAudioSession.sharedInstance()
                    try session.setCategory(.record, mode: .spokenAudio, options: [.allowBluetooth])
                    try session.setActive(true)
                    let url = FileManager.default.temporaryDirectory.appendingPathComponent("voice-\(UUID().uuidString).m4a")
                    let recorder = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44_100, AVNumberOfChannelsKey: 1, AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue])
                    recorder.record()
                    self.voiceRecorder = recorder
                    self.toolbarModel.setRecordingVoice(true)
                } catch { self.toolbarModel.setVoiceError("Could not start recording.") }
            }
        }
    }

    private func finishVoiceRecording() {
        guard let recorder = voiceRecorder else { return }
        recorder.stop()
        voiceRecorder = nil
        toolbarModel.setRecordingVoice(false)
        let url = recorder.url
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let result = try await RewriteAPI.relayVoice(baseURL: RewriteSettings.apiURL(), token: RewriteSettings.apiToken(), distinctID: RewriteSettings.distinctID(), audio: Data(contentsOf: url), mimeType: "audio/mp4", persona: self.toolbarModel.voicePersonaID)
                self.pendingVoiceResult = result
                self.toolbarModel.setVoiceResult(transcript: result.transcript, replacement: result.replacement)
                try self.playVoiceAudio(result.audio)
            } catch { self.toolbarModel.setVoiceError(self.describe(error)) }
            try? FileManager.default.removeItem(at: url)
        }
    }

    private func playVoiceText(_ text: String?) {
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        toolbarModel.setSpeaking(true)
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let result = try await RewriteAPI.speakText(baseURL: RewriteSettings.apiURL(), token: RewriteSettings.apiToken(), distinctID: RewriteSettings.distinctID(), text: text, persona: self.toolbarModel.voicePersonaID)
                try self.playVoiceAudio(result.audio)
            } catch {
                self.toolbarModel.setVoiceError(self.describe(error))
                self.toolbarModel.setSpeaking(false)
            }
        }
    }

    private func playVoiceAudio(_ audio: Data) throws {
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try AVAudioSession.sharedInstance().setActive(true)
        voicePlayer = try AVAudioPlayer(data: audio)
        voicePlayer?.delegate = self
        voicePlayer?.play()
    }

    private func insertVoiceText(_ text: String?) {
        guard let text, !text.isEmpty else { return }
        replaceCurrentDraft(with: text)
    }

    private func speakCurrentDraft() {
        if voicePlayer?.isPlaying == true { voicePlayer?.stop(); toolbarModel.setSpeaking(false); return }
        let text = currentDraft().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { toolbarModel.setVoiceError("Type a message first."); return }
        toolbarModel.setSpeaking(true)
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let result = try await RewriteAPI.speakText(baseURL: RewriteSettings.apiURL(), token: RewriteSettings.apiToken(), distinctID: RewriteSettings.distinctID(), text: text, persona: self.toolbarModel.voicePersonaID)
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playback, mode: .spokenAudio)
                try session.setActive(true)
                self.voicePlayer = try AVAudioPlayer(data: result.audio)
                self.voicePlayer?.delegate = self
                self.voicePlayer?.play()
            } catch {
                self.toolbarModel.setVoiceError(self.describe(error))
                self.toolbarModel.setSpeaking(false)
            }
        }
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        toolbarModel.setSpeaking(false)
    }
    private func sendDraft() {
        guard let result = pendingResult else {
            dispatch(ReviewFlow.Event(type: "SEND_FAILED", message: "The text field is no longer active."))
            return
        }
        replaceCurrentDraft(with: result.replacement)
        dispatch(ReviewFlow.Event(type: "SEND_SUCCEEDED"))
    }
}
