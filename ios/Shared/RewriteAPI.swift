import Foundation

enum RewriteAPIError: Error {
    case invalidResponse
    case server(String)
}


struct PersonaOption: Codable, Equatable {
    let id: String
    let label: String
    let available: Bool
    let requestable: Bool
}

struct PersonaConfig: Codable, Equatable {
    let personas: [PersonaOption]
    let variant: String
}

struct VoiceRelayResult: Codable, Equatable {
    let persona: String
    let transcript: String
    let replacement: String
    let audio: Data
    let audioContentType: String

    enum CodingKeys: String, CodingKey { case persona, transcript, replacement, audio, audioContentType }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        persona = try container.decode(String.self, forKey: .persona)
        transcript = try container.decode(String.self, forKey: .transcript)
        replacement = try container.decode(String.self, forKey: .replacement)
        let encoded = try container.decode(String.self, forKey: .audio)
        guard let decoded = Data(base64Encoded: encoded) else { throw RewriteAPIError.invalidResponse }
        audio = decoded
        audioContentType = try container.decode(String.self, forKey: .audioContentType)
    }
}

struct VoiceSpeakResult: Codable, Equatable {
    let persona: String
    let audio: Data
    let audioContentType: String

    enum CodingKeys: String, CodingKey { case persona, audio, audioContentType }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        persona = try container.decode(String.self, forKey: .persona)
        let encoded = try container.decode(String.self, forKey: .audio)
        guard let decoded = Data(base64Encoded: encoded), !decoded.isEmpty else { throw RewriteAPIError.invalidResponse }
        audio = decoded
        audioContentType = try container.decode(String.self, forKey: .audioContentType)
    }
}

enum RewriteAPI {
    static func relayVoice(baseURL: String, token: String, distinctID: String, audio: Data, mimeType: String = "audio/mp4", persona: String = "corporate", voiceID: String? = RewriteSettings.voiceID()) async throws -> VoiceRelayResult {
        var request = try makeRequest(baseURL: baseURL, path: "/v1/voice/relay", token: token)
        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = multipartBody(boundary: boundary, distinctID: distinctID, persona: persona, voiceID: voiceID, audio: audio, mimeType: mimeType)
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, data: data, failure: "Voice relay failed")
        return try JSONDecoder().decode(VoiceRelayResult.self, from: data)
    }

    static func createVoice(baseURL: String, token: String, distinctID: String, name: String, audio: Data, mimeType: String = "audio/mp4") async throws -> String {
        var request = try makeRequest(baseURL: baseURL, path: "/v1/voice/sample", token: token)
        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = voiceSampleBody(boundary: boundary, distinctID: distinctID, name: name, audio: audio, mimeType: mimeType)
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, data: data, failure: "Voice setup failed")
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any], let voiceID = json["voiceId"] as? String, !voiceID.isEmpty else { throw RewriteAPIError.invalidResponse }
        return voiceID
    }

    static func speakText(baseURL: String, token: String, distinctID: String, text: String, persona: String, voiceID: String? = RewriteSettings.voiceID()) async throws -> VoiceSpeakResult {
        var request = try makeRequest(baseURL: baseURL, path: "/v1/voice/speak", token: token)
        var body: [String: Any] = ["distinctId": distinctID, "text": text, "persona": persona]
        if let voiceID { body["voiceId"] = voiceID }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, data: data, failure: "Voice playback failed")
        return try JSONDecoder().decode(VoiceSpeakResult.self, from: data)
    }

    static func rewrite(baseURL: String, token: String, text: String, persona: String? = nil, surface: String? = nil, distinctID: String? = nil, conversation: [String] = []) async throws -> RewriteResult {
        var request = try makeRequest(baseURL: baseURL, path: "/v1/rewrite", token: token)
        var body: [String: Any] = ["text": text]
        if let persona { body["persona"] = persona }
        if let surface {
            var context: [String: Any] = ["surface": surface]
            if !conversation.isEmpty { context["conversation"] = conversation }
            body["context"] = context
        }
        if let distinctID { body["distinctId"] = distinctID }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, data: data, failure: "Rewrite failed")
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let original = json["original"] as? String,
              let replacement = json["replacement"] as? String,
              let acceptable = json["acceptable"] as? Bool else { throw RewriteAPIError.invalidResponse }
        return RewriteResult(original: original, replacement: replacement, acceptable: acceptable, policyVersion: json["policyVersion"] as? String)
    }

    static func rewriteStreaming(baseURL: String, token: String, text: String, persona: String? = nil, surface: String? = nil, distinctID: String? = nil, conversation: [String] = [], onPreview: @escaping @Sendable (String) -> Void, onPreviewRevoked: @escaping @Sendable () -> Void) async throws -> RewriteResult {
        var request = try makeRequest(baseURL: baseURL, path: "/v1/rewrite/stream", token: token)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 30
        var body: [String: Any] = ["text": text]
        if let persona { body["persona"] = persona }
        if let surface {
            var context: [String: Any] = ["surface": surface]
            if !conversation.isEmpty { context["conversation"] = conversation }
            body["context"] = context
        }
        if let distinctID { body["distinctId"] = distinctID }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (stream, response) = try await URLSession.shared.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw RewriteAPIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 { RewriteSettings.clearAccountSession() }
            throw RewriteAPIError.server("Rewrite failed (\(http.statusCode))")
        }

        var eventName: String?
        var payload: String?
        var finished: RewriteResult?
        var failure: String?

        func consumeFrame() {
            defer { eventName = nil; payload = nil }
            guard let eventName, let payload, let data = payload.data(using: .utf8) else { return }
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            switch eventName {
            case "partial":
                if let preview = json?["replacement"] as? String { onPreview(preview) }
            case "revoke":
                onPreviewRevoked()
            case "done":
                guard let json,
                      let original = json["original"] as? String,
                      let replacement = json["replacement"] as? String,
                      let acceptable = json["acceptable"] as? Bool else { return }
                finished = RewriteResult(original: original, replacement: replacement, acceptable: acceptable, policyVersion: json["policyVersion"] as? String)
            case "error":
                failure = (json?["message"] as? String) ?? "Rewrite failed."
            default:
                break
            }
        }

        for try await line in stream.lines {
            if line.isEmpty { consumeFrame(); continue }
            if line.hasPrefix("event: ") { eventName = String(line.dropFirst(7)); continue }
            if line.hasPrefix("data: ") { payload = String(line.dropFirst(6)) }
        }
        consumeFrame()

        if let failure { throw RewriteAPIError.server(failure) }
        guard let finished else { throw RewriteAPIError.invalidResponse }
        return finished
    }

    static func fetchPersonas(baseURL: String, distinctID: String, token: String? = nil) async throws -> PersonaConfig {
        var request = try makeRequest(baseURL: baseURL, path: "/v1/personas", token: token ?? RewriteSettings.accountSessionToken() ?? "")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["distinctId": distinctID])
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, data: data, failure: "Persona config failed")
        guard let config = try? JSONDecoder().decode(PersonaConfig.self, from: data) else { throw RewriteAPIError.invalidResponse }
        return config
    }
    static func bindDevice(baseURL: String, token: String, distinctID: String) async throws {
        var request = try makeRequest(baseURL: baseURL, path: "/v1/account/devices", token: token)
        request.httpBody = try JSONSerialization.data(withJSONObject: ["distinctId": distinctID])
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, data: data, failure: "Account linking failed")
    }

    static func sendEvent(baseURL: String, distinctID: String, name: String, properties: [String: Any] = [:]) {
        guard var request = try? makeRequest(baseURL: baseURL, path: "/v1/events", token: "") else { return }
        var body: [String: Any] = ["distinctId": distinctID, "name": name]
        var safe: [String: Any] = [:]
        for (key, value) in properties {
            switch value {
            case let value as String: safe[key] = value
            case let value as Bool: safe[key] = value
            case let value as Double: safe[key] = value
            default: continue
            }
        }
        if !safe.isEmpty { body["properties"] = safe }
        guard let payload = try? JSONSerialization.data(withJSONObject: body) else { return }
        request.httpBody = payload; request.timeoutInterval = 10
        Task.detached(priority: .utility) { _ = try? await URLSession.shared.data(for: request) }
    }

    private static func validate(response: URLResponse, data: Data, failure: String) throws {
        guard let http = response as? HTTPURLResponse else { throw RewriteAPIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 { RewriteSettings.clearAccountSession() }
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw RewriteAPIError.server(json?["message"] as? String ?? "\(failure) (\(http.statusCode))")
        }
    }

    private static func makeRequest(baseURL: String, path: String, token: String) throws -> URLRequest {
        var trimmed = baseURL; while trimmed.hasSuffix("/") { trimmed.removeLast() }
        guard let url = URL(string: trimmed + path) else { throw RewriteAPIError.invalidResponse }
        var request = URLRequest(url: url); request.httpMethod = "POST"; request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return request
    }

    private static func multipartBody(boundary: String, distinctID: String, persona: String, voiceID: String?, audio: Data, mimeType: String) -> Data {
        var body = Data()
        func append(_ string: String) { body.append(Data(string.utf8)) }
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"distinctId\"\r\n\r\n\(distinctID)\r\n")
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"persona\"\r\n\r\n\(persona)\r\n")
        if let voiceID { append("--\(boundary)\r\nContent-Disposition: form-data; name=\"voiceId\"\r\n\r\n\(voiceID)\r\n") }
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"voice.m4a\"\r\nContent-Type: \(mimeType)\r\n\r\n")
        body.append(audio)
        append("\r\n--\(boundary)--\r\n")
        return body
    }

    private static func voiceSampleBody(boundary: String, distinctID: String, name: String, audio: Data, mimeType: String) -> Data {
        var body = Data()
        func append(_ string: String) { body.append(Data(string.utf8)) }
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"distinctId\"\r\n\r\n\(distinctID)\r\n")
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\n\(name)\r\n")
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"voice.m4a\"\r\nContent-Type: \(mimeType)\r\n\r\n")
        body.append(audio)
        append("\r\n--\(boundary)--\r\n")
        return body
    }
}
