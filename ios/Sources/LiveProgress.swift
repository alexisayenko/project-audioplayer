import SwiftUI

/// One row's download percent. It watches the progress board itself, so a tick rebuilds this row and not the list around it.
/// `tracked` says the server link has the song arriving; `fallback` is the percent of a transfer the board does not track.
struct LiveProgress<Content: View>: View {
    @EnvironmentObject private var board: TransferProgress
    let id: String
    let tracked: Bool
    var fallback: Double?
    @ViewBuilder let content: (Double?) -> Content

    var body: some View {
        content(tracked ? board.values[id] ?? 0 : fallback)
    }
}
