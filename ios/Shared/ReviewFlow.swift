import Foundation

// Direct port of apps/chrome-extension/review-flow.js (mirrored in
// apps/android/.../ReviewFlow.java) — same event/action string vocabulary,
// same transition table. This is the fifth independent implementation of
// the identical spec; keep it that way rather than diverging.
enum ReviewFlow {
    enum Status {
        case idle, rewriting, reviewing, sending
    }

    struct State {
        let status: Status
        let result: RewriteResult?
        let notice: String?
        var preview: String? = nil
    }

    struct Event {
        let type: String
        let result: RewriteResult?
        let yolo: Bool
        let message: String?
        let preview: String?

        init(type: String, result: RewriteResult? = nil, yolo: Bool = false, message: String? = nil, preview: String? = nil) {
            self.type = type
            self.result = result
            self.yolo = yolo
            self.message = message
            self.preview = preview
        }
    }

    struct Transition {
        let state: State
        let actions: [String]
    }

    static func createFlow() -> State {
        State(status: .idle, result: nil, notice: nil)
    }

    static func transition(_ state: State, _ event: Event) -> Transition {
        switch event.type {
        case "SUBMIT_PRESSED":
            if state.status != .idle {
                return Transition(state: state, actions: ["PREVENT_DEFAULT"])
            }
            return Transition(
                state: State(status: .rewriting, result: nil, notice: nil),
                actions: ["PREVENT_DEFAULT", "CALL_REWRITE_API"]
            )

        case "REWRITE_PROGRESS":
            if state.status != .rewriting { return unchanged(state) }
            return Transition(
                state: State(status: .rewriting, result: nil, notice: nil, preview: event.preview),
                actions: ["SHOW_PREVIEW_PROGRESS"]
            )

        case "REWRITE_PREVIEW_REVOKED":
            if state.status != .rewriting { return unchanged(state) }
            return Transition(
                state: State(status: .rewriting, result: nil, notice: nil, preview: nil),
                actions: ["CLEAR_PREVIEW_PROGRESS"]
            )

        case "REWRITE_SUCCEEDED":
            if state.status != .rewriting { return unchanged(state) }
            if event.yolo {
                return Transition(
                    state: State(status: .sending, result: event.result, notice: nil),
                    actions: ["REPLACE_DRAFT", "SEND_DRAFT"]
                )
            }
            return Transition(
                state: State(status: .reviewing, result: event.result, notice: nil),
                actions: ["SHOW_PREVIEW"]
            )

        case "REWRITE_FAILED":
            if state.status != .rewriting { return unchanged(state) }
            return Transition(
                state: State(status: .idle, result: nil, notice: event.message),
                actions: ["SHOW_NOTICE"]
            )

        case "ACCEPT_PRESSED":
            if state.status != .reviewing { return unchanged(state) }
            return Transition(
                state: State(status: .sending, result: state.result, notice: state.notice),
                actions: ["REPLACE_DRAFT", "SEND_DRAFT"]
            )

        case "KEEP_ORIGINAL_PRESSED":
            if state.status != .reviewing { return unchanged(state) }
            return Transition(
                state: State(status: .idle, result: nil, notice: nil),
                actions: ["CLOSE_PREVIEW"]
            )

        case "SEND_SUCCEEDED":
            if state.status != .sending { return unchanged(state) }
            return Transition(
                state: State(status: .idle, result: nil, notice: nil),
                actions: ["CLOSE_PREVIEW"]
            )

        case "SEND_FAILED":
            if state.status != .sending { return unchanged(state) }
            return Transition(
                state: State(status: .idle, result: nil, notice: event.message),
                actions: ["SHOW_NOTICE"]
            )

        case "NOTICE_DISMISSED":
            return Transition(
                state: State(status: state.status, result: state.result, notice: nil),
                actions: ["CLEAR_NOTICE"]
            )

        default:
            return unchanged(state)
        }
    }

    private static func unchanged(_ state: State) -> Transition {
        Transition(state: state, actions: [])
    }
}
