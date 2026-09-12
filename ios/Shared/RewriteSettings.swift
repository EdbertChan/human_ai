import Foundation
import Security

// The App Group entitlement (group.com.nekocatpitalventures.emapthyai) is
// registered for the app and keyboard targets so both processes share ONE
// anonymous analytics identity (distinctID below) plus the debug-only
// API-URL override. The group must never hold draft text or rewrite
// results. If the suite is unavailable (e.g. provisioning without the App
// Group), everything degrades safely: apiURL()/apiToken() fall through to
// the hardcoded production default, and distinctID() uses a process-local
// UUID for the current run without persisting it anywhere else.
enum RewriteSettings {
    private static let appGroupID = "group.com.nekocatpitalventures.emapthyai"
    private static let apiURLKey = "api_url"
    private static let apiTokenKey = "api_token"
    private static let defaultAPIURL = "http://127.0.0.1:8787"
    private static let distinctIDKey = "distinct_id"
    private static let keyboardEnabledReportedKey = "keyboard_enabled_reported"
    private static let conversationContextEnabledKey = "conversation_context_enabled"
    private static let accountSessionService = "ai.emapthyai.account-session"

    private static let processLocalDistinctID = UUID().uuidString.lowercased()

    static func apiURL() -> String {
        #if DEBUG
        if let saved = sharedDefaults?.string(forKey: apiURLKey), !saved.isEmpty {
            return saved
        }
        if let stamped = Bundle.main.object(forInfoDictionaryKey: "EmapthyAiDevAPIURL") as? String, !stamped.isEmpty {
            return stamped
        }
        #endif
        return defaultAPIURL
    }

    static func apiToken() -> String {
        #if DEBUG
        return sharedDefaults?.string(forKey: apiTokenKey) ?? ""
        #else
        return ""
        #endif
    }

    static func distinctID() -> String {
        guard let defaults = sharedDefaults else { return processLocalDistinctID }
        if let saved = defaults.string(forKey: distinctIDKey), !saved.isEmpty {
            return saved
        }
        let fresh = UUID().uuidString.lowercased()
        defaults.set(fresh, forKey: distinctIDKey)
        return fresh
    }

    static func accountSessionToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: accountSessionService,
            kSecAttrAccount as String: "session",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func saveAccountSessionToken(_ token: String) {
        guard !token.isEmpty, let data = token.data(using: .utf8) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: accountSessionService,
            kSecAttrAccount as String: "session"
        ]
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = data
        SecItemAdd(item as CFDictionary, nil)
    }

    static func clearAccountSession() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: accountSessionService,
            kSecAttrAccount as String: "session"
        ]
        SecItemDelete(query as CFDictionary)
    }

    static func conversationContextEnabled() -> Bool {
        sharedDefaults?.bool(forKey: conversationContextEnabledKey) ?? false
    }

    static func saveConversationContextEnabled(_ enabled: Bool) {
        sharedDefaults?.set(enabled, forKey: conversationContextEnabledKey)
    }

    @MainActor private static var processLocalKeyboardEnabledReported = false
    @MainActor static func markKeyboardEnabledReported() -> Bool {
        guard let defaults = sharedDefaults else {
            if processLocalKeyboardEnabledReported { return false }
            processLocalKeyboardEnabledReported = true
            return true
        }
        if defaults.bool(forKey: keyboardEnabledReportedKey) { return false }
        defaults.set(true, forKey: keyboardEnabledReportedKey)
        return true
    }

    #if DEBUG
    static func save(apiURL: String, apiToken: String) {
        sharedDefaults?.set(apiURL, forKey: apiURLKey)
        sharedDefaults?.set(apiToken, forKey: apiTokenKey)
    }
    #endif

    private static var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: appGroupID)
    }
}
