import SwiftUI

/// The raised card the web shares across toolbar, legend, card, outline and popovers (GEN-024).
extension View {
    func genCard() -> some View {
        background(RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous).fill(DS.Color.surface)
            .shadow(color: DS.Color.vinyl.opacity(0.18), radius: 10, y: 2))
    }
}

struct GenToolButtonStyle: ButtonStyle {
    var on = false
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(T.caption.weight(on ? .semibold : .regular))
            .foregroundStyle(on ? DS.Color.accentInk : DS.Color.ink)
            .padding(.horizontal, DS.Space.space3).frame(minHeight: 28)
            .background(Capsule().fill(on ? DS.Color.accentTint : DS.Color.surfaceSunken))
            .overlay { if on { Capsule().strokeBorder(DS.Color.accentInk, lineWidth: DS.Stroke.strokeHairline) } }
            .opacity(buttonOpacity(enabled: enabled, pressed: configuration.isPressed, pressedValue: 0.7))
            .contentShape(Capsule())
    }
}

struct GenIconButtonStyle: ButtonStyle {
    var key = false
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(key ? DS.Color.ink : DS.Color.inkMuted)
            .frame(width: 30, height: 30)
            .background(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous).fill(key ? DS.Color.surfaceKey : Color.clear))
            .opacity(buttonOpacity(enabled: enabled, pressed: configuration.isPressed, pressedValue: 0.6))
            .contentShape(Rectangle())
    }
}

struct GenDot: View {
    let family: String
    var size: CGFloat = 10

    var body: some View {
        Circle().fill(GenFamily.color(of: family)).frame(width: size, height: size).accessibilityHidden(true)
    }
}

struct GenCollapseButton: View {
    @Binding var collapsed: Bool

    var body: some View {
        Button { withAnimation(.easeOut(duration: 0.15)) { collapsed.toggle() } } label: {
            Image(systemName: "chevron.down").rotationEffect(.degrees(collapsed ? -90 : 0))
        }
        .buttonStyle(GenIconButtonStyle())
        .help(collapsed ? "Expand panel" : "Collapse panel")
        .accessibilityLabel(collapsed ? "Expand panel" : "Collapse panel")
    }
}

struct GenZoomBar: View {
    let engine: GenEngine

    var body: some View {
        VStack(spacing: DS.Space.space1) {
            Button { engine.zoom(1.3) } label: { Image(systemName: "plus") }.help("Zoom in").accessibilityLabel("Zoom in")
            Button { engine.zoom(1 / 1.3) } label: { Image(systemName: "minus") }.help("Zoom out").accessibilityLabel("Zoom out")
            Button { engine.fit() } label: { Image(systemName: "arrow.up.left.and.arrow.down.right") }.help("Fit all").accessibilityLabel("Fit all genres")
        }
        .buttonStyle(GenIconButtonStyle(key: true))
        .padding(DS.Space.space1)
        .genCard()
    }
}

/// Title, status chip, Legend / Now playing / Orphans buttons, search and legend (GEN-011, GEN-022, GEN-027).
struct GenBar: View {
    @ObservedObject var model: GenModel
    @AppStorage("ap2.panel.genres") private var collapsed = false
    @FocusState private var searchFocused: Bool

    private var hits: [GenNode] { model.graph?.search(model.query) ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            FlowLayout(spacing: DS.Space.space2) {
                HStack(spacing: DS.Space.space2) {
                    GenCollapseButton(collapsed: $collapsed)
                    Text("Genres map").font(DS.Font.headline).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader)
                }
                if !model.message.isEmpty {
                    Text(model.message).font(T.caption).foregroundStyle(DS.Color.accentInk).lineLimit(1)
                        .padding(.horizontal, DS.Space.space2)
                        .background(Capsule().fill(DS.Color.accentTint))
                }
                Button("Legend") { model.legendOpen.toggle() }
                    .buttonStyle(GenToolButtonStyle(on: model.legendOpen))
                Button { model.toggleNow() } label: { Label("Now playing", systemImage: "music.note") }
                    .buttonStyle(GenToolButtonStyle(on: model.nowOpen || model.nowPressed))
                    .disabled(model.nowKind != .ready)
                    .help(model.nowHint)
                Button(model.orphLabel) { model.toggleOrph() }
                    .buttonStyle(GenToolButtonStyle(on: model.orphPressed))
                    .disabled(model.orphans.isEmpty)
                    .help(model.orphHint)
            }
            if !collapsed {
                find.zIndex(1)
                if model.legendOpen { legend }
            }
        }
        .padding(.horizontal, DS.Space.space4).padding(.vertical, DS.Space.space3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .genCard()
    }

    private var find: some View {
        TextField("Find a genre", text: $model.query)
            .dsField()
            .focused($searchFocused)
            .onSubmit { if let first = hits.first { model.pick(first.id) } }
            .onExitCommand { model.query = "" }
            .accessibilityLabel("Find a genre")
            .overlay(alignment: .topLeading) {
                if !hits.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(hits) { n in
                            Button { model.pick(n.id) } label: {
                                HStack(spacing: DS.Space.space2) {
                                    GenDot(family: n.family)
                                    Text(n.label).font(T.subhead).foregroundStyle(DS.Color.ink).lineLimit(1)
                                    Spacer(minLength: DS.Space.space2)
                                    Text(GenModel.songsText(n.count)).font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted)
                                }
                                .padding(.horizontal, DS.Space.space3).frame(minHeight: 32)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(DS.Space.space1)
                    .frame(maxWidth: .infinity)
                    .genCard()
                    .offset(y: 40)
                }
            }
    }

    private var legend: some View {
        let present = presentFamilies
        return VStack(alignment: .leading, spacing: DS.Space.space1) {
        FlowLayout(spacing: DS.Space.space1) {
            ForEach(present, id: \.family) { row in
                let off = model.hidden.contains(row.family)
                Button { model.toggleHidden(row.family) } label: {
                    HStack(spacing: DS.Space.space1) {
                        GenDot(family: row.family).opacity(off ? 0.3 : 1)
                        Text(row.family).strikethrough(off)
                        Text("\(row.count)").font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted)
                    }
                    .font(T.caption).foregroundStyle(off ? DS.Color.inkMuted : DS.Color.ink)
                    .padding(.horizontal, DS.Space.space2).frame(minHeight: 26)
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .help(off ? "Show \(row.family)" : "Hide \(row.family)")
                .accessibilityAddTraits(off ? [] : .isSelected)
            }
            if !model.hidden.isEmpty {
                Button("Show all") { model.showAllFamilies() }.buttonStyle(.plain)
                    .font(T.caption).foregroundStyle(DS.Color.accentInk).padding(.horizontal, DS.Space.space2)
            }
        }
            Text("Arrow points to the parent genre (A -> B means A is a kind of B)").dsCaption()
        }
    }

    private var presentFamilies: [(family: String, count: Int)] {
        var counts: [String: Int] = [:]
        for n in model.graph?.nodes ?? [] { counts[n.family, default: 0] += 1 }
        return GenFamily.order.filter { counts[$0] != nil }.map { ($0, counts[$0]!) }
    }
}

/// Playing song's genres (GEN-025).
struct GenNowCard: View {
    @ObservedObject var model: GenModel
    let song: Track?
    @AppStorage("ap2.panel.genreInfo") private var collapsed = false

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space3) {
            HStack(spacing: DS.Space.space3) {
                LibCover(source: song?.thumbnail).frame(width: 44, height: 44)
                VStack(alignment: .leading, spacing: 1) {
                    if let song {
                        SongName.title(song).font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.ink).lineLimit(1)
                        Text(SongName.artistLine(song)).dsCaption().lineLimit(1)
                    }
                    Text("\(model.nowItems.count) \(model.nowItems.count == 1 ? "genre" : "genres")").dsCaption()
                }
                Spacer(minLength: 0)
                GenCollapseButton(collapsed: $collapsed)
            }
            if !collapsed {
                if model.nowItems.isEmpty {
                    Text("This song has no genres").dsCaption()
                } else {
                    FlowLayout(spacing: DS.Space.space1) {
                        ForEach(model.nowItems) { x in
                            if let id = x.nodeID {
                                Button { model.engine.select(id, center: true) } label: {
                                    Text(x.label).font(T.caption).foregroundStyle(DS.Color.accentInk)
                                        .padding(.horizontal, DS.Space.space3).frame(minHeight: 28)
                                        .background(Capsule().fill(DS.Color.accentTint))
                                        .contentShape(Capsule())
                                }
                                .buttonStyle(.plain)
                                .onHover { model.engine.hoverID($0 ? id : nil) }
                            } else {
                                Text(x.label).font(T.caption).foregroundStyle(DS.Color.inkMuted)
                                    .padding(.horizontal, DS.Space.space3).frame(minHeight: 28)
                                    .background(Capsule().fill(DS.Color.surfaceSunken))
                                    .help("Not in the map yet")
                            }
                        }
                    }
                    Button("Show all") { model.engine.fitIDs(GenModel.nodeIDs(model.nowItems)) }
                        .buttonStyle(GenToolButtonStyle())
                        .disabled(GenModel.nodeIDs(model.nowItems).isEmpty)
                }
            }
        }
        .padding(.horizontal, DS.Space.space4).padding(.vertical, DS.Space.space3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .genCard()
    }
}

/// Genres without any edge (GEN-032).
struct GenOrphanCard: View {
    @ObservedObject var model: GenModel
    @AppStorage("ap2.panel.genreInfo") private var collapsed = false

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space3) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Orphans (\(model.orphans.count))").font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.ink)
                    Text("Genres with no connections").dsCaption()
                }
                Spacer(minLength: 0)
                GenCollapseButton(collapsed: $collapsed)
            }
            if !collapsed {
                ScrollView {
                    LazyVStack(spacing: 2) {
                        ForEach(model.orphans) { n in
                            Button { model.engine.select(n.id, center: true) } label: {
                                HStack(spacing: DS.Space.space2) {
                                    GenDot(family: n.family)
                                    Text(n.label).font(T.subhead).foregroundStyle(DS.Color.ink).lineLimit(1)
                                    Spacer(minLength: DS.Space.space2)
                                    Text(GenModel.songsText(n.count)).font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted)
                                }
                                .padding(.horizontal, DS.Space.space3).frame(minHeight: 32)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .onHover { model.engine.hoverID($0 ? n.id : nil) }
                        }
                    }
                }
                .frame(maxHeight: 260)
            }
        }
        .padding(.horizontal, DS.Space.space4).padding(.vertical, DS.Space.space3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .genCard()
    }
}
