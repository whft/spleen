import SwiftUI
import WidgetKit

// MARK: - Shared model + App Group reader

/// One row of the session overview the app writes to the shared App Group.
/// Mirrors MobileWidgetSession in packages/ui/src/apps/mobileWidgetSnapshot.ts.
struct WidgetSession: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let unread: Bool
    /// Project label for the session's directory. Optional so snapshots written before this
    /// field existed still decode.
    var project: String?
}

/// The session overview snapshot. Mirrors MobileWidgetSnapshot (same field names) so the
/// JSON the app stores decodes directly.
struct WidgetSnapshot: Codable {
    var runtimeKey: String?
    let attentionCount: Int
    let recentSessions: [WidgetSession]

    static let empty = WidgetSnapshot(runtimeKey: nil, attentionCount: 0, recentSessions: [])
}

enum WidgetStore {
    static let appGroup = "group.com.spleen.app"
    static let snapshotKey = "widgetSnapshot"

    /// Reads the latest snapshot the app persisted. Returns `.empty` when nothing has been
    /// written yet (fresh install / app never foregrounded) so widgets render a clean state.
    static func load() -> WidgetSnapshot {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let json = defaults.string(forKey: snapshotKey),
              let data = json.data(using: .utf8),
              let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data) else {
            return .empty
        }
        return snapshot
    }
}

// MARK: - Deep links (mirror packages/ui/src/apps/deepLinks.ts)

enum WidgetDeepLink {
    static func newSession() -> URL { URL(string: "spleen://new")! }
    static func attention() -> URL { URL(string: "spleen://sessions?filter=attention")! }
    static func status() -> URL { URL(string: "spleen://status")! }
    static func settings() -> URL { URL(string: "spleen://settings")! }
    static func changes() -> URL { URL(string: "spleen://changes")! }
    static func files() -> URL { URL(string: "spleen://view/files")! }
    static func instances() -> URL { URL(string: "spleen://view/instances")! }
    static func session(_ id: String) -> URL {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return URL(string: "spleen://session/\(encoded)") ?? newSession()
    }
}

// MARK: - Timeline provider

struct OverviewEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

struct OverviewProvider: TimelineProvider {
    func placeholder(in context: Context) -> OverviewEntry {
        OverviewEntry(date: Date(), snapshot: .empty)
    }

    func getSnapshot(in context: Context, completion: @escaping (OverviewEntry) -> Void) {
        completion(OverviewEntry(date: Date(), snapshot: WidgetStore.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<OverviewEntry>) -> Void) {
        // The app/NSE reload timelines (WidgetCenter) when the snapshot changes, but with several
        // widgets sharing the app's WidgetKit reload budget iOS can refresh them unevenly and
        // leave one stale. Ask for a periodic refresh too so every widget independently re-reads
        // the shared snapshot and converges to the latest state (budget permitting).
        let entry = OverviewEntry(date: Date(), snapshot: WidgetStore.load())
        let nextRefresh = Date().addingTimeInterval(10 * 60)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

// MARK: - Logo (full Spleen mark drawn from the master SVG)

/// The Spleen mark, drawn from the same 1000-unit paths as
/// docs/brand/source/spleen-app-icon.svg: three interlocking architectural blades
/// filled with `.primary` so Lock Screen and Control Center tint stay readable.
/// Hand-kept copy of the in-app logo in scripts/brand/geometry.mjs: brand:generate does not
/// write it, so update it whenever that drawing changes.
struct SpleenLogoView: View {
    var body: some View {
        Canvas { context, size in
            let scale = min(size.width, size.height) / 1000
            let origin = CGPoint(
                x: (size.width - 1000 * scale) / 2,
                y: (size.height - 1000 * scale) / 2
            )

            func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: origin.x + x * scale, y: origin.y + y * scale)
            }

            var upper = Path()
            upper.move(to: p(326, 172))
            upper.addLine(to: p(748, 172))
            upper.addLine(to: p(678, 286))
            upper.addLine(to: p(386, 286))
            upper.addLine(to: p(358, 314))
            upper.addLine(to: p(358, 371))
            upper.addLine(to: p(246, 342))
            upper.addLine(to: p(246, 252))
            upper.closeSubpath()

            var core = Path()
            core.move(to: p(246, 376))
            core.addLine(to: p(692, 492))
            core.addLine(to: p(754, 554))
            core.addLine(to: p(754, 624))
            core.addLine(to: p(308, 508))
            core.addLine(to: p(246, 446))
            core.closeSubpath()

            var lower = Path()
            lower.move(to: p(674, 828))
            lower.addLine(to: p(252, 828))
            lower.addLine(to: p(322, 714))
            lower.addLine(to: p(614, 714))
            lower.addLine(to: p(642, 686))
            lower.addLine(to: p(642, 629))
            lower.addLine(to: p(754, 658))
            lower.addLine(to: p(754, 748))
            lower.closeSubpath()

            context.fill(upper, with: .color(.primary))
            context.fill(core, with: .color(.primary))
            context.fill(lower, with: .color(.primary))
        }
    }
}
