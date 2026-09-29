// Where the clip talks to: the site's API base for the pairing call, overridable from the scheme's
// environment (`RPS_API_BASE`) so a sandbox Worker or a local one can stand in for
// games.sweedler.com (docs/design/rps-island.md §8). Nothing else is configurable.
import Foundation

enum Config {
    /// The production site, also the Worker's origin.
    static let productionBase = URL(string: "https://games.sweedler.com")!

    /// `RPS_API_BASE` from the environment when it parses as a URL, else production.
    static var apiBase: URL {
        if let raw = ProcessInfo.processInfo.environment["RPS_API_BASE"], let url = URL(string: raw),
           url.scheme != nil {
            return url
        }
        return productionBase
    }

    /// `POST {apiBase}/api/rps/pair` with `{ "session", "token", "bundle" }` (design §8).
    static var pairURL: URL { apiBase.appending(path: "api/rps/pair") }

    /// How the pairing call retries: five tries, the wait doubling from one second.
    static let pairAttempts = 5
    static let pairFirstRetry: Duration = .seconds(1)
}
