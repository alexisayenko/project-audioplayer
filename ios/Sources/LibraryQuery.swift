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

    func results(_ songs: [Track], phoneIDs: Set<String>, listening: [String: LibraryListeningEntry]) -> [Track] {
        LibraryMatching.results(songs, search: search, selection: selection,
                                neverListened: neverListened, downloadedOnly: downloadedOnly,
                                phoneIDs: phoneIDs, sort: sort, reversed: reversed, listening: listening)
    }
}
