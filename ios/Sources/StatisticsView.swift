import Charts
import SwiftUI

private enum StatsTab: String, CaseIterable, Identifiable {
    case songs = "Songs"
    case genres = "Genres"
    case listening = "Listening"
    var id: String { rawValue }
}

private enum ListeningState {
    case loading
    case failed
    case loaded(ListeningPayload)
}

private enum ListeningDisplay {
    case loading
    case failed
    case loaded([ListeningRow], [ListeningRow])
}

private struct ListeningRow: Identifiable {
    let id: String
    let title: String
    let artist: String
    let value: Int
    let tie: Double
}

private struct ListeningPayload: Decodable {
    struct Counts: Decodable { var all: Int? }
    struct Entry: Decodable {
        var listened: Counts?
        var skipped: Counts?
        var totalListenedS: Double?

        enum CodingKeys: String, CodingKey {
            case listened, skipped
            case totalListenedS = "total_listened_s"
        }
    }

    var songs: [String: Entry]?
}

/// Statistics screen. `fetchListening` returns the body of `GET /stats/listening`; it is only called when `signedIn`.
struct StatisticsView: View {
    let songs: [Track]
    let signedIn: Bool
    var loaded = true
    var hasAudio: (Track) -> Bool = { $0.onServer != false }
    let fetchListening: () async throws -> Data

    @State private var tab = StatsTab.songs
    @State private var listening = ListeningState.loading
    @State private var attempt = 0

    private var tabs: [StatsTab] { signedIn ? StatsTab.allCases : [.songs, .genres] }
    private var shown: StatsTab { tabs.contains(tab) ? tab : .songs }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.space4) {
                StatsTabBar(tabs: tabs, selection: shown) { tab = $0 }
                switch shown {
                case .songs: StatsSongsTab(songs: songs, loaded: loaded, hasAudio: hasAudio)
                case .genres: StatsGenresTab(songs: songs, loaded: loaded)
                case .listening: StatsListeningTab(state: listeningDisplay) { attempt += 1 }
                }
            }
            .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2).padding(.bottom, DS.Space.space4)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            ScreenHeader(title: "Statistics").padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2)
                .background(DS.Color.ground)
        }
        .dsGround()
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
        .task(id: signedIn ? attempt : -1) { await loadListening() }
        .onReceive(NotificationCenter.default.publisher(for: .playsUploaded)) { _ in attempt += 1 }
    }

    private var listeningDisplay: ListeningDisplay {
        switch listening {
        case .loading: .loading
        case .failed: .failed
        case .loaded(let payload): Self.rows(payload, songs)
        }
    }

    private func loadListening() async {
        guard signedIn else { return }
        listening = .loading
        do {
            let payload = try JSONDecoder().decode(ListeningPayload.self, from: try await fetchListening())
            listening = .loaded(payload)
        } catch is CancellationError {
            return
        } catch let error as URLError where error.code == .cancelled {
            return
        } catch {
            listening = .failed
        }
    }

    private static func rows(_ payload: ListeningPayload, _ songs: [Track]) -> ListeningDisplay {
        let byID = Dictionary(songs.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        func top(_ value: (ListeningPayload.Entry) -> Int, tie: (ListeningPayload.Entry) -> Double) -> [ListeningRow] {
            (payload.songs ?? [:]).compactMap { id, e -> ListeningRow? in
                guard let t = byID[id], value(e) > 0 else { return nil }
                return ListeningRow(id: id, title: t.title, artist: t.artist, value: value(e), tie: tie(e))
            }
            .sorted {
                if $0.value != $1.value { return $0.value > $1.value }
                if $0.tie != $1.tie { return $0.tie > $1.tie }
                return $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
            }
            .prefix(10).map { $0 }
        }
        return .loaded(
            top({ $0.listened?.all ?? 0 }, tie: { $0.totalListenedS ?? 0 }),
            top({ $0.skipped?.all ?? 0 }, tie: { _ in 0 }))
    }
}

private struct StatsTabBar: View {
    let tabs: [StatsTab]
    let selection: StatsTab
    let select: (StatsTab) -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: DS.Space.space1)) : AnyLayout(HStackLayout(spacing: DS.Space.space1))
        layout {
            ForEach(tabs) { item in
                let on = item == selection
                Button { select(item) } label: {
                    Text(item.rawValue).font(T.subhead.weight(on ? .semibold : .medium)).lineLimit(1).minimumScaleFactor(0.8)
                        .foregroundStyle(on ? DS.Color.accentInk : DS.Color.inkMuted)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background(Capsule().fill(on ? DS.Color.surface : Color.clear))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(item.rawValue)
                .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
            }
        }
        .padding(DS.Space.space1)
        .background(RoundedRectangle(cornerRadius: DS.Radius.radiusPill, style: .continuous).fill(DS.Color.surfaceSunken))
        .accessibilityElement(children: .contain)
    }
}

private enum StatsColor: String, CaseIterable, Identifiable {
    case decade, audio, none
    var id: String { rawValue }

    var label: String {
        switch self {
        case .decade: "Decade"
        case .audio: "Audio on server"
        case .none: "None"
        }
    }

    var mode: StatMode {
        switch self {
        case .decade: .decade
        case .audio: .audio
        case .none: .none
        }
    }
}

private enum StatsPalette {
    static let series: [Color] = [
        DS.Chart.chart0, DS.Chart.chart1, DS.Chart.chart2, DS.Chart.chart3, DS.Chart.chart4, DS.Chart.chart5,
        DS.Chart.chart6, DS.Chart.chart7, DS.Chart.chart8, DS.Chart.chart9, DS.Chart.chart10, DS.Chart.chart11,
    ]

    static func color(_ index: Int, mode: StatMode) -> Color {
        if mode == .none { return DS.Chart.chart0 }
        return index < 0 ? DS.Chart.chart15 : series[index % series.count]
    }
}

private struct StatsSongsTab: View {
    let songs: [Track]
    let loaded: Bool
    let hasAudio: (Track) -> Bool

    @AppStorage("ios.stats.color") private var colorRaw = StatsColor.decade.rawValue
    @State private var points: [StatPoint] = []
    @State private var groups: [StatGroup] = []
    @State private var skipped = 0
    @State private var asList = false
    @State private var selectedID: String?
    @ScaledMetric(relativeTo: .body) private var chartHeight: CGFloat = 320
    @ScaledMetric(relativeTo: .body) private var dot: CGFloat = 80
    @ScaledMetric(relativeTo: .body) private var hitRadius: CGFloat = 24
    @Environment(\.dynamicTypeSize) private var typeSize

    private var color: StatsColor { StatsColor(rawValue: colorRaw) ?? .decade }
    private var colorBinding: Binding<StatsColor> { Binding(get: { color }, set: { colorRaw = $0.rawValue }) }
    private var selected: StatPoint? { points.first { $0.id == selectedID } }
    private var labels: [String: String] { Dictionary(groups.map { ($0.key, $0.label) }, uniquingKeysWith: { a, _ in a }) }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space3) {
            if points.isEmpty {
                Text(loaded ? "Songs need a year and a BPM to appear here" : "Loading songs...")
                    .font(T.subhead).foregroundStyle(DS.Color.inkMuted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity).padding(DS.Space.space4)
                    .dsSlab()
            } else {
                controls
                if let selected { selectionCard(selected) }
                if asList { list } else { chart; legend }
            }
        }
        .onAppear(perform: rebuild)
        .onChange(of: songs) { rebuild() }
        .onChange(of: colorRaw) { rebuild() }
    }

    private var controls: some View {
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: DS.Space.space2)) : AnyLayout(HStackLayout(spacing: DS.Space.space3))
        return VStack(alignment: .leading, spacing: DS.Space.space1) {
            layout {
                Text(StatData.countText(points.count, songs.count)).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.ink)
                if typeSize.isAccessibilitySize == false { Spacer(minLength: DS.Space.space2) }
                Picker("Colour by", selection: colorBinding) {
                    ForEach(StatsColor.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.menu).tint(DS.Color.accentInk)
                Button(asList ? "View as chart" : "View as list") { asList.toggle() }
                    .font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                    .frame(minHeight: DS.Space.hit)
            }
            if skipped > 0 { Text(StatData.skippedText(skipped)).dsCaption() }
        }
    }

    private var chart: some View {
        let xr = StatData.extentX(points.map(\.year))
        let yr = StatData.extentY(points.map(\.bpm))
        let xTicks = StatData.ticks(lo: xr.lo, hi: xr.hi, step: StatData.tickStep(span: xr.span, maxTicks: 6)).map(Double.init)
        let yTicks = StatData.ticks(lo: yr.lo, hi: yr.hi, step: StatData.tickStep(span: yr.span, maxTicks: 6, minStep: 10)).map(Double.init)
        let names = labels
        return Chart {
            ForEach(points) { p in
                PointMark(x: .value("Year", p.x), y: .value("BPM", p.y))
                    .symbolSize(dot)
                    .foregroundStyle(by: .value("Group", names[p.group] ?? ""))
                    .opacity(0.55)
            }
            if let s = selected {
                PointMark(x: .value("Year", s.x), y: .value("BPM", s.y))
                    .symbolSize(dot * 2.5)
                    .foregroundStyle(DS.Color.ink)
            }
        }
        .chartForegroundStyleScale(domain: groups.map(\.label), range: groups.map { StatsPalette.color($0.color, mode: color.mode) })
        .chartLegend(.hidden)
        .chartXScale(domain: xr.lo...xr.hi)
        .chartYScale(domain: yr.lo...yr.hi)
        .chartXAxis {
            AxisMarks(values: xTicks) { v in
                AxisGridLine().foregroundStyle(DS.Color.line)
                AxisValueLabel { if let d = v.as(Double.self) { Text(String(Int(d))).font(T.caption).foregroundStyle(DS.Color.inkMuted) } }
            }
        }
        .chartYAxis {
            AxisMarks(values: yTicks) { v in
                AxisGridLine().foregroundStyle(DS.Color.line)
                AxisValueLabel { if let d = v.as(Double.self) { Text(String(Int(d))).font(T.caption).foregroundStyle(DS.Color.inkMuted) } }
            }
        }
        .chartXAxisLabel { Text("Year").font(T.caption).foregroundStyle(DS.Color.inkMuted) }
        .chartYAxisLabel { Text("BPM").font(T.caption).foregroundStyle(DS.Color.inkMuted) }
        .chartOverlay { proxy in
            GeometryReader { geo in
                Rectangle().fill(Color.clear).contentShape(Rectangle())
                    .onTapGesture { pick($0, proxy, geo) }
            }
        }
        .frame(height: chartHeight)
        .padding(DS.Space.space3)
        .dsSlab()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(StatData.chartLabel(points.count))
        .accessibilityHint("Choose View as list to hear every song.")
    }

    private var legend: some View {
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: DS.Space.space1)) : AnyLayout(HStackLayout(spacing: DS.Space.space3))
        return ScrollView(.horizontal, showsIndicators: false) {
            layout {
                ForEach(groups) { g in
                    HStack(spacing: DS.Space.space1) {
                        Circle().fill(StatsPalette.color(g.color, mode: color.mode)).frame(width: 10, height: 10).accessibilityHidden(true)
                        Text("\(g.label) \(g.count)").font(T.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    private var list: some View {
        let rows = points.sorted { ($0.year, $0.track.title) < ($1.year, $1.track.title) }
        return LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(rows) { p in
                Button { selectedID = p.id } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.track.title).font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.ink)
                        Text(detail(p)).dsCaption()
                    }
                    .frame(maxWidth: .infinity, minHeight: DS.Space.hit, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(p.id == selectedID ? .isSelected : [])
                if p.id != rows.last?.id { Rectangle().fill(DS.Color.line).frame(height: 1) }
            }
        }
        .padding(.horizontal, DS.Space.space4)
        .frame(maxWidth: .infinity, alignment: .leading).dsSlab()
    }

    private func detail(_ p: StatPoint) -> String {
        [p.track.artist, String(p.year), "\(Int(p.bpm.rounded())) BPM"].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
    }

    private func selectionCard(_ p: StatPoint) -> some View {
        HStack(alignment: .top, spacing: DS.Space.space2) {
            VStack(alignment: .leading, spacing: 2) {
                Text(p.track.title).font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.ink)
                Text(detail(p)).dsCaption()
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: DS.Space.space2)
            Button { selectedID = nil } label: {
                Image(systemName: "xmark").font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
                    .frame(width: DS.Space.hit, height: DS.Space.hit).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
        }
        .padding(.leading, DS.Space.space4)
        .frame(maxWidth: .infinity, alignment: .leading).dsSlab()
    }

    private func pick(_ location: CGPoint, _ proxy: ChartProxy, _ geo: GeometryProxy) {
        guard let frame = proxy.plotFrame else { return }
        let origin = geo[frame].origin
        var best: String?
        var bestD = hitRadius * hitRadius
        for p in points {
            guard let px = proxy.position(forX: p.x), let py = proxy.position(forY: p.y) else { continue }
            let dx = px + origin.x - location.x
            let dy = py + origin.y - location.y
            let d = dx * dx + dy * dy
            if d <= bestD { best = p.id; bestD = d }
        }
        selectedID = best
    }

    private func rebuild() {
        let split = StatData.split(songs)
        skipped = split.skipped
        var pts = split.plotted.map(StatData.makePoint)
        groups = StatData.assign(&pts, mode: color.mode, families: nil, hasAudio: hasAudio)
        points = pts
        if let id = selectedID, !pts.contains(where: { $0.id == id }) { selectedID = nil }
    }
}

private struct StatsGenresTab: View {
    let songs: [Track]
    let loaded: Bool

    private var rows: [(key: String, count: Int)] {
        var counts: [String: Int] = [:]
        for s in songs { for g in StatData.genres(s) { counts[g.key, default: 0] += 1 } }
        return counts.map { (key: $0.key, count: $0.value) }.sorted { $0.count != $1.count ? $0.count > $1.count : $0.key < $1.key }
    }

    var body: some View {
        let rows = rows
        if rows.isEmpty {
            Text(loaded ? "No genres yet." : "Loading songs...")
                .font(T.subhead).foregroundStyle(DS.Color.inkMuted)
                .frame(maxWidth: .infinity).padding(DS.Space.space4)
                .dsSlab()
        } else {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(rows, id: \.key) { r in
                    line(r.key, r.count, strong: false)
                    Rectangle().fill(DS.Color.line).frame(height: 1)
                }
                line("All songs", songs.count, strong: true)
            }
            .padding(.horizontal, DS.Space.space4)
            .frame(maxWidth: .infinity, alignment: .leading).dsSlab()
            Text("A song with several genres counts in each of them.").dsCaption()
        }
    }

    private func line(_ name: String, _ count: Int, strong: Bool) -> some View {
        HStack(spacing: DS.Space.space3) {
            Text(name).font(T.subhead.weight(strong ? .semibold : .regular)).foregroundStyle(DS.Color.ink)
            Spacer(minLength: DS.Space.space2)
            Text("\(count)").font(T.subhead.weight(strong ? .semibold : .regular).monospacedDigit()).foregroundStyle(strong ? DS.Color.ink : DS.Color.inkMuted)
        }
        .frame(minHeight: 48)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(name), \(count) \(count == 1 ? "song" : "songs")")
    }
}

private struct StatsListeningTab: View {
    let state: ListeningDisplay
    let retry: () -> Void

    var body: some View {
        switch state {
        case .loading:
            message("Loading listening data...")
        case .failed:
            VStack(spacing: DS.Space.space2) {
                Text("Couldn't load listening data").font(T.subhead).foregroundStyle(DS.Color.inkMuted)
                Button("Retry", action: retry)
                    .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                    .frame(minHeight: DS.Space.hit)
            }
            .frame(maxWidth: .infinity).padding(DS.Space.space4).dsSlab()
        case .loaded(let listened, let skipped):
            if listened.isEmpty && skipped.isEmpty {
                message("No listening data yet.")
            } else {
                block("Most listened", listened) { "\($0) \($0 == 1 ? "time" : "times")" }
                block("Most skipped", skipped) { "\($0) \($0 == 1 ? "skip" : "skips")" }
            }
        }
    }

    private func message(_ text: String) -> some View {
        Text(text).font(T.subhead).foregroundStyle(DS.Color.inkMuted)
            .frame(maxWidth: .infinity).padding(DS.Space.space4).dsSlab()
    }

    private func block(_ title: String, _ rows: [ListeningRow], _ label: @escaping (Int) -> String) -> some View {
        let maxValue = Double(rows.first?.value ?? 1)
        return VStack(alignment: .leading, spacing: DS.Space.space1) {
            SectionLabel(title)
            VStack(alignment: .leading, spacing: 0) {
                if rows.isEmpty {
                    Text("No listening data yet.").font(T.subhead).foregroundStyle(DS.Color.inkMuted).frame(minHeight: 48)
                }
                ForEach(rows) { r in
                    VStack(alignment: .leading, spacing: DS.Space.space1) {
                        HStack(alignment: .firstTextBaseline, spacing: DS.Space.space2) {
                            Text(r.title).font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.ink)
                            Spacer(minLength: DS.Space.space2)
                            Text(label(r.value)).dsCaption()
                        }
                        if !r.artist.isEmpty { Text(r.artist).dsCaption() }
                        Bar(fraction: max(0.02, Double(r.value) / maxValue))
                    }
                    .padding(.vertical, DS.Space.space2)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(r.title), \(r.artist.isEmpty ? "unknown artist" : r.artist), \(label(r.value))")
                }
            }
            .padding(.horizontal, DS.Space.space4)
            .frame(maxWidth: .infinity, alignment: .leading).dsSlab()
        }
    }
}

private struct Bar: View {
    let fraction: Double
    @ScaledMetric(relativeTo: .body) private var height: CGFloat = 8

    var body: some View {
        GeometryReader { geo in
            Capsule().fill(DS.Chart.chart0).frame(width: geo.size.width * fraction)
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }
}
