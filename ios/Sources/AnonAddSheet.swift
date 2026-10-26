import SwiftUI

/// The Add sheet while nobody is signed in: a pasted link goes to the account-free download; search needs a sign-in.
struct AnonAddSheet: View {
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var anon: AnonDownloader
    @Environment(\.openSettings) private var openSettings
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var url = ""
    @State private var starting = false
    @State private var startError: String?
    @State private var jobID: String?
    @State private var contentHeight: CGFloat = 0

    private var known: Track? { jobID == nil ? libraryMatch(link: url, in: library.songs) : nil }
    private var state: AnonJobState? { jobID.flatMap { anon.states[$0] } }
    private var running: Bool { starting || (jobID != nil && state?.failed != true) }
    private var fetchOff: Bool { running || url.trimmingCharacters(in: .whitespaces).isEmpty || known != nil }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.space4) {
                header
                if let jobID, let state { progressCard(jobID, state) } else { linkField }
                signInHint
            }
            .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space6).padding(.bottom, DS.Space.space4)
            .measuredHeight($contentHeight)
        }
        .scrollBounceBehavior(.basedOnSize)
        .scrollDismissesKeyboard(.interactively)
        .background(DS.Color.surface.ignoresSafeArea())
        .presentationDetents(contentHeight > 0 ? [.height(contentHeight + 12)] : [.medium])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(DS.Radius.radiusTray)
        .presentationBackground(DS.Color.surface)
        .onChange(of: state?.finished) { _, done in
            if done == true, let jobID { anon.dismiss(jobID); dismiss() }
        }
        .sensoryFeedback(.success, trigger: state?.finished == true)
        .task { anon.resumePending(library: library) }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text("Add a song").font(T.title).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader)
                Spacer(minLength: DS.Space.space2)
                Button(jobID == nil ? "Cancel" : "Close") { close() }
                    .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                    .frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit)
            }
            .padding(.bottom, -DS.Space.space2)
            Text("YouTube link or video id, or SoundCloud link; stored on this iPhone, no account needed").dsCaption()
        }
    }

    private func close() {
        if let jobID, state?.failed == true || state?.finished == true { anon.dismiss(jobID) }
        dismiss()
    }

    private func start() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        let link = cleanPasted(url)
        url = link
        guard !link.isEmpty, !running else { return }
        starting = true; startError = nil
        Task {
            defer { starting = false }
            do {
                jobID = try await anon.start(url: link, serverURL: settings.serverURL, library: library)
            } catch {
                if !(error is CancellationError) {
                    startError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                }
            }
        }
    }

    private var linkField: some View {
        VStack(alignment: .leading, spacing: DS.Space.space1) {
            HStack(spacing: DS.Space.space2) {
                TextField("YouTube or SoundCloud link", text: $url)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    .submitLabel(.go).font(T.subhead).frame(minHeight: 44).foregroundStyle(DS.Color.ink)
                    .onSubmit { start() }
                    .onChange(of: url) { old, new in
                        if new.count - old.count > 1 { let c = cleanPasted(new); if c != new { url = c } }
                    }
                Button { start() } label: {
                    Group { if starting { ProgressView().tint(scheme.onStrong) } else { Text("Add") } }
                        .font(T.subhead.weight(.semibold)).foregroundStyle(scheme.onStrong)
                        .padding(.horizontal, 14).frame(minWidth: 64, minHeight: 36)
                        .background(Capsule().fill(scheme.strongFill))
                }
                .buttonStyle(.plain)
                .disabled(fetchOff)
                .opacity(fetchOff ? 0.5 : 1)
            }
            .padding(.leading, DS.Space.space4).padding(.trailing, DS.Space.space2).frame(minHeight: 48)
            .background(RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous).fill(DS.Color.surfaceSunken))
            .overlay {
                if startError != nil { RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous).strokeBorder(DS.Color.power, lineWidth: 1.5) }
            }
            if let known {
                FormNote(text: "Already in your library: \(known.title) \u{00B7} \(known.artist)")
            }
            if let startError { FormNote(text: startError, error: true).padding(.top, DS.Space.space2) }
        }
    }

    private func progressCard(_ id: String, _ s: AnonJobState) -> some View {
        VStack(alignment: .leading, spacing: DS.Space.space3) {
            VStack(alignment: .leading, spacing: 2) {
                Text(s.title ?? "Looking up the link\u{2026}").font(T.headline).foregroundStyle(DS.Color.ink).lineLimit(2)
                if let artist = s.artist, !artist.isEmpty { Text(artist).font(T.subhead).foregroundStyle(DS.Color.inkMuted).lineLimit(1) }
            }
            if s.failed {
                FormNote(text: s.message ?? AnonError.message(forCode: nil), error: true)
                Button("Try another link") { anon.dismiss(id); jobID = nil; startError = nil }
                    .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk).frame(minHeight: DS.Space.hit)
            } else {
                ProgressView(value: min(1, max(0, s.progress))).tint(DS.Color.accent)
                    .accessibilityLabel("Adding song").accessibilityValue("\(Int(s.progress * 100)) percent")
                Text(statusLine(s)).dsCaption()
                if let m = s.message { FormNote(text: m) }
            }
        }
    }

    private func statusLine(_ s: AnonJobState) -> String {
        if s.waiting { return "Waiting for the server\u{2026}" }
        return s.progress < 0.8 ? "The server is fetching the song\u{2026}" : "Copying to this iPhone\u{2026} \(Int(s.progress * 100))%"
    }

    private var signInHint: some View {
        HStack(spacing: DS.Space.space2) {
            Image(systemName: "magnifyingglass").foregroundStyle(DS.Color.inkMuted).accessibilityHidden(true)
            Text("Sign in to search").font(T.subhead).foregroundStyle(DS.Color.inkMuted)
            Spacer(minLength: DS.Space.space2)
            Button("Sign in") { dismiss(); openSettings?() }
                .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                .frame(minHeight: DS.Space.hit)
        }
        .accessibilityElement(children: .combine)
    }
}
