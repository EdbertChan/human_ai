import UIKit
import UniformTypeIdentifiers

final class ActionViewController: UIViewController {
    private var flowState = ReviewFlow.createFlow()
    private var pendingResult: RewriteResult?
    private var originalText = ""

    private let cancelButton = UIButton(type: .system)
    private let brandLabel = UILabel()
    private let statusLabel = UILabel()
    private let suggestionLabel = UILabel()
    private let acceptButton = UIButton(type: .system)
    private let keepButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        buildLayout()
        loadInputText()
    }

    // MARK: - Layout (programmatic, mirroring ProcessTextActivity.java's
    // manual-view-construction style — same content shape, ported not
    // copied since UIKit's nav bar is a real OS element here, not a
    // floating dialog title)

    private func buildLayout() {
        let navBar = UIView()
        let navTitle = UILabel()
        navTitle.text = "EmapthyAi"
        navTitle.font = .systemFont(ofSize: 16, weight: .semibold)
        cancelButton.setTitle("Cancel", for: .normal)
        cancelButton.addTarget(self, action: #selector(didTapCancel), for: .touchUpInside)

        navBar.addSubview(cancelButton)
        navBar.addSubview(navTitle)
        cancelButton.translatesAutoresizingMaskIntoConstraints = false
        navTitle.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            cancelButton.leadingAnchor.constraint(equalTo: navBar.leadingAnchor),
            cancelButton.centerYAnchor.constraint(equalTo: navBar.centerYAnchor),
            navTitle.centerXAnchor.constraint(equalTo: navBar.centerXAnchor),
            navTitle.centerYAnchor.constraint(equalTo: navBar.centerYAnchor),
            navBar.heightAnchor.constraint(equalToConstant: 32)
        ])

        brandLabel.text = "EmapthyAi"
        brandLabel.font = .systemFont(ofSize: 15, weight: .bold)
        brandLabel.textColor = EmpathyTokens.colorBrandPrimary

        statusLabel.font = .systemFont(ofSize: 12, weight: .semibold)
        statusLabel.textColor = EmpathyTokens.colorTextSecondary
        statusLabel.numberOfLines = 0

        suggestionLabel.font = .systemFont(ofSize: 15)
        suggestionLabel.textColor = EmpathyTokens.colorTextPrimary
        suggestionLabel.numberOfLines = 0

        configureActionButton(acceptButton, title: "Accept rewrite", background: EmpathyTokens.colorBrandPrimary, titleColor: .white)
        acceptButton.addTarget(self, action: #selector(didTapAccept), for: .touchUpInside)
        acceptButton.isEnabled = false

        configureActionButton(keepButton, title: "Keep original", background: .systemGray5, titleColor: EmpathyTokens.colorTextPrimary)
        keepButton.addTarget(self, action: #selector(didTapKeep), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [
            navBar, brandLabel, statusLabel, suggestionLabel, acceptButton, keepButton
        ])
        stack.axis = .vertical
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12)
        ])
    }

    private func configureActionButton(_ button: UIButton, title: String, background: UIColor, titleColor: UIColor) {
        button.setTitle(title, for: .normal)
        button.setTitleColor(titleColor, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        button.backgroundColor = background
        button.layer.cornerRadius = 10
        button.heightAnchor.constraint(equalToConstant: 46).isActive = true
    }

    // MARK: - Reading the selection

    private func loadInputText() {
        guard
            let item = extensionContext?.inputItems.first as? NSExtensionItem,
            let attachment = item.attachments?.first
        else {
            statusLabel.text = "No text selected."
            return
        }

        let typeIdentifier = UTType.plainText.identifier
        guard attachment.hasItemConformingToTypeIdentifier(typeIdentifier) else {
            statusLabel.text = "No text selected."
            return
        }

        attachment.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { [weak self] data, _ in
            // Convert to a Sendable value here, outside the main-actor
            // closure — `data` itself (NSSecureCoding?) isn't Sendable, so
            // capturing it directly inside DispatchQueue.main.async is a
            // real Swift 6 data race, not just a warning to suppress.
            let text = data as? String
            DispatchQueue.main.async {
                guard let self else { return }
                guard let text else {
                    self.statusLabel.text = "No text selected."
                    return
                }
                self.originalText = text.trimmingCharacters(in: .whitespacesAndNewlines)
                self.startReview()
            }
        }
    }

    private func startReview() {
        guard !originalText.isEmpty else {
            statusLabel.text = "No text selected."
            return
        }
        dispatch(ReviewFlow.Event(type: "SUBMIT_PRESSED"))
    }

    // MARK: - Actions

    @objc private func didTapCancel() {
        extensionContext?.cancelRequest(withError: NSError(domain: "com.nekocatpitalventures.emapthyai.action", code: 0))
    }

    @objc private func didTapAccept() {
        dispatch(ReviewFlow.Event(type: "ACCEPT_PRESSED"))
    }

    @objc private func didTapKeep() {
        dispatch(ReviewFlow.Event(type: "KEEP_ORIGINAL_PRESSED"))
    }

    // MARK: - Same dispatch/runAction shape as every other EmapthyAi surface,
    // sharing review-flow.js's spec (mirrored in ReviewFlow.swift/.java).
    //
    // iOS Action Extensions have no OS-guaranteed way to write text back
    // into the source app the way Android's PROCESS_TEXT result was —
    // completeRequest(returningItems:) exists but is documented as
    // host-app-dependent and inconsistent. SEND_DRAFT therefore always
    // copies to the clipboard, the same fallback already built for
    // ProcessTextActivity's read-only case on Android, rather than
    // assuming in-place replacement will work.

    private func dispatch(_ event: ReviewFlow.Event) {
        let transition = ReviewFlow.transition(flowState, event)
        flowState = transition.state
        for action in transition.actions {
            runAction(action)
        }
    }

    private func runAction(_ action: String) {
        switch action {
        case "CALL_REWRITE_API":
            callRewriteAPI()
        case "SHOW_PREVIEW":
            showResult(flowState.result)
        case "SHOW_NOTICE":
            showError(flowState.notice)
        case "REPLACE_DRAFT":
            pendingResult = flowState.result
        case "SEND_DRAFT":
            finishWithReplacement()
        case "CLOSE_PREVIEW":
            extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        default:
            break
        }
    }

    private func callRewriteAPI() {
        statusLabel.text = "Reviewing…"
        suggestionLabel.text = ""
        acceptButton.isEnabled = false

        let apiURL = RewriteSettings.apiURL()
        let token = RewriteSettings.apiToken()
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let result = try await RewriteAPI.rewrite(baseURL: apiURL, token: token, text: self.originalText)
                self.dispatch(ReviewFlow.Event(type: "REWRITE_SUCCEEDED", result: result))
            } catch {
                self.dispatch(ReviewFlow.Event(type: "REWRITE_FAILED", message: self.describe(error)))
            }
        }
    }

    private func describe(_ error: Error) -> String {
        if case RewriteAPIError.server(let message) = error { return message }
        return error.localizedDescription
    }

    private func showResult(_ result: RewriteResult?) {
        guard let result else { return }
        statusLabel.text = result.acceptable
            ? "Already corporate — you can still accept the normalized version."
            : "Review the suggestion, then accept or keep your original."
        suggestionLabel.text = result.replacement
        acceptButton.isEnabled = true
    }

    private func showError(_ message: String?) {
        statusLabel.text = "Could not review draft"
        suggestionLabel.text = message ?? "Unknown error."
        acceptButton.isEnabled = false
    }

    private func finishWithReplacement() {
        if let result = pendingResult {
            UIPasteboard.general.string = result.replacement
        }
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
