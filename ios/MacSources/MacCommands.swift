import AppKit
import SwiftUI

/// Space and the arrow keys are handled here instead of as menu key equivalents so a focused text field or sheet keeps them.
@MainActor
enum MacKeys {
    private static var monitor: Any?

    static func install(_ player: PlayerService) {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            let handled = MainActor.assumeIsolated { handle(event, player) }
            return handled ? nil : event
        }
    }

    private static func handle(_ event: NSEvent, _ player: PlayerService) -> Bool {
        guard let window = event.window, window.attachedSheet == nil, window.sheetParent == nil,
              !(window.firstResponder is NSText), player.current != nil else { return false }
        let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.numericPad, .function])
        switch (event.keyCode, mods) {
        case (49, []):
            if !event.isARepeat { player.toggle() }
        case (124, []): player.skip(by: 5)
        case (123, []): player.skip(by: -5)
        case (124, .shift): player.skip(by: 15)
        case (123, .shift): player.skip(by: -15)
        case (124, .command): if player.hasNext { player.next() }
        case (123, .command): player.previous()
        case (126, .command): player.volume = min(player.volume + 0.05, 1)
        case (125, .command): player.volume = max(player.volume - 0.05, 0)
        default: return false
        }
        return true
    }
}

struct MacCommands: Commands {
    @ObservedObject var player: PlayerService
    let nav: MacNavigation

    var body: some Commands {
        CommandMenu("Playback") {
            Button(player.isPlaying ? "Pause (Space)" : "Play (Space)") { player.toggle() }
                .disabled(player.current == nil)
            Button("Next (\u{2318}\u{2192})") { player.next() }
                .disabled(!player.hasNext)
            Button("Previous (\u{2318}\u{2190})") { player.previous() }
                .disabled(player.current == nil)
            Divider()
            Button("Seek Forward 5 s (\u{2192})") { player.skip(by: 5) }.disabled(player.current == nil)
            Button("Seek Back 5 s (\u{2190})") { player.skip(by: -5) }.disabled(player.current == nil)
            Button("Seek Forward 15 s (\u{21E7}\u{2192})") { player.skip(by: 15) }.disabled(player.current == nil)
            Button("Seek Back 15 s (\u{21E7}\u{2190})") { player.skip(by: -15) }.disabled(player.current == nil)
            Divider()
            Button("Volume Up (\u{2318}\u{2191})") { player.volume = min(player.volume + 0.05, 1) }
            Button("Volume Down (\u{2318}\u{2193})") { player.volume = max(player.volume - 0.05, 0) }
            Divider()
            Toggle("Shuffle", isOn: $player.shuffle).keyboardShortcut("s", modifiers: [.option, .command])
            Button("Repeat: \(player.repeatMode.spokenName)") { player.repeatMode = player.repeatMode.next }
                .keyboardShortcut("r", modifiers: [.option, .command])
            Divider()
            Button("Clear Queue") { player.clearQueue() }.disabled(player.queue.count < 2)
        }
        CommandGroup(replacing: .newItem) {
            Button("Add Song...") { nav.page = .library; nav.addRequested = true }
                .keyboardShortcut("n", modifiers: .command)
        }
        CommandGroup(after: .sidebar) {
            Button("Library") { nav.page = .library }.keyboardShortcut("1", modifiers: .command)
            Button("Playback") { nav.page = .playback }.keyboardShortcut("2", modifiers: .command)
            Button("Settings") { nav.page = .settings }.keyboardShortcut(",", modifiers: .command)
        }
    }
}
