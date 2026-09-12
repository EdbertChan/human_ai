import UIKit

@MainActor
final class SettingsViewController: UIViewController {
    #if DEBUG
    private let testTextView = UITextView()
    private let testPlaceholder = "Type here, then select your text..."
    private var apiURLField: UITextField?
    private var apiTokenField: UITextField?
    private var debugStatusLabel: UILabel?
    #endif

    override func viewDidLoad() {
        super.viewDidLoad()
        overrideUserInterfaceStyle = .light
        view.backgroundColor = .systemBackground
        buildLayout()
    }

    private func buildLayout() {
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor), scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        let stack = UIStackView(); stack.axis = .vertical; stack.spacing = 16; stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 20), stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20), stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -20),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40)
        ])
        let title = scaledLabel(
            "EmapthyAi",
            textStyle: .largeTitle,
            size: 34,
            weight: .bold,
            color: EmpathyTokens.colorTextPrimary
        )
        let subtitle = scaledLabel(
            "See a clear, professional rewrite of your draft before you send it.",
            textStyle: .body,
            size: 17,
            color: EmpathyTokens.colorTextSecondary
        )
        stack.addArrangedSubview(title)
        stack.addArrangedSubview(subtitle)
        #if DEBUG
        let testLabel = UILabel(); testLabel.text = "Test area"; testLabel.font = .systemFont(ofSize: 18, weight: .semibold)
        testTextView.font = .systemFont(ofSize: 15); testTextView.layer.borderColor = EmpathyTokens.colorBorder.cgColor; testTextView.layer.borderWidth = 1; testTextView.layer.cornerRadius = 8
        testTextView.textContainerInset = UIEdgeInsets(top: 10, left: 8, bottom: 10, right: 8); testTextView.heightAnchor.constraint(equalToConstant: 140).isActive = true
        testTextView.text = testPlaceholder; testTextView.textColor = EmpathyTokens.colorTextSecondary; testTextView.delegate = self; testTextView.accessibilityIdentifier = "testTextField"
        stack.addArrangedSubview(testLabel); stack.addArrangedSubview(testTextView); stack.addArrangedSubview(buildDebugSection())
        #endif
        let setupHeader = scaledLabel(
            "Set up your keyboard",
            textStyle: .title2,
            size: 22,
            weight: .bold,
            color: EmpathyTokens.colorTextPrimary
        )
        stack.addArrangedSubview(setupHeader)
        let openSettingsButton = UIButton(type: .system); openSettingsButton.setTitle("Open Settings", for: .normal); styleButton(openSettingsButton, background: EmpathyTokens.colorBrandPrimary, titleColor: .white); openSettingsButton.addTarget(self, action: #selector(didTapOpenSettings), for: .touchUpInside)
        stack.addArrangedSubview(stepCard(
            number: 1,
            title: "Open Settings, then tap Keyboards",
            body: "Tap Open Settings below. On EmapthyAi's Settings page, tap the highlighted Keyboards row.",
            accessory: openSettingsButton
        ))
        stack.addArrangedSubview(stepCard(
            number: 2,
            title: "Turn on EmapthyAi and Allow Full Access",
            body: "Turn on both highlighted switches. Full Access lets EmapthyAi securely process the draft you choose to review.",
            accessory: nil
        ))
        stack.addArrangedSubview(stepCard(
            number: 3,
            title: "Switch to the EmapthyAi keyboard",
            body: "In any app, touch and hold the globe key. Then tap EmapthyAi in the keyboard menu.",
            accessory: nil
        ))
        stack.addArrangedSubview(stepCard(
            number: 4,
            title: "Choose a rewrite style",
            body: "Type your message, then tap Corporate or Empathy above the keys. Review the rewrite before you send it.",
            accessory: nil
        ))
        let shareTip = scaledLabel(
            "Tip: you can also select text in any app, tap Share, and choose EmapthyAi.",
            textStyle: .footnote,
            size: 15,
            color: EmpathyTokens.colorTextSecondary
        )
        stack.addArrangedSubview(shareTip)
    }

    private func stepCard(number: Int, title: String, body: String, accessory: UIView?) -> UIView {
        let card = UIStackView()
        card.axis = .vertical
        card.spacing = 16
        card.isLayoutMarginsRelativeArrangement = true
        card.layoutMargins = UIEdgeInsets(top: 18, left: 18, bottom: 18, right: 18)
        card.backgroundColor = EmpathyTokens.colorSurfaceTint
        card.layer.cornerRadius = 16
        card.layer.borderWidth = 1
        card.layer.borderColor = EmpathyTokens.colorBorder.cgColor

        let badge = UILabel()
        badge.text = "\(number)"
        badge.font = .systemFont(ofSize: 17, weight: .bold)
        badge.textColor = .white
        badge.textAlignment = .center
        badge.backgroundColor = EmpathyTokens.colorBrandPrimary
        badge.layer.cornerRadius = 17
        badge.clipsToBounds = true
        NSLayoutConstraint.activate([
            badge.widthAnchor.constraint(equalToConstant: 34),
            badge.heightAnchor.constraint(equalToConstant: 34)
        ])

        let titleLabel = scaledLabel(title, textStyle: .headline, size: 19, weight: .bold, color: EmpathyTokens.colorTextPrimary)
        let header = UIStackView(arrangedSubviews: [badge, titleLabel])
        header.axis = .horizontal
        header.spacing = 12
        header.alignment = .center

        let bodyLabel = scaledLabel(body, textStyle: .body, size: 17, color: EmpathyTokens.colorTextPrimary)
        bodyLabel.accessibilityIdentifier = "setupInstructionBody_\(number)"

        card.addArrangedSubview(header)
        card.addArrangedSubview(bodyLabel)
        if let accessory { card.addArrangedSubview(accessory) }
        return card
    }

    private func scaledLabel(_ text: String, textStyle: UIFont.TextStyle, size: CGFloat, weight: UIFont.Weight = .regular, color: UIColor) -> UILabel {
        let label = UILabel()
        label.text = text
        label.numberOfLines = 0
        label.textColor = color
        label.font = UIFontMetrics(forTextStyle: textStyle).scaledFont(for: .systemFont(ofSize: size, weight: weight))
        label.adjustsFontForContentSizeCategory = true
        return label
    }

    private func styleButton(_ button: UIButton, background: UIColor, titleColor: UIColor) { button.setTitleColor(titleColor, for: .normal); button.backgroundColor = background; button.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold); button.layer.cornerRadius = 10; button.heightAnchor.constraint(equalToConstant: 46).isActive = true }
    @objc private func didTapOpenSettings() { guard let url = URL(string: UIApplication.openSettingsURLString) else { return }; UIApplication.shared.open(url) }

    #if DEBUG
    private func buildDebugSection() -> UIView { let section = UIStackView(); section.axis = .vertical; section.spacing = 10; let label = UILabel(); label.text = "Debug server settings"; label.font = .systemFont(ofSize: 18, weight: .semibold); let urlField = UITextField(); urlField.borderStyle = .roundedRect; urlField.placeholder = "API URL"; urlField.text = RewriteSettings.apiURL(); urlField.autocapitalizationType = .none; urlField.keyboardType = .URL; let tokenField = UITextField(); tokenField.borderStyle = .roundedRect; tokenField.placeholder = "API token (optional locally)"; tokenField.text = RewriteSettings.apiToken(); tokenField.autocapitalizationType = .none; tokenField.isSecureTextEntry = true; let saveButton = UIButton(type: .system); saveButton.setTitle("Save server settings", for: .normal); styleButton(saveButton, background: .systemGray5, titleColor: EmpathyTokens.colorTextPrimary); saveButton.addTarget(self, action: #selector(didTapSave), for: .touchUpInside); let status = UILabel(); status.font = .systemFont(ofSize: 13); status.textColor = EmpathyTokens.colorTextSecondary; apiURLField = urlField; apiTokenField = tokenField; debugStatusLabel = status; [label, urlField, tokenField, saveButton, status].forEach { section.addArrangedSubview($0) }; return section }
    @objc private func didTapSave() { var url = (apiURLField?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines); while url.hasSuffix("/") { url.removeLast() }; RewriteSettings.save(apiURL: url, apiToken: (apiTokenField?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)); debugStatusLabel?.text = "Saved." }
    #endif
}

#if DEBUG
extension SettingsViewController: UITextViewDelegate { func textViewDidBeginEditing(_ textView: UITextView) { guard textView === testTextView, textView.text == testPlaceholder else { return }; textView.text = ""; textView.textColor = EmpathyTokens.colorTextPrimary }; func textViewDidEndEditing(_ textView: UITextView) { guard textView === testTextView, textView.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }; textView.text = testPlaceholder; textView.textColor = EmpathyTokens.colorTextSecondary } }
#endif
