import SwiftUI

struct EmapthyAiToolbarView: View {
    @ObservedObject var model: EmapthyAiToolbarModel
    var body: some View {
        Group {
            switch model.state.status {
            case .idle:
                if let acknowledged = model.requestAcknowledgedLabel { acknowledgementRow(acknowledged) }
                else if let prompt = model.requestPrompt { requestRow(prompt) }
                else if model.voiceTranscript != nil { voiceResultCard }
                else if let error = model.voiceError { statusRow(text: error) }
                else if let notice = model.state.notice { statusRow(text: notice) }
                else { idleRow }
            case .rewriting:
                if let preview = model.state.preview, !preview.isEmpty { previewCard(preview) }
                else { statusRow(text: "Reviewing…") }
            case .reviewing, .sending: reviewCard
            }
        }.padding(.horizontal, 6).padding(.vertical, 4)
    }
    private var idleRow: some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                Menu {
                    ForEach(model.personas.filter(\.available), id: \.id) { option in
                        Button {
                            model.selectVoicePersona(option)
                        } label: {
                            if model.voicePersonaID == option.id { Label(option.label, systemImage: "checkmark") }
                            else { Text(option.label) }
                        }
                    }
                } label: {
                    Label(voicePersonaLabel, systemImage: "chevron.down")
                        .font(.system(size: 13, weight: .semibold)).foregroundColor(textPrimary)
                        .padding(.horizontal, 10).padding(.vertical, 10).background(keepButtonGray).cornerRadius(18)
                }.accessibilityIdentifier("voicePersonaMenu").accessibilityLabel("Voice mode, \(voicePersonaLabel)")
                Button("Rewrite") { model.rewriteTapped() }
                    .buttonStyle(EmapthyAiActionButtonStyle(background: brandPrimary, foreground: .white))
                    .accessibilityIdentifier("rewriteButton")
                Button { model.speakTapped() } label: {
                    Label(model.isSpeaking ? "Stop" : "Speak", systemImage: model.isSpeaking ? "stop.fill" : "speaker.wave.2.fill")
                }.buttonStyle(EmapthyAiActionButtonStyle(background: keepButtonGray, foreground: textPrimary))
                    .disabled(model.isRecordingVoice).accessibilityIdentifier("speakDraftButton").accessibilityLabel(model.isSpeaking ? "Stop speaking" : "Speak draft")
            }
            if model.hasFullAccess {
                Button(action: { model.voiceTapped() }) {
                    Label(model.isRecordingVoice ? "Stop voice input" : "Voice input", systemImage: model.isRecordingVoice ? "stop.fill" : "mic.fill")
                }.buttonStyle(EmapthyAiActionButtonStyle(background: model.isRecordingVoice ? .red : keepButtonGray, foreground: model.isRecordingVoice ? .white : textPrimary))
                    .accessibilityLabel(model.isRecordingVoice ? "Stop \(voicePersonaLabel) voice recording" : "Record \(voicePersonaLabel) voice")
                    .accessibilityHint("Tap to record speech input, then tap again to finish")
            } else {
                Text("Enable Full Access in Settings").font(.system(size: 14, weight: .semibold)).foregroundColor(textSecondary).frame(maxWidth: .infinity).padding(.vertical, 10).background(keepButtonGray).cornerRadius(18)
            }
        }.padding(.horizontal, 6).padding(.vertical, 6)
    }
    private var voicePersonaLabel: String { model.personas.first(where: { $0.id == model.voicePersonaID })?.label ?? "Corporate" }
    private func personaButton(_ option: PersonaOption) -> some View { Button(action: { model.personaTapped(option) }) { HStack(spacing: 4) { if !option.available { Image(systemName: "lock.fill").font(.system(size: 10, weight: .semibold)) }; Text(option.label).font(.system(size: 14, weight: .semibold)) }.foregroundColor(option.available ? .white : textSecondary).padding(.horizontal, 14).padding(.vertical, 10) }.background(option.available ? brandPrimary : keepButtonGray).cornerRadius(18).accessibilityLabel(option.available ? "Rewrite with \(option.label)" : "\(option.label) is not available yet").accessibilityIdentifier(option.id == "empathy" ? "empathyRewriteButton" : "personaButton_\(option.id)") }
    private func requestRow(_ option: PersonaOption) -> some View { HStack { Image(systemName: "lock.fill").foregroundColor(brandPrimary); Text("\(option.label) is coming soon").font(.system(size: 12, weight: .semibold)).frame(maxWidth: .infinity, alignment: .leading); Button("Request") { model.confirmPersonaRequest() }.buttonStyle(EmapthyAiActionButtonStyle(background: brandPrimary, foreground: .white)); Button { model.dismissPersonaRequest() } label: { Image(systemName: "xmark") }.accessibilityLabel("Not now") }.padding(10).background(Color.white).cornerRadius(10) }
    private func acknowledgementRow(_ label: String) -> some View { HStack { Image(systemName: "checkmark.circle.fill").foregroundColor(brandPrimary); Text("Request received — thanks for your interest in \(label).").font(.system(size: 12, weight: .semibold)).foregroundColor(textSecondary).lineLimit(1) }.padding(10).background(Color.white).cornerRadius(10) }
    private func previewCard(_ preview: String) -> some View { VStack(alignment: .leading, spacing: 6) { HStack(spacing: 4) { Text("SUGGESTED REWRITE").font(.system(size: 10, weight: .bold)).foregroundColor(brandPrimary); ProgressView().scaleEffect(0.6).frame(width: 12, height: 12) }; ScrollView { Text(preview).font(.system(size: 14)).foregroundColor(textPrimary).frame(maxWidth: .infinity, alignment: .leading).accessibilityIdentifier("suggestionPreviewText") }.frame(maxHeight: 70) }.padding(10).background(Color.white).cornerRadius(10) }
    private func statusRow(text: String) -> some View { Text(text).font(.system(size: 12, weight: .semibold)).foregroundColor(textSecondary).frame(maxWidth: .infinity, alignment: .leading).padding(10).background(Color.white).cornerRadius(10) }
    private var reviewCard: some View { VStack(alignment: .leading, spacing: 6) { if model.state.result?.acceptable == true { Text("Already corporate — you can still send the normalized version.").font(.system(size: 12, weight: .semibold)).foregroundColor(textSecondary) }; Text("SUGGESTED REWRITE").font(.system(size: 10, weight: .bold)).foregroundColor(brandPrimary); ScrollView { Text(model.state.result?.replacement ?? "").font(.system(size: 14)).foregroundColor(textPrimary).frame(maxWidth: .infinity, alignment: .leading).accessibilityIdentifier("suggestionText") }.frame(maxHeight: 70).accessibilityIdentifier("suggestionScrollView"); HStack(spacing: 6) { Button("Send") { model.onAccept?() }.buttonStyle(EmapthyAiActionButtonStyle(background: brandPrimary, foreground: .white)); Button("Cancel") { model.onKeepOriginal?() }.buttonStyle(EmapthyAiActionButtonStyle(background: keepButtonGray, foreground: textPrimary)) }.padding(.top, 6) }.padding(10).background(Color.white).cornerRadius(10) }
    private var voiceResultCard: some View { VStack(alignment: .leading, spacing: 6) {
        Text("VOICE RESULT").font(.system(size: 10, weight: .bold)).foregroundColor(brandPrimary)
        Text("Original").font(.system(size: 10, weight: .bold)).foregroundColor(textSecondary)
        ScrollView { Text(model.voiceTranscript ?? "").font(.system(size: 14)).foregroundColor(textPrimary).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 2).accessibilityIdentifier("voiceTranscript") }.frame(maxWidth: .infinity, minHeight: 70, maxHeight: 110).padding(.horizontal, 8).background(keepButtonGray).cornerRadius(8).accessibilityIdentifier("voiceTranscriptScrollView")
        Text("Rewrite").font(.system(size: 10, weight: .bold)).foregroundColor(textSecondary)
        ScrollView { Text(model.voiceReplacement ?? "").font(.system(size: 14)).foregroundColor(textPrimary).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 2).accessibilityIdentifier("voiceReplacement") }.frame(maxWidth: .infinity, minHeight: 70, maxHeight: 110).padding(.horizontal, 8).background(keepButtonGray).cornerRadius(8).accessibilityIdentifier("voiceReplacementScrollView")
        HStack(spacing: 6) {
            Button("Playback original") { model.playVoiceOriginal() }.buttonStyle(EmapthyAiActionButtonStyle(background: keepButtonGray, foreground: textPrimary)).accessibilityIdentifier("playVoiceOriginalButton")
            Button("Playback rewrite") { model.playVoiceRewrite() }.buttonStyle(EmapthyAiActionButtonStyle(background: keepButtonGray, foreground: textPrimary)).accessibilityIdentifier("playVoiceRewriteButton")
        }
        HStack(spacing: 6) {
            Button("Use original") { model.useVoiceOriginal() }.buttonStyle(EmapthyAiActionButtonStyle(background: keepButtonGray, foreground: textPrimary)).accessibilityIdentifier("useVoiceOriginalButton")
            Button("Use rewrite") { model.useVoiceRewrite() }.buttonStyle(EmapthyAiActionButtonStyle(background: brandPrimary, foreground: .white)).accessibilityIdentifier("useVoiceRewriteButton")
        }
    }.padding(10).background(Color.white).cornerRadius(10).accessibilityIdentifier("voiceResultCard") }
    private var brandPrimary: Color { Color(red: 0.3098, green: 0.2157, blue: 0.7216) }; private var textPrimary: Color { Color(red: 0.1137, green: 0.1098, blue: 0.1137) }; private var textSecondary: Color { Color(red: 0.3569, green: 0.3333, blue: 0.3961) }; private var keepButtonGray: Color { Color(white: 0.92) }
}
private struct EmapthyAiActionButtonStyle: ButtonStyle { let background: Color; let foreground: Color; func makeBody(configuration: Configuration) -> some View { configuration.label.font(.system(size: 14, weight: .semibold)).foregroundColor(foreground).frame(maxWidth: .infinity).padding(.vertical, 10).background(background).cornerRadius(8).opacity(configuration.isPressed ? 0.7 : 1) } }
