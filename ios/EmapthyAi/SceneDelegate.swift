import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        if ProcessInfo.processInfo.arguments.contains(ReviewCardUITestHostViewController.launchArgument) {
            window.rootViewController = ReviewCardUITestHostViewController()
        } else {
            window.rootViewController = SettingsViewController()
        }
        window.makeKeyAndVisible()
        self.window = window
    }

    // Fires on launch and on every background-to-foreground return, which is
    // exactly "once per foreground activation". Telemetry is fire-and-forget
    // through the server relay (no PostHog SDK) using the shared anonymous
    // App Group identity — never email, Apple ID, device name, or contacts.
    func sceneWillEnterForeground(_ scene: UIScene) {
        let baseURL = RewriteSettings.apiURL()
        let distinctID = RewriteSettings.distinctID()
        RewriteAPI.sendEvent(baseURL: baseURL, distinctID: distinctID, name: "ios_app_opened")
        // keyboard_enabled fires once per install (App Group dedupe shared
        // with the keyboard extension), on the false-to-true transition of
        // "the EmapthyAi keyboard shows up in the active input modes".
        if Self.emapthyAiKeyboardEnabled() && RewriteSettings.markKeyboardEnabledReported() {
            RewriteAPI.sendEvent(baseURL: baseURL, distinctID: distinctID, name: "keyboard_enabled")
        }
    }

    // UITextInputMode doesn't publicly expose extension bundle identifiers;
    // third-party keyboard modes answer a KVC "identifier" containing the
    // extension bundle id. The responds(to:) guard keeps this safe if the
    // shape changes — detection then simply reports false.
    private static func emapthyAiKeyboardEnabled() -> Bool {
        UITextInputMode.activeInputModes.contains { mode in
            guard mode.responds(to: NSSelectorFromString("identifier")),
                  let identifier = mode.value(forKey: "identifier") as? String else { return false }
            return identifier.contains("com.nekocatpitalventures.emapthyai")
        }
    }
}
