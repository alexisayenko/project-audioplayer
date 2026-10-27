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

private struct OpenSettingsKey: EnvironmentKey {
    static let defaultValue: (() -> Void)? = nil
}

extension EnvironmentValues {
    var openSettings: (() -> Void)? {
        get { self[OpenSettingsKey.self] }
        set { self[OpenSettingsKey.self] = newValue }
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

private struct DrawerRowStyle: ButtonStyle {
    let onPress: () -> Void

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.6 : 1)
            .onChange(of: configuration.isPressed) { _, pressed in if pressed { onPress() } }
    }
}

/// A drawer row: a standard button that activates on release inside the row, dims while pressed, and does nothing when the touch turned into a sideways swipe (swiping left closes the drawer).
private struct DrawerRowButton<Label: View>: View {
    let action: () -> Void
    @ViewBuilder let label: () -> Label
    @State private var swiped = false

    var body: some View {
        Button {
            if !swiped { action() }
        } label: { label() }
            .buttonStyle(DrawerRowStyle { swiped = false })
            .simultaneousGesture(DragGesture(minimumDistance: 10).onChanged { if abs($0.translation.width) > 10 { swiped = true } })
    }
}

@MainActor
final class PushedScreens: ObservableObject {
    @Published private(set) var ids: Set<UUID> = []
    var hasPushed: Bool { !ids.isEmpty }

    func update(_ id: UUID, pushed: Bool) {
        if pushed {
            if !ids.contains(id) { ids.insert(id) }
        } else if ids.contains(id) {
            ids.remove(id)
        }
    }
}

private struct PushedScreensKey: EnvironmentKey {
    static let defaultValue: PushedScreens? = nil
}

private struct PageActiveKey: EnvironmentKey {
    static let defaultValue = true
}

extension EnvironmentValues {
    var pushedScreens: PushedScreens? {
        get { self[PushedScreensKey.self] }
        set { self[PushedScreensKey.self] = newValue }
    }

    /// False for a page that stays alive but is not the one on screen.
    var pageActive: Bool {
        get { self[PageActiveKey.self] }
        set { self[PageActiveKey.self] = newValue }
    }
}

private struct PushedScreenModifier: ViewModifier {
    @Environment(\.pushedScreens) private var registry
    @Environment(\.pageActive) private var pageActive
    @State private var id = UUID()
    @State private var appeared = false

    func body(content: Content) -> some View {
        content
            .background(LibraryBackSwipe())
            .onAppear { appeared = true; report() }
            .onDisappear { appeared = false; report() }
            .onChange(of: pageActive) { report() }
    }

    private func report() { registry?.update(id, pushed: appeared && pageActive) }
}

extension View {
    /// Marks a screen pushed on a navigation stack: the system back swipe stays free while it is shown, because the drawer's edge swipe steps aside.
    func pushedScreen() -> some View { modifier(PushedScreenModifier()) }
}

/// Opens the drawer from a swipe at the leading edge; absent while a pushed screen is shown, so the system back swipe wins there.
struct DrawerEdgeSwipe: View {
    @ObservedObject var pushed: PushedScreens
    let open: () -> Void

    var body: some View {
        if !pushed.hasPushed {
            Color.clear.frame(width: DS.Space.space5).contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 12).onEnded { if $0.translation.width > 40 { open() } })
                .accessibilityHidden(true)
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
    @Environment(\.dynamicTypeSize) private var dynamicType
    @AccessibilityFocusState private var titleFocused: Bool
    @ScaledMetric(relativeTo: .title3) private var icon: CGFloat = DS.Icon.iconNavLg
    @ScaledMetric(relativeTo: .title3) private var iconFrame: CGFloat = DS.Component.navIconFrame
    @ScaledMetric(relativeTo: .title3) private var logo: CGFloat = 42
    @ScaledMetric(relativeTo: .title3) private var brandLockupHeight: CGFloat = DS.Component.navRowHeight

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
                        .frame(width: dynamicType.isAccessibilitySize ? geo.size.width * 0.92 : min(geo.size.width * 0.75, 320))
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
            VStack(alignment: .leading, spacing: 0) {
                let layout = dynamicType.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: DS.Space.space3)) : AnyLayout(HStackLayout(spacing: DS.Space.space3))
                layout {
                    Image("DrawerLogo").resizable().scaledToFit()
                        .frame(width: logo, height: logo)
                        .clipShape(Circle())
                        .accessibilityHidden(true)
                    Image("ElectrophoneVega108Lockup").resizable().scaledToFit()
                        .frame(maxWidth: .infinity, maxHeight: brandLockupHeight, alignment: .trailing)
                        .accessibilityLabel("Electrophone Vega 108")
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityFocused($titleFocused)
                }
                .padding(.horizontal, DS.Space.space6).padding(.bottom, DS.Space.space6)
                ForEach(AppTab.allCases, id: \.self) { item($0) }
            }
            .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space4)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { account }
        .background(
            UnevenRoundedRectangle(bottomTrailingRadius: DS.Radius.radiusTray, topTrailingRadius: DS.Radius.radiusTray, style: .continuous)
                .fill(DS.Color.surface).dsShadow(DS.Shadow.depthDrawer).ignoresSafeArea()
        )
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityAction(.escape, close)
        .accessibilityAction(named: "Close menu", close)
        .task { try? await Task.sleep(for: .milliseconds(150)); titleFocused = true }
    }

        private func row(symbol: String, label: String, active: Bool = false, lines: Int = 2) -> some View {
        HStack(spacing: DS.Space.space3) {
            Image(systemName: symbol).symbolRenderingMode(.monochrome)
                .font(.system(size: min(icon, DS.Icon.iconNavLg * 1.8), weight: DS.Icon.iconWeight))
                .foregroundStyle(active ? DS.Color.selectInk : DS.Color.inkMuted)
                .frame(width: min(iconFrame, DS.Component.navIconFrame * 1.8))
            Text(label).font(T.body.weight(active ? .semibold : .medium))
                .foregroundStyle(active ? DS.Color.selectInk : DS.Color.ink)
                .lineLimit(lines).minimumScaleFactor(0.6).truncationMode(.middle)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, DS.Space.space3)
        .frame(maxWidth: .infinity, minHeight: DS.Component.navRowHeight, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: DS.Radius.radiusSelect, style: .continuous)
            .fill(active ? DS.Color.selectTint : Color.clear)
            .padding(.vertical, DS.Space.space1))
        .contentShape(Rectangle())
    }

    private func item(_ tab: AppTab) -> some View {
        let active = tab == selection
        return DrawerRowButton(action: { select(tab) }) { row(symbol: tab.symbol, label: tab.title, active: active) }
            .accessibilityLabel(tab.title)
            .accessibilityAddTraits(active ? [.isSelected, .isButton] : .isButton)
    }

    private var account: some View {
        let email = auth.session.map { $0.email ?? "Signed in" }
        return VStack(alignment: .leading, spacing: DS.Space.space2) {
            Rectangle().fill(DS.Color.line).frame(height: DS.Stroke.strokeHairline)
                .padding(.horizontal, DS.Space.space6)
            DrawerRowButton(action: { select(.settings) }) {
                row(symbol: "person.crop.circle", label: email ?? "Sign in", lines: 1)
            }
            .accessibilityLabel(email.map { "Account, \($0)" } ?? "Sign in")
            .accessibilityAddTraits(.isButton)
        }
        .padding(.horizontal, DS.Space.space3).padding(.top, DS.Space.space2).padding(.bottom, DS.Space.space2)
    }
}
