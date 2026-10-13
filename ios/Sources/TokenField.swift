import SwiftUI
import UniformTypeIdentifiers

extension UTType {
    static let tokenPill = UTType(exportedAs: "com.alexisayenko.audioplayer.token-pill")
}

/// What a dragged pill carries: its field and its token index (IOS-066). Only this app's fields accept the type.
struct TokenDrag: Codable, Transferable {
    let kind: TokenKind
    let index: Int

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .tokenPill)
    }
}

enum TokenKind: String, Codable, CaseIterable {
    case title, artist, remixer

    var label: String {
        switch self {
        case .title: "Title"
        case .artist: "Artist"
        case .remixer: "Remix & additional production"
        }
    }

    var moveName: String {
        switch self {
        case .title: "Title"
        case .artist: "Artist"
        case .remixer: "Remix"
        }
    }

    var sep: String {
        switch self {
        case .title: " - "
        case .artist: ", "
        case .remixer: " "
        }
    }
}

struct TokenMove {
    let kind: TokenKind
    let text: Binding<String>
}

/// Title, Artist or Remix as wrapped pills over ONE plain string (ADD-071, ADD-072, IOS-065).
struct TokenField: View {
    let kind: TokenKind
    @Binding var text: String
    let moves: [TokenMove]

    @State private var committed: String
    @State private var pending = ""
    @State private var tail = false
    @State private var lastWritten: String
    @State private var editing: Int?
    @State private var editOriginal = ""
    @State private var editText = ""
    @State private var fieldTargeted = false
    @State private var targetedPill: Int?

    private enum Focus: Hashable { case entry, edit }
    @FocusState private var focus: Focus?

    init(kind: TokenKind, text: Binding<String>, moves: [TokenMove]) {
        self.kind = kind
        _text = text
        self.moves = moves
        _committed = State(initialValue: text.wrappedValue)
        _lastWritten = State(initialValue: text.wrappedValue)
    }

    private var shown: [(index: Int, text: String)] {
        Tokens.tokenize(committed).enumerated().compactMap { i, t in
            Tokens.isBlank(t) ? nil : (i, t.text.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }

    private func read() -> String {
        let blank = pending.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let t = blank ? committed : Tokens.appendToken(committed, pending, kind.sep)
        return tail && blank ? Tokens.stripEdges(t) : t
    }

    private func push() {
        let v = read()
        lastWritten = v
        text = v
    }

    private func commitPending() {
        guard !pending.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        committed = Tokens.appendToken(committed, pending, kind.sep)
        pending = ""
        tail = false
        push()
    }

    private func finishEdit() {
        guard let i = editing else { return }
        editing = nil
        if editText.trimmingCharacters(in: .whitespacesAndNewlines) != editOriginal {
            committed = Tokens.replaceToken(committed, i, editText)
            tail = false
            push()
        }
    }

    private func startEdit(_ i: Int, _ label: String) {
        commitPending()
        editOriginal = label
        editText = label
        editing = i
        focus = .edit
    }

    private func remove(_ i: Int) {
        editing = nil
        committed = Tokens.removeToken(committed, i)
        tail = false
        push()
    }

    private func move(_ i: Int, to target: TokenMove) {
        let r = Tokens.moveToken(committed, i, target.text.wrappedValue, target.kind.sep)
        committed = r.src
        tail = false
        push()
        target.text.wrappedValue = r.dst
    }

    private func drop(_ d: TokenDrag, at index: Int) -> Bool {
        editing = nil
        if d.kind == kind {
            let r = Tokens.moveTokenTo(src: committed, index: d.index, dst: committed, dstIndex: index, dstDefaultSep: kind.sep, sameField: true)
            guard r.dst != committed else { return false }
            committed = r.dst
        } else {
            guard let from = moves.first(where: { $0.kind == d.kind }) else { return false }
            let r = Tokens.moveTokenTo(src: from.text.wrappedValue, index: d.index, dst: committed, dstIndex: index, dstDefaultSep: kind.sep, sameField: false)
            guard r.src != from.text.wrappedValue || r.dst != committed else { return false }
            committed = r.dst
            from.text.wrappedValue = r.src
        }
        tail = false
        push()
        return true
    }

    var body: some View {
        FlowLayout(spacing: DS.Space.space2) {
            ForEach(shown, id: \.index) { item in
                if editing == item.index { editor } else { pill(item.index, item.text) }
            }
            TextField("", text: $pending, prompt: shown.isEmpty && editing == nil ? Text(kind.label) : nil)
                .accessibilityLabel(kind.label)
                .focused($focus, equals: .entry)
                .frame(minHeight: 36)
                .flowFill(minWidth: 80)
                .onSubmit { commitPending(); focus = .entry }
        }
        .padding(.vertical, DS.Space.space1)
        .frame(maxWidth: .infinity, alignment: .leading)
        .dsField()
        .contentShape(Rectangle())
        .overlay {
            if fieldTargeted {
                RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous).strokeBorder(DS.Color.accent, lineWidth: 2)
            }
        }
        .dropDestination(for: TokenDrag.self) { items, _ in
            guard let d = items.first else { return false }
            return drop(d, at: .max)
        } isTargeted: { fieldTargeted = $0 }
        .onTapGesture { focus = .entry }
        .accessibilityElement(children: .contain)
        .onChange(of: text) { _, new in
            guard new != lastWritten else { return }
            committed = new
            pending = ""
            tail = false
            editing = nil
            lastWritten = new
        }
        .onChange(of: pending) { _, new in
            let r = Tokens.commitTyped(committed, new, kind.sep)
            if r.rest != new {
                committed = r.value
                tail = true
                pending = r.rest
            }
            push()
        }
        .onChange(of: focus) { old, new in
            if old == .edit && new != .edit { finishEdit() }
            if old == .entry && new != .entry {
                commitPending()
                if tail { committed = Tokens.stripEdges(committed); tail = false; push() }
            }
        }
    }

    private var editor: some View {
        TextField("", text: $editText)
            .accessibilityLabel("Edit \(editOriginal)")
            .focused($focus, equals: .edit)
            .padding(.horizontal, DS.Space.space3).frame(minHeight: 36, maxHeight: 36)
            .frame(minWidth: 120)
            .background(Capsule().fill(DS.Color.accentTint))
            .onSubmit { finishEdit(); focus = .entry }
    }

    private func pill(_ i: Int, _ label: String) -> some View {
        HStack(spacing: 0) {
            Menu {
                Button("Edit text") { startEdit(i, label) }
                ForEach(moves, id: \.kind) { m in
                    Button("Move to \(m.kind.moveName)") { move(i, to: m) }
                }
                Button("Remove", role: .destructive) { remove(i) }
            } label: {
                Image(systemName: "pencil").font(.system(size: 12, weight: .semibold)).foregroundStyle(DS.Color.accentInk)
                    .frame(width: 30, height: 36).contentShape(Rectangle())
            }
            .accessibilityLabel("Edit \(label)")
            Text(label).font(T.subhead.weight(.medium)).foregroundStyle(DS.Color.ink).lineLimit(1)
            Button { remove(i) } label: {
                Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(DS.Color.accentInk)
                    .frame(width: 30, height: 36).contentShape(Rectangle())
            }
            .buttonStyle(.plain).accessibilityLabel("Remove \(label)")
        }
        .background(Capsule().fill(DS.Color.accentTint))
        .overlay(alignment: .leading) {
            if targetedPill == i {
                Capsule().fill(DS.Color.accent).frame(width: 3, height: 36).offset(x: -(DS.Space.space2 / 2 + 1.5))
            }
        }
        .draggable(TokenDrag(kind: kind, index: i)) {
            Text(label).font(T.subhead.weight(.medium)).foregroundStyle(DS.Color.ink).lineLimit(1)
                .padding(.horizontal, DS.Space.space3).frame(height: 36)
                .background(Capsule().fill(DS.Color.accentTint))
        }
        .dropDestination(for: TokenDrag.self) { items, _ in
            guard let d = items.first else { return false }
            return drop(d, at: i)
        } isTargeted: { on in
            if on { targetedPill = i } else if targetedPill == i { targetedPill = nil }
        }
    }
}
