import Combine
import Foundation

/// Library state survives navigation. Only sort and direction survive a relaunch.
@MainActor
final class LibraryQuery: ObservableObject {
    @Published var search = ""
    @Published var selection: Set<String> = []
    @Published var neverListened = false
    @Published var downloadedOnly = false
    @Published var sort: LibrarySort {
        didSet { defaults.set(sort.rawValue, forKey: "library.sort") }
    }
    @Published var reversed: Bool {
        didSet { defaults.set(reversed, forKey: "library.reversed") }
    }
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        sort = defaults.string(forKey: "library.sort").flatMap(LibrarySort.init(rawValue:)) ?? .newest
        reversed = defaults.bool(forKey: "library.reversed")
    }

    var narrowing: Bool { !search.isEmpty || !selection.isEmpty || neverListened || downloadedOnly }

    func clear() {
        search = ""; selection = []; neverListened = false; downloadedOnly = false
    }

    func choose(_ criterion: LibrarySort) {
        guard criterion != sort else { return }
        sort = criterion; reversed = false
    }

    /// Which data `results` was computed from: the stores count their changes, so equal stamps mean equal inputs.
    struct DataStamp: Equatable {
        var phoneOnly: Bool
        var library: Int
        var listening: Int
    }

    private struct ResultsKey: Equatable {
        var stamp: DataStamp
        var search: String
        var selection: Set<String>
        var neverListened: Bool
        var downloadedOnly: Bool
        var sort: LibrarySort
        var reversed: Bool
    }

    private var memo: (key: ResultsKey, value: [Track])?
    private(set) var computed = 0

    /// `results` for views that ask on every refresh: the filter and sort run again only when the data or the query changed.
    func results(_ songs: @autoclosure () -> [Track], phoneIDs: Set<String>, listening: [String: LibraryListeningEntry],
                 stamp: DataStamp) -> [Track] {
        let key = ResultsKey(stamp: stamp, search: search, selection: selection, neverListened: neverListened,
                             downloadedOnly: downloadedOnly, sort: sort, reversed: reversed)
        if let memo, memo.key == key { return memo.value }
        computed += 1
        let value = results(songs(), phoneIDs: phoneIDs, listening: listening)
        memo = (key, value)
        return value
    }

    func results(_ songs: [Track], phoneIDs: Set<String>, listening: [String: LibraryListeningEntry]) -> [Track] {
        let matches = LibraryMatching.filtered(songs, search: search, selection: selection,
                                               neverListened: neverListened, downloadedOnly: downloadedOnly,
                                               phoneIDs: phoneIDs, listening: listening)
        return LibraryMatching.sorted(matches, sort: sort, reversed: reversed, listening: listening)
    }
}
