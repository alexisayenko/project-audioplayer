import SwiftUI

struct StatPillStyle: ButtonStyle {
    var on = false
    @Environment(\.isEnabled) private var enabled

    private func opacity(pressed: Bool) -> Double {
        if !enabled { return 0.4 }
        return pressed ? 0.7 : 1
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(DS.Font.caption.weight(on ? .semibold : .regular))
            .foregroundStyle(on ? DS.Color.accentInk : DS.Color.ink)
            .padding(.horizontal, DS.Space.space3).frame(minHeight: 28)
            .background(Capsule().fill(on ? DS.Color.accentTint : DS.Color.surfaceSunken))
            .overlay { if on { Capsule().strokeBorder(DS.Color.accentInk, lineWidth: DS.Stroke.strokeHairline) } }
            .opacity(opacity(pressed: configuration.isPressed))
            .contentShape(Capsule())
    }
}

struct StatActStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    private func opacity(pressed: Bool) -> Double {
        if !enabled { return 0.4 }
        return pressed ? 0.7 : 1
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(DS.Font.caption.weight(.semibold))
            .foregroundStyle(DS.Color.accentInk)
            .padding(.horizontal, DS.Space.space3).frame(minHeight: 36)
            .background(Capsule().fill(DS.Color.accentTint))
            .opacity(opacity(pressed: configuration.isPressed))
            .contentShape(Capsule())
    }
}

struct StatBar: View {
    @Binding var mode: StatMode
    @Binding var legendOpen: Bool
    @Binding var asTable: Bool
    @Binding var collapsed: Bool
    let status: String
    let note: String
    let groups: [StatGroup]
    let hidden: Set<String>
    let resolving: Bool
    let zoomed: Bool
    let family: Bool
    let toggle: (String) -> Void
    let center: () -> Void
    let reset: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: DS.Space.space2) {
                Text("Song stats").font(DS.Font.headline).foregroundStyle(DS.Color.ink)
                Spacer(minLength: 0)
                if !status.isEmpty {
                    Text(status).font(DS.Font.caption).foregroundStyle(DS.Color.accentInk).lineLimit(1)
                        .padding(.horizontal, DS.Space.space2)
                        .background(Capsule().fill(DS.Color.accentTint))
                }
                Button { toggleCollapsed() } label: {
                    Image(systemName: "chevron.down").rotationEffect(.degrees(collapsed ? -90 : 0))
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(DS.Color.inkMuted)
                        .frame(width: 28, height: 28)
                        .overlay(RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous).strokeBorder(DS.Color.line, lineWidth: DS.Stroke.strokeHairline))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(collapsed ? "Expand panel" : "Collapse panel")
                .accessibilityLabel(collapsed ? "Expand panel" : "Collapse panel")
            }
            if !collapsed {
                VStack(alignment: .leading, spacing: DS.Space.space2) {
                    tools
                    if !note.isEmpty { Text(note).dsCaption() }
                    if legendOpen && mode != .none { legend }
                }
                .padding(.top, DS.Space.space2)
                .transition(.opacity)
            }
        }
        .padding(.horizontal, DS.Space.space4).padding(.vertical, DS.Space.space3)
        .frame(width: 380, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous).fill(DS.Color.surface)
            .shadow(color: DS.Color.vinyl.opacity(0.16), radius: 10, y: 2))
    }

    private func toggleCollapsed() {
        if reduceMotion { collapsed.toggle() } else { withAnimation(.easeOut(duration: 0.2)) { collapsed.toggle() } }
    }

    private var tools: some View {
        FlowLayout(spacing: DS.Space.space2) {
            Menu {
                ForEach(StatMode.allCases) { m in
                    Button { mode = m } label: { if m == mode { Label(m.label, systemImage: "checkmark") } else { Text(m.label) } }
                }
            } label: {
                HStack(spacing: DS.Space.space1) {
                    Text(mode.label)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold))
                }
                .font(DS.Font.caption).foregroundStyle(DS.Color.ink)
                .padding(.horizontal, DS.Space.space3).frame(minHeight: 28)
                .background(Capsule().fill(DS.Color.surfaceSunken))
            }
            .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden)
            .accessibilityLabel("Colour by")
            if mode != .none {
                Button("Legend") { legendOpen.toggle() }.buttonStyle(StatPillStyle(on: legendOpen))
                    .accessibilityAddTraits(legendOpen ? .isSelected : [])
            }
            Button(asTable ? "View as chart" : "View as table") { asTable.toggle() }.buttonStyle(StatPillStyle(on: asTable))
            if !asTable {
                Button(action: center) { Image(systemName: "scope") }.buttonStyle(StatPillStyle())
                    .help("Center chart (C)").accessibilityLabel("Center chart")
                if zoomed { Button("Reset", action: reset).buttonStyle(StatPillStyle()) }
            }
        }
        .help("Drag: select - Right-drag or Shift-drag: pan - C: center - Wheel: zoom - Double-click: reset")
    }

    private var legend: some View {
        ScrollView {
            FlowLayout(spacing: DS.Space.space1) {
                if resolving {
                    Text("Resolving genre families...").font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                } else {
                    ForEach(groups) { g in
                        let off = hidden.contains(g.key)
                        Button { toggle(g.key) } label: {
                            HStack(spacing: DS.Space.space1) {
                                Circle().fill(StatPalette.color(g.color, family: family)).frame(width: 10, height: 10)
                                Text(g.label).strikethrough(off)
                                Text("\(g.count)").foregroundStyle(DS.Color.inkMuted).font(DS.Font.micro)
                            }
                            .font(DS.Font.caption).foregroundStyle(DS.Color.ink)
                            .padding(.horizontal, DS.Space.space2).frame(minHeight: 28)
                            .background(Capsule().fill(DS.Color.surfaceSunken))
                            .opacity(off ? 0.4 : 1)
                            .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .help("\(off ? "Show" : "Hide") \(g.label)")
                        .accessibilityAddTraits(off ? [] : .isSelected)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: 200)
        .fixedSize(horizontal: false, vertical: true)
    }
}

struct StatSelectionPanel: View {
    let count: Int
    let clear: () -> Void
    let add: () -> Void
    let play: () -> Void

    var body: some View {
        HStack(spacing: DS.Space.space2) {
            Text("\(count) selected:").font(DS.Font.subheadStrong).foregroundStyle(DS.Color.ink)
            Button("Show in Library") {}.buttonStyle(StatActStyle()).disabled(true).help("Coming soon")
            Button(action: add) { Image(systemName: "text.badge.plus") }.buttonStyle(LibRoundButtonStyle())
                .help("Add to playlist").accessibilityLabel("Add to playlist")
            Button(action: play) { Image(systemName: "play.fill") }.buttonStyle(LibRoundButtonStyle(on: true))
                .help("Play").accessibilityLabel("Play")
            Button("Clear", action: clear).buttonStyle(StatActStyle())
        }
        .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space2)
        .background(RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous).fill(DS.Color.surface)
            .shadow(color: DS.Color.vinyl.opacity(0.16), radius: 10, y: 2))
    }
}

struct StatTooltip: View {
    let track: Track
    let year: Int
    let bpm: Double
    let genres: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            SongName.title(track).font(DS.Font.caption.weight(.semibold)).lineLimit(1)
            let artist = SongName.artistLine(track)
            if !artist.isEmpty { Text(artist).font(DS.Font.caption).lineLimit(1) }
            Text("\(year) · \(Int(bpm.rounded())) BPM").font(DS.Font.caption).opacity(0.85)
            if !genres.isEmpty { Text(genres).font(DS.Font.caption).opacity(0.85).lineLimit(2) }
        }
        .foregroundStyle(DS.Color.surface)
        .padding(.horizontal, DS.Space.space2).padding(.vertical, DS.Space.space1)
        .frame(maxWidth: 220, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous).fill(DS.Color.ink))
        .allowsHitTesting(false)
    }
}

struct StatRow: Identifiable {
    let id: String
    let track: Track
    let title: String
    let artist: String
    let year: Int
    let bpm: Double
    let decade: Int
    let family: String
}

struct StatTable: View {
    let rows: [StatRow]
    let topInset: Double
    let open: (Track) -> Void
    @State private var order = [KeyPathComparator(\StatRow.year)]

    var body: some View {
        let sorted = rows.sorted(using: order + [KeyPathComparator(\StatRow.title)])
        Table(sorted, sortOrder: $order) {
            TableColumn("Title", value: \.title) { r in
                Button { open(r.track) } label: { SongName.title(r.track).lineLimit(1) }
                    .buttonStyle(.plain).foregroundStyle(DS.Color.ink)
            }
            TableColumn("Artist", value: \.artist) { Text($0.artist).foregroundStyle(DS.Color.ink) }
            TableColumn("Year", value: \.year) { Text(String($0.year)).foregroundStyle(DS.Color.ink) }.width(60)
            TableColumn("BPM", value: \.bpm) { Text(String(Int($0.bpm.rounded()))).foregroundStyle(DS.Color.ink) }.width(60)
            TableColumn("Decade", value: \.decade) { Text("\($0.decade)s").foregroundStyle(DS.Color.ink) }.width(70)
            TableColumn("Family", value: \.family) { Text($0.family).foregroundStyle(DS.Color.ink) }
        }
        .font(DS.Font.caption)
        .scrollContentBackground(.hidden)
        .padding(.top, topInset)
        .accessibilityLabel("Plotted songs")
    }
}
