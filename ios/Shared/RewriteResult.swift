import Foundation

struct RewriteResult {
    let original: String
    let replacement: String
    let acceptable: Bool
    // Server echo of the persona policy that produced the rewrite
    // (e.g. "corporate@v1", "empathy@v1"). Optional with a default so
    // existing three-field constructions keep compiling.
    var policyVersion: String? = nil
}
