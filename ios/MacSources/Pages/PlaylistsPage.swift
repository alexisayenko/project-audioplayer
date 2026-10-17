import SwiftUI

struct PlaylistsPage: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.space5) {
                LibPageHeader(title: "Playlists") { EmptyView() }
                LibCard {
                    Text("Playlists are coming soon.")
                        .font(DS.Font.subhead)
                        .foregroundStyle(DS.Color.inkMuted)
                }
            }
            .padding(DS.Space.space6)
        }
        .background(DS.Color.ground)
        .navigationTitle("Playlists")
    }
}
