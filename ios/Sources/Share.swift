import Foundation

enum SongShare {
    static let version = 1
    static let maxT = 86400

    static func isValidID(_ id: String) -> Bool {
        guard (1...80).contains(id.count) else { return false }
        return id.unicodeScalars.allSatisfy { s in
            (s.value >= 48 && s.value <= 57) || (s.value >= 65 && s.value <= 90) || (s.value >= 97 && s.value <= 122)
                || s == "." || s == "_" || s == "-"
        }
    }

    static func clampT(_ t: Double, duration: Double? = nil) -> Int {
        guard t.isFinite, t >= 0 else { return 0 }
        var cap = Double(maxT)
        if let d = duration, d.isFinite, d > 0 { cap = min(cap, max(d.rounded(.down) - 1, 0)) }
        return Int(min(t.rounded(.down), cap))
    }

    static func parseClock(_ text: String) -> Int? {
        let s = text.trimmingCharacters(in: .whitespaces)
        let parts = s.split(separator: ":", omittingEmptySubsequences: false)
        guard (1...3).contains(parts.count) else { return nil }
        for (i, p) in parts.enumerated() {
            guard !p.isEmpty, p.count <= (i == 0 ? 6 : 2), p.allSatisfy({ $0 >= "0" && $0 <= "9" }) else { return nil }
        }
        let nums = parts.compactMap { Int($0) }
        if nums.dropFirst().contains(where: { $0 > 59 }) { return nil }
        return nums.reduce(0) { $0 * 60 + $1 }
    }

    static func formatClock(_ seconds: Double) -> String {
        let s = clampT(seconds)
        let h = s / 3600
        let m = (s % 3600) / 60
        let r = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, r) : String(format: "%d:%02d", m, r)
    }

    static func url(origin: String, id: String, t: Int = 0, duration: Double? = nil) -> String? {
        guard isValidID(id) else { return nil }
        var base = origin.trimmingCharacters(in: .whitespaces)
        while base.hasSuffix("/") { base.removeLast() }
        var query = "v=\(version)"
        let at = clampT(Double(t), duration: duration)
        if at > 0 { query += "&t=\(at)" }
        return "\(base)/#/play/\(id)?\(query)"
    }
}
