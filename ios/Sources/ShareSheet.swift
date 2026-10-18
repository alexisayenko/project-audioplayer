import SwiftUI

struct ShareSheet: View {
    let track: Track
    let duration: Double
    @EnvironmentObject private var settings: Settings
    @Environment(\.dismiss) private var dismiss
    @State private var useTime = false
    @State private var clock: String
    @State private var toast: String?
    @State private var copyTick = 0

    init(track: Track, position: Double, duration: Double) {
        self.track = track
        self.duration = duration
        _clock = State(initialValue: SongShare.formatClock(position))
    }

    private var seconds: Int? { useTime ? SongShare.parseClock(clock) : 0 }
    private var clockInvalid: Bool { useTime && seconds == nil }
    private var link: String? {
        guard let seconds else { return nil }
        return SongShare.url(origin: settings.serverURL, id: track.id, t: seconds, duration: duration > 0 ? duration : track.duration)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.space4) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(track.title).font(T.headline).foregroundStyle(DS.Color.ink).lineLimit(2)
                        if !track.artist.isEmpty { Text(track.artist).font(T.subhead).foregroundStyle(DS.Color.inkMuted).lineLimit(1) }
                    }
                    .accessibilityElement(children: .combine)
                    HStack(alignment: .center, spacing: DS.Space.space3) {
                        Text("Start at current time").font(T.body).foregroundStyle(DS.Color.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                        Toggle("Start at current time", isOn: $useTime).labelsHidden().toggleStyle(DSSwitchStyle())
                    }
                    if useTime {
                        VStack(alignment: .leading, spacing: DS.Space.space2) {
                            DSTextField(label: "Start time", text: $clock, keyboard: .numbersAndPunctuation, plainURL: true)
                                .accessibilityLabel("Start time, minutes and seconds")
                            if clockInvalid { Text("Use mm:ss, for example 1:23").dsCaption().foregroundStyle(DS.Color.powerText) }
                        }
                    }
                    Text(link ?? "No link")
                        .font(T.caption).foregroundStyle(DS.Color.ink).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(DS.Space.space3)
                        .dsSlab(radius: DS.Radius.radiusKey)
                        .accessibilityLabel("Link: \(link ?? "none")")
                    HStack(spacing: DS.Space.space3) {
                        if let link, let url = URL(string: link) {
                            ShareLink(item: url, subject: Text(track.title), message: Text(track.artist)) {
                                Label("Share", systemImage: "square.and.arrow.up")
                            }
                            .buttonStyle(DSButtonStyle(kind: .outline))
                        }
                        Button { copy() } label: { Label("Copy link", systemImage: "doc.on.doc") }
                            .buttonStyle(DSButtonStyle(kind: .quiet)).disabled(link == nil)
                    }
                }
                .padding(DS.Space.space4)
            }
            .dsGround()
            .navigationTitle("Share link").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() }.foregroundStyle(DS.Color.accentInk) }
            }
            .overlay(alignment: .top) {
                if let toast {
                    Text(toast).font(T.caption).foregroundStyle(DS.Color.ink)
                        .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space2)
                        .dsSlab(radius: DS.Radius.radiusPill)
                        .task(id: toast) { try? await Task.sleep(for: .seconds(2)); self.toast = nil }
                }
            }
            .sensoryFeedback(.success, trigger: copyTick)
        }
        .presentationDetents([.medium, .large])
    }

    private func copy() {
        guard let link else { return }
        UIPasteboard.general.string = link
        copyTick += 1
        toast = "Link copied"
        UIAccessibility.post(notification: .announcement, argument: "Link copied")
    }
}
