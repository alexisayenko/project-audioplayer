import SwiftUI

struct PlaylistsView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.space4) {
                Text("Playlists are coming soon.")
                    .font(T.subhead).foregroundStyle(DS.Color.inkMuted)
                    .padding(DS.Space.space4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .dsSlab()
            }
            .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2).padding(.bottom, DS.Space.space4)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            ScreenHeader(title: "Playlists").padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2)
                .background(DS.Color.ground)
        }
        .dsGround()
    }
}
