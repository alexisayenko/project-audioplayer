import XCTest
@testable import AudioPlayer

final class LibraryIndexTests: XCTestCase {
    private var dir: URL!
    private var index: LibraryIndex!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("library-index-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        index = LibraryIndex(catalogURL: dir.appendingPathComponent("library.json"), phoneURL: dir.appendingPathComponent("phone-index.json"))
        AudioFiles.load(nil)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
        AudioFiles.load(nil)
    }

    private let on = Track(id: "aaaaaaaaaaa", title: "On Phone", artist: "Artist")
    private let off = Track(id: "bbbbbbbbbbb", title: "Not Here", artist: "Artist")
    private let names = ["aaaaaaaaaaa": "Artist - On Phone.m4a"]

    private func saved(etag: String? = "tag") {
        index.save(etag: etag, songs: [on, off], files: names, phoneIDs: [on.id])
    }

    private func copies(of url: URL) -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).filter { $0.hasPrefix(url.lastPathComponent + ".corrupt-") }
    }

    private func overwrite(_ url: URL, with text: String) throws {
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    func testNothingOnDiskLoadsEmptyWithoutACopy() {
        let loaded = index.load()
        XCTAssertTrue(loaded.songs.isEmpty)
        XCTAssertTrue(loaded.files.isEmpty)
        XCTAssertFalse(loaded.recovered)
        XCTAssertFalse(FileManager.default.fileExists(atPath: index.goodURL.path))
    }

    func testSavedIndexLoadsBackWithItsEtagAndFileMap() {
        saved()
        let loaded = index.load()
        XCTAssertEqual(loaded.songs.map(\.id), [on.id, off.id])
        XCTAssertEqual(loaded.files, names)
        XCTAssertEqual(loaded.etag, "tag")
        XCTAssertFalse(loaded.recovered)
    }

    func testPhoneIndexHoldsOnlyTheSongsOnThePhone() throws {
        saved()
        let text = try String(contentsOf: index.phoneURL, encoding: .utf8)
        XCTAssertTrue(text.contains(on.id))
        XCTAssertFalse(text.contains(off.id))
    }

    func testACorruptCatalogFallsBackToTheLastGoodCopy() throws {
        saved()
        _ = index.load()
        XCTAssertTrue(FileManager.default.fileExists(atPath: index.goodURL.path))
        try overwrite(index.catalogURL, with: "{\"songs\": [")
        let loaded = index.load()
        XCTAssertEqual(loaded.songs.map(\.id), [on.id, off.id])
        XCTAssertEqual(loaded.files, names)
        XCTAssertTrue(loaded.recovered)
        XCTAssertNil(loaded.etag)
        XCTAssertEqual(copies(of: index.catalogURL).count, 1)
    }

    func testACorruptCatalogWithoutAGoodCopyStillKeepsTheSongsOnThePhone() throws {
        saved()
        try overwrite(index.catalogURL, with: "not json")
        let loaded = index.load()
        XCTAssertEqual(loaded.songs.map(\.id), [on.id])
        XCTAssertEqual(loaded.files, names)
        XCTAssertTrue(loaded.recovered)
        XCTAssertEqual(copies(of: index.catalogURL).count, 1)
    }

    func testAMissingCatalogIsRebuiltFromThePhoneIndex() throws {
        saved()
        try FileManager.default.removeItem(at: index.catalogURL)
        let loaded = index.load()
        XCTAssertEqual(loaded.songs.map(\.id), [on.id])
        XCTAssertEqual(loaded.files, names)
        XCTAssertNil(loaded.etag)
    }

    func testACorruptPhoneIndexKeepsTheCatalogAndItsFileMap() throws {
        saved()
        try overwrite(index.phoneURL, with: "{")
        let loaded = index.load()
        XCTAssertEqual(loaded.songs.map(\.id), [on.id, off.id])
        XCTAssertEqual(loaded.files, names)
        XCTAssertTrue(loaded.recovered)
        XCTAssertEqual(copies(of: index.phoneURL).count, 1)
    }

    func testBothFilesCorruptLoadsEmptyAndKeepsBothCopies() throws {
        saved()
        try overwrite(index.catalogURL, with: "x")
        try overwrite(index.phoneURL, with: "y")
        let loaded = index.load()
        XCTAssertTrue(loaded.songs.isEmpty)
        XCTAssertTrue(loaded.recovered)
        XCTAssertEqual(copies(of: index.catalogURL).count, 1)
        XCTAssertEqual(copies(of: index.phoneURL).count, 1)
    }

    func testOneUnreadableSongRecordIsDroppedNotTheWholeCatalog() throws {
        try overwrite(index.catalogURL, with: """
        {"etag": "tag", "schema": 2, "songs": [{"id": "aaaaaaaaaaa", "title": "On Phone", "artist": "Artist"}, {"id": 5}, {"title": "no id"}],
         "files": {"aaaaaaaaaaa": "Artist - On Phone.m4a"}}
        """)
        let loaded = index.load()
        XCTAssertEqual(loaded.songs.map(\.id), ["aaaaaaaaaaa"])
        XCTAssertEqual(loaded.files, names)
        XCTAssertTrue(loaded.recovered)
        XCTAssertNil(loaded.etag, "the next sync must refetch the catalog")
    }

    func testAnOldPlainSongArrayStillLoads() throws {
        try overwrite(index.catalogURL, with: "[{\"id\": \"aaaaaaaaaaa\", \"title\": \"On Phone\", \"artist\": \"Artist\"}]")
        let loaded = index.load()
        XCTAssertEqual(loaded.songs.map(\.id), ["aaaaaaaaaaa"])
        XCTAssertNil(loaded.etag)
        XCTAssertFalse(loaded.recovered)
    }

    func testAnOlderSchemaDropsTheEtagOnly() throws {
        try overwrite(index.catalogURL, with: "{\"etag\": \"old\", \"schema\": 1, \"songs\": [{\"id\": \"aaaaaaaaaaa\", \"title\": \"T\", \"artist\": \"A\"}]}")
        let loaded = index.load()
        XCTAssertNil(loaded.etag)
        XCTAssertEqual(loaded.songs.count, 1)
        XCTAssertFalse(loaded.recovered)
    }

    func testAnEmptyCatalogDoesNotReplaceTheLastGoodCopy() {
        saved()
        _ = index.load()
        let before = try? Data(contentsOf: index.goodURL)
        index.save(etag: nil, songs: [], files: [:], phoneIDs: [])
        _ = index.load()
        XCTAssertEqual(try? Data(contentsOf: index.goodURL), before)
    }

    func testTheFileMapSurvivesIntoPlaybackPathsAfterARecovery() throws {
        saved()
        try overwrite(index.catalogURL, with: "{")
        AudioFiles.load(index.load().files)
        XCTAssertEqual(AudioFiles.url(for: on.id).lastPathComponent, "Artist - On Phone.m4a")
    }
}

final class AudioFilesAdoptTests: XCTestCase {
    private var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("audio-adopt-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        AudioFiles.load(nil)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
        AudioFiles.load(nil)
    }

    private func touch(_ name: String) {
        FileManager.default.createFile(atPath: dir.appendingPathComponent(name).path, contents: Data("x".utf8))
    }

    func testFilesNamedForTheirSongAreTiedBackToTheirIds() {
        touch("Artist - One.m4a")
        touch("Artist - Same.m4a")
        touch("Artist - Same (2).m4a")
        let tracks = [
            Track(id: "aaaaaaaaaaa", title: "One", artist: "Artist"),
            Track(id: "bbbbbbbbbbb", title: "Same", artist: "Artist"),
            Track(id: "ccccccccccc", title: "Same", artist: "Artist"),
            Track(id: "ddddddddddd", title: "Missing", artist: "Artist"),
        ]
        XCTAssertTrue(AudioFiles.adopt(tracks, in: dir))
        XCTAssertEqual(AudioFiles.url(for: "aaaaaaaaaaa").lastPathComponent, "Artist - One.m4a")
        XCTAssertEqual(AudioFiles.url(for: "bbbbbbbbbbb").lastPathComponent, "Artist - Same.m4a")
        XCTAssertEqual(AudioFiles.url(for: "ccccccccccc").lastPathComponent, "Artist - Same (2).m4a")
        XCTAssertEqual(AudioFiles.url(for: "ddddddddddd").lastPathComponent, "ddddddddddd.m4a")
    }

    func testASongWithALegacyFileOrAnEntryIsLeftAlone() {
        touch("ccccccccccc.m4a")
        touch("Artist - Kept.m4a")
        touch("Artist - Other.m4a")
        AudioFiles.load(["aaaaaaaaaaa": "Artist - Kept.m4a"])
        let tracks = [
            Track(id: "aaaaaaaaaaa", title: "Other", artist: "Artist"),
            Track(id: "ccccccccccc", title: "Other", artist: "Artist"),
        ]
        XCTAssertFalse(AudioFiles.adopt(tracks, in: dir))
        XCTAssertEqual(AudioFiles.url(for: "aaaaaaaaaaa").lastPathComponent, "Artist - Kept.m4a")
        XCTAssertEqual(AudioFiles.url(for: "ccccccccccc").lastPathComponent, "ccccccccccc.m4a")
    }

    func testAFileAnotherSongOwnsIsNotTaken() {
        touch("Artist - Same.m4a")
        AudioFiles.load(["zzzzzzzzzzz": "Artist - Same.m4a"])
        XCTAssertFalse(AudioFiles.adopt([Track(id: "aaaaaaaaaaa", title: "Same", artist: "Artist")], in: dir))
    }
}
