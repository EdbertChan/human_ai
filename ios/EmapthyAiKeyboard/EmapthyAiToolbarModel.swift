import Foundation
import Combine

@MainActor
final class EmapthyAiToolbarModel: ObservableObject {
    @Published private(set) var state = ReviewFlow.createFlow()
    @Published var hasFullAccess = false
    // The server is the only source of persona availability. Empty is the
    // fail-closed state while loading or after a failed configuration request.
    @Published private(set) var personas: [PersonaOption] = []
    @Published private(set) var personasLoading = false
    @Published private(set) var personasError: String?
    @Published private(set) var requestPrompt: PersonaOption?
    @Published private(set) var requestAcknowledgedLabel: String?
    @Published var conversationContextEnabled: Bool = RewriteSettings.conversationContextEnabled()
    @Published private(set) var isRecordingVoice = false
    @Published private(set) var voiceError: String?
    @Published private(set) var voicePersonaID = "corporate"
    @Published private(set) var isSpeaking = false
    @Published private(set) var voiceTranscript: String?
    @Published private(set) var voiceReplacement: String?

    var onSubmit: ((String?) -> Void)?
    var onAccept: (() -> Void)?
    var onKeepOriginal: (() -> Void)?
    var onPersonaTap: ((PersonaOption) -> Void)?
    var onPersonaRequest: ((String) -> Void)?
    var onVoiceTap: (() -> Void)?
    var onSpeakTap: (() -> Void)?
    var onVoiceUseOriginal: (() -> Void)?
    var onVoiceUseRewrite: (() -> Void)?
    var onVoicePlay: (() -> Void)?

    func update(_ newState: ReviewFlow.State) { state = newState }
    func voiceTapped() { onVoiceTap?() }
    func speakTapped() { onSpeakTap?() }
    func setRecordingVoice(_ recording: Bool) { isRecordingVoice = recording; if recording { voiceError = nil } }
    func setVoiceError(_ message: String) { isRecordingVoice = false; voiceError = message }
    func setSpeaking(_ speaking: Bool) { isSpeaking = speaking; if speaking { voiceError = nil } }
    func setVoiceResult(transcript: String, replacement: String) {
        voiceTranscript = transcript
        voiceReplacement = replacement
        voiceError = nil
    }
    func clearVoiceResult() {
        voiceTranscript = nil
        voiceReplacement = nil
    }
    func useVoiceOriginal() { onVoiceUseOriginal?() }
    func useVoiceRewrite() { onVoiceUseRewrite?() }
    func playVoiceResult() { onVoicePlay?() }
    func beginPersonaLoad() { personasLoading = true; personasError = nil; personas = [] }
    func applyPersonaConfig(_ config: PersonaConfig) {
        personasLoading = false
        personasError = nil
        personas = config.personas
    }
    func failPersonaLoad(_ message: String) {
        personasLoading = false
        personasError = message
        personas = []
        requestPrompt = nil
    }
    func personaTapped(_ option: PersonaOption) {
        guard personas.contains(where: { $0.id == option.id && $0.available == option.available }) else { return }
        onPersonaTap?(option)
        if option.available {
            onSubmit?(option.id)
        } else if option.requestable {
            requestAcknowledgedLabel = nil
            requestPrompt = option
        }
    }
    func selectVoicePersona(_ option: PersonaOption) {
        guard option.available, personas.contains(option) else { return }
        voicePersonaID = option.id
    }
    func toggleConversationContext() {
        conversationContextEnabled.toggle()
        RewriteSettings.saveConversationContextEnabled(conversationContextEnabled)
    }
    func confirmPersonaRequest() {
        guard let option = requestPrompt, option.requestable, !option.available else { return }
        requestPrompt = nil
        onPersonaRequest?(option.id)
        requestAcknowledgedLabel = option.label
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            if self?.requestAcknowledgedLabel == option.label { self?.requestAcknowledgedLabel = nil }
        }
    }
    func dismissPersonaRequest() { requestPrompt = nil }
}
