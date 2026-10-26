import SwiftUI

/// Local to the refreshed screens: changing these does not restyle the dock.
extension View {
    func librarySlab(radius: CGFloat = DS.Radius.radiusCard) -> some View {
        background(RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(DS.Color.surface).dsShadow(DS.Shadow.depthSlab))
    }
    func libraryFloat() -> some View {
        background(RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous)
            .fill(DS.Color.surface).dsShadow(DS.Shadow.depthLift))
            .overlay(RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous)
                .strokeBorder(DS.Color.line, lineWidth: DS.Stroke.strokeHairline))
    }
}

struct LibraryPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.8 : 1)
            .dsAnimation(DS.Motion.durFast, value: configuration.isPressed)
    }
}

struct LibrarySearchField: View {
    @Binding var text: String
    var placeholder = "Search songs, artists, tags"
    var height = DS.Space.hit
    var onFocus: (() -> Void)?
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: DS.Space.space2) {
            Image(systemName: "magnifyingglass").font(.system(size: DS.Icon.iconAction))
                .foregroundStyle(DS.Color.inkMuted).accessibilityHidden(true)
            TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(DS.Color.inkMuted))
                .font(T.body).foregroundStyle(DS.Color.ink).focused($focused)
                .submitLabel(.search).autocorrectionDisabled().textInputAutocapitalization(.never)
                .onSubmit { focused = false }
                .accessibilityLabel(placeholder == "Search songs, artists, tags" ? "Search songs, artists and tags" : placeholder)
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(DS.Color.inkMuted)
                        .frame(width: DS.Space.hit, height: DS.Space.hit)
                }
                .buttonStyle(LibraryPressStyle()).accessibilityLabel("Clear search")
            }
        }
        .padding(.leading, DS.Space.space3).padding(.trailing, text.isEmpty ? DS.Space.space3 : 0)
        .frame(height: height)
        .background(RoundedRectangle(cornerRadius: DS.Radius.radiusKey).fill(DS.Color.surfaceSunken))
        .overlay(RoundedRectangle(cornerRadius: DS.Radius.radiusKey)
            .strokeBorder(focused ? DS.Color.accentInk : .clear, lineWidth: DS.Stroke.strokeMedium))
        .onChange(of: focused) { _, value in if value { onFocus?() } }
    }
}

struct LibraryFilterChip: View {
    let title: String
    let symbol: String
    var selected = false
    var count: Int? = nil
    var hint = "Opens the filter"
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Button(action: action) {
            HStack(spacing: DS.Space.space1) {
                Image(systemName: symbol).font(.system(size: DS.Icon.iconInline, weight: DS.Icon.iconWeight))
                    .foregroundStyle(selected ? DS.Color.ink : DS.Color.inkMuted)
                Text(title).font(selected ? T.subhead.weight(.semibold) : T.subhead.weight(.medium))
                if let count, count > 0 {
                    Text("\(count)").font(T.caption.weight(.semibold)).foregroundStyle(scheme.onStrong)
                        .frame(minWidth: DS.Component.badge, minHeight: DS.Component.badge)
                        .background(Capsule().fill(scheme.strongFill))
                }
            }
            .foregroundStyle(DS.Color.ink).padding(.horizontal, DS.Space.space3)
            .frame(minHeight: DS.Control.control)
            .background {
                if selected { Capsule().fill(DS.Color.accentTint) }
                else { Capsule().fill(DS.Color.surface).dsShadow(DS.Shadow.depthSlab) }
            }
            .overlay(Capsule().strokeBorder(selected ? DS.Color.accentInk : .clear, lineWidth: DS.Stroke.strokeThin))
            .frame(minHeight: DS.Space.hit).contentShape(Rectangle())
        }
        .buttonStyle(LibraryPressStyle()).accessibilityLabel(title)
        .accessibilityValue(count.map { "\($0) selected" } ?? (selected ? "On" : "Off"))
        .accessibilityHint(hint).accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct LibraryControls: View {
    @EnvironmentObject private var query: LibraryQuery
    @Environment(\.dynamicTypeSize) private var typeSize
    @AccessibilityFocusState private var countFocused: Bool
    let matches: Int
    let total: Int
    let enabled: Bool
    let canShowPlaying: Bool
    let showPlaying: () -> Void
    let sort: () -> Void
    let play: () -> Void
    let scrollTop: () -> Void

    var body: some View {
        if typeSize.isAccessibilitySize {
            stackedControls
        } else {
            ViewThatFits(in: .horizontal) {
                controls(showSongs: true)
                controls(showSongs: false)
                stackedControls
            }
        }
    }

    private func controls(showSongs: Bool) -> some View {
        HStack(spacing: DS.Space.space2) {
            sortButtons.fixedSize()
            Spacer(minLength: 0)
            count(showSongs: showSongs)
        }
    }

    private var stackedControls: some View {
        VStack(alignment: .trailing, spacing: DS.Space.space2) {
            sortButtons.frame(maxWidth: .infinity, alignment: .leading)
            count(showSongs: false)
        }
    }

    private var sortButtons: some View {
        HStack(spacing: 0) {
            icon("sort.criteria", selected: query.sort != .newest, label: "Sort by, \(query.sort.rawValue)", action: sort)
            icon(query.sort.descending != query.reversed ? "sort.direction.desc" : "sort.direction.asc",
                 selected: query.reversed,
                 label: "Sort direction, \(query.sort.descending != query.reversed ? "descending" : "ascending")") {
                query.reversed.toggle(); scrollTop()
            }
        }
    }

    private func icon(_ name: String, selected: Bool, label: String, action: @escaping () -> Void) -> some View {
        let circle = typeSize.isAccessibilitySize ? DS.Component.rowHeight : DS.Control.control
        let hit = typeSize.isAccessibilitySize ? DS.Control.controlXl - DS.Space.space1 : DS.Space.hit
        return Button(action: action) {
            Image(name).resizable().scaledToFit()
                .frame(width: typeSize.isAccessibilitySize ? DS.Icon.iconNavLg + DS.Space.space1 : DS.Icon.iconNav,
                       height: typeSize.isAccessibilitySize ? DS.Icon.iconNavLg + DS.Space.space1 : DS.Icon.iconNav)
                .foregroundStyle(selected ? DS.Color.selectInk : DS.Color.ink)
                .frame(width: circle, height: circle)
                .background {
                    if selected { Circle().fill(DS.Color.selectTint) }
                    else { Circle().fill(DS.Color.surface).dsShadow(DS.Shadow.depthSlab) }
                }
                .overlay(Circle().strokeBorder(selected ? DS.Color.selectInk : .clear, lineWidth: DS.Stroke.strokeThin))
                .frame(width: hit, height: hit).contentShape(Rectangle())
        }.buttonStyle(LibraryPressStyle()).accessibilityLabel(label)
    }

    private func count(showSongs: Bool) -> some View {
        let suffix = showSongs ? " songs" : ""
        return HStack(spacing: DS.Space.space2) {
            Text("\(total) of \(total)\(suffix)").hidden()
                .overlay(alignment: .trailing) {
                    Text("\(matches) of \(total)\(suffix)")
                        .foregroundStyle(query.narrowing ? DS.Color.selectInk : DS.Color.inkMuted)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(matches) of \(total) songs matched")
                .accessibilityFocused($countFocused)
            Menu {
                Button("Play all matched", action: play).disabled(!enabled)
                Button("Show currently playing song", action: showPlaying).disabled(!canShowPlaying)
                Button("Clear all filters") { query.clear(); scrollTop(); countFocused = true }
                    .disabled(!query.narrowing)
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: DS.Icon.iconNav, weight: DS.Icon.iconWeight))
                    .foregroundStyle(DS.Color.ink)
                    .frame(width: DS.Control.control, height: DS.Control.control)
                    .background(Circle().fill(DS.Color.surface).dsShadow(DS.Shadow.depthSlab))
                    .frame(width: DS.Space.hit, height: DS.Space.hit)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Library actions")
        }
        .font(T.caption).monospacedDigit().fixedSize(horizontal: true, vertical: false)
        .frame(minHeight: DS.Space.hit)
    }

}

struct LibrarySortSheet: View {
    @EnvironmentObject private var query: LibraryQuery
    @Environment(\.dismiss) private var dismiss
    let listeningAvailable: Bool
    let scrollTop: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var rowsHeight: CGFloat = DS.Component.rowHeight * CGFloat(LibrarySort.allCases.count)
    @State private var titleHeight: CGFloat = DS.Component.fieldHeight

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            Text("Sort by").font(T.title).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader)
                .padding(.horizontal, DS.Space.space4)
                .measuredHeight($titleHeight)
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(LibrarySort.allCases) { criterion in
                        let disabled = criterion == .listened && !listeningAvailable
                        let enabledTint = query.sort == criterion ? DS.Color.accentInk : DS.Color.inkMuted
                        Button {
                            if criterion != query.sort { query.choose(criterion); scrollTop() }
                            dismiss()
                        } label: {
                            HStack(spacing: DS.Space.space3) {
                                Image(systemName: criterion.symbol).font(.system(size: DS.Icon.iconNav))
                                    .foregroundStyle(disabled ? DS.Color.inkFaint : enabledTint)
                                    .frame(width: DS.Icon.iconNav)
                                VStack(alignment: .leading, spacing: DS.Space.space1) {
                                    Text(criterion.rawValue).font(query.sort == criterion ? T.body.weight(.semibold) : T.body)
                                        .foregroundStyle(disabled ? DS.Color.inkFaint : DS.Color.ink)
                                    if disabled { Text("Sign in to use this").font(T.caption).foregroundStyle(DS.Color.inkFaint) }
                                }
                                Spacer()
                                if query.sort == criterion {
                                    Image(systemName: "checkmark").foregroundStyle(disabled ? DS.Color.inkFaint : DS.Color.accentInk)
                                }
                            }
                            .foregroundStyle(DS.Color.ink).frame(minHeight: DS.Component.rowHeight)
                            .padding(.horizontal, DS.Space.space4).contentShape(Rectangle())
                        }
                        .buttonStyle(LibraryPressStyle()).disabled(disabled)
                        .accessibilityAddTraits(query.sort == criterion ? .isSelected : [])
                        .accessibilityHint(disabled ? "Needs sign in and loaded listening data" : "")
                        if criterion != LibrarySort.allCases.last { LibraryHairline().padding(.horizontal, DS.Space.space4) }
                    }
                }.measuredHeight($rowsHeight)
            }.frame(maxHeight: rowsHeight).scrollBounceBehavior(.basedOnSize)
        }
        .padding(.top, DS.Space.space6).padding(.bottom, DS.Space.space4)
        .presentationDetents(typeSize.isAccessibilitySize ? [.large] : [.height(rowsHeight + titleHeight + DS.Space.space6 + DS.Space.space4 + DS.Space.space2), .large])
        .presentationDragIndicator(.visible).presentationCornerRadius(DS.Radius.radiusTray)
        .presentationBackground(DS.Color.surface).background(DS.Color.surface)
        .accessibilityAction(.escape) { dismiss() }
    }
}

struct LibraryHairline: View {
    var body: some View { Rectangle().fill(DS.Color.line).frame(height: DS.Stroke.strokeHairline).accessibilityHidden(true) }
}

struct LibraryEmpty<Actions: View>: View {
    let title: String
    let symbol: String
    let detail: String
    @ViewBuilder var actions: () -> Actions
    var body: some View {
        VStack(spacing: DS.Space.space3) {
            Image(systemName: symbol).font(.system(size: DS.Component.coverSm)).foregroundStyle(DS.Color.inkMuted)
                .accessibilityHidden(true)
            Text(title).font(T.headline).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader)
            Text(detail).font(T.body).foregroundStyle(DS.Color.inkMuted).multilineTextAlignment(.center)
            actions()
        }
        .frame(maxWidth: .infinity).padding(.vertical, DS.Space.space6).padding(.horizontal, DS.Space.space4)
    }
}

struct LibraryPrimaryStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(T.headline).foregroundStyle(enabled ? DS.Color.onAccent : DS.Color.inkMuted)
            .padding(.horizontal, DS.Space.space5).frame(minHeight: DS.Space.hit)
            .background {
                if enabled { Capsule().fill(DS.Color.accent).dsShadow(DS.Shadow.depthGlow) }
                else { Capsule().fill(DS.Color.accentTint) }
            }
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

struct LibrarySkeleton: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false
    private var opacity: Double {
        if reduceMotion { return 0.7 }
        return pulse ? 0.5 : 1
    }
    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<8) { index in
                HStack(spacing: DS.Space.space3) {
                    RoundedRectangle(cornerRadius: DS.Radius.radiusSm)
                        .frame(width: DS.Component.coverRow, height: DS.Component.coverRow)
                    GeometryReader { geometry in
                        VStack(alignment: .leading, spacing: DS.Space.space2) {
                            RoundedRectangle(cornerRadius: DS.Radius.radiusXs)
                                .frame(width: geometry.size.width * 0.6, height: DS.Icon.iconXs + DS.Stroke.strokeMedium)
                            RoundedRectangle(cornerRadius: DS.Radius.radiusXs)
                                .frame(width: geometry.size.width * 0.4, height: DS.Icon.iconXs)
                        }.frame(maxHeight: .infinity)
                    }
                    RoundedRectangle(cornerRadius: DS.Radius.radiusXs)
                        .frame(width: DS.Control.control, height: DS.Icon.iconXs)
                }
                .foregroundStyle(DS.Color.surfaceSunken).padding(DS.Space.space3)
                if index < 7 { LibraryHairline().padding(.horizontal, DS.Space.space3) }
            }
        }
        .opacity(opacity)
        .animation(reduceMotion ? nil : .dsPulse, value: pulse)
        .onAppear { pulse = true }.onChange(of: reduceMotion) { _, _ in pulse = true }
        .librarySlab().accessibilityElement(children: .ignore).accessibilityLabel("Loading your library")
    }
}
