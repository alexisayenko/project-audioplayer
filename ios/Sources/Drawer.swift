import SwiftUI

private struct OpenMenuKey: EnvironmentKey {
    static let defaultValue: (() -> Void)? = nil
}

extension EnvironmentValues {
    var openMenu: (() -> Void)? {
        get { self[OpenMenuKey.self] }
        set { self[OpenMenuKey.self] = newValue }
    }
}

/// Hamburger at the leading edge of a root screen header; absent when no drawer is installed.
struct MenuButton: View {
    @Environment(\.openMenu) private var openMenu
    @ScaledMetric(relativeTo: .title3) private var icon: CGFloat = 22

    var body: some View {
        if let openMenu {
            Button(action: openMenu) {
                Image(systemName: "line.3.horizontal").font(.system(size: min(icon, DS.Space.hit * 0.75), weight: .semibold))
                    .foregroundStyle(DS.Color.ink).frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open menu")
        }
    }
}

/// Left panel with the main menu: a scrim plus a surface slab sliding in from the leading edge.
struct SideDrawer: View {
    let open: Bool
    @Binding var selection: AppTab
    let close: () -> Void
    let select: (AppTab) -> Void

    @ObservedObject private var auth = AuthService.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AccessibilityFocusState private var titleFocused: Bool
    @ScaledMetric(relativeTo: .title3) private var icon: CGFloat = 22

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                if open {
                    Button(action: close) { DS.Color.vinyl.opacity(0.45).ignoresSafeArea() }
                        .buttonStyle(.plain)
                        .keyboardShortcut(.cancelAction)
                        .accessibilityLabel("Close menu")
                        .transition(.opacity)
                    panel
                        .frame(width: min(geo.size.width * 0.8, 320))
                        .transition(.move(edge: .leading))
                        .zIndex(1)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .simultaneousGesture(DragGesture(minimumDistance: 20).onEnded { if $0.translation.width < -40 { close() } })
            .animation(reduceMotion ? nil : .easeOut(duration: 0.25), value: open)
        }
        .allowsHitTesting(open)
    }

    private var panel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.space2) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Electrophone").font(T.title).foregroundStyle(DS.Color.ink)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityFocused($titleFocused)
                    Text("Offline music player").dsCaption()
                }
                .padding(.horizontal, DS.Space.space3).padding(.bottom, DS.Space.space4)
                ForEach(AppTab.allCases, id: \.self) { item($0) }
            }
            .padding(DS.Space.space4)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { account }
        .background(
            UnevenRoundedRectangle(bottomTrailingRadius: DS.Radius.radiusTray, topTrailingRadius: DS.Radius.radiusTray, style: .continuous)
                .fill(DS.Color.surface).shadow(color: DS.Color.vinyl.opacity(0.3), radius: 12, x: 4).ignoresSafeArea()
        )
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityAction(.escape, close)
        .accessibilityAction(named: "Close menu", close)
        .task { try? await Task.sleep(for: .milliseconds(150)); titleFocused = true }
    }

    private func item(_ tab: AppTab) -> some View {
        let active = tab == selection
        return Button { select(tab) } label: {
            HStack(spacing: DS.Space.space3) {
                Image(systemName: tab.symbol).font(.system(size: icon, weight: active ? .semibold : .regular))
                    .foregroundStyle(active ? DS.Color.accent : DS.Color.inkMuted)
                    .frame(width: icon * 1.4)
                Text(tab.title).font(T.headline).foregroundStyle(active ? DS.Color.accentInk : DS.Color.ink)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, DS.Space.space3)
            .frame(maxWidth: .infinity, minHeight: DS.Space.hit + DS.Space.space2, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous)
                .fill(active ? DS.Color.accentTint : Color.clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(active ? [.isSelected, .isButton] : .isButton)
    }

    private var account: some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(DS.Color.line).frame(height: 1)
            Text(auth.session.map { $0.email ?? "Signed in" } ?? "Not signed in").dsCaption()
                .lineLimit(1).truncationMode(.middle)
                .frame(maxWidth: .infinity, minHeight: DS.Space.hit, alignment: .leading)
                .padding(.horizontal, DS.Space.space4)
        }
        .accessibilityElement(children: .combine)
    }
}
