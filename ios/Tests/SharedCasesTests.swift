import XCTest
@testable import AudioPlayer

private final class BundleAnchor {}

private func fixture<T: Decodable>(_ name: String, as type: T.Type) throws -> T {
    let url = try XCTUnwrap(Bundle(for: BundleAnchor.self).url(forResource: name, withExtension: "json"), name)
    return try JSONDecoder().decode(T.self, from: Data(contentsOf: url))
}

private struct TokenCase: Decodable {
    struct Piece: Decodable, Equatable { let text: String; let sep: String }
    let input: String
    let tokenize: [Piece]
    let split: [String]
    let join: String
}

private struct IOCase: Decodable { let input: String; let output: String }

private struct SoundcloudCase: Decodable { let input: String; let kind: String?; let url: String }

private struct SourceCase: Decodable { let id: String; let source: String }

private struct UrlCases: Decodable {
    let clean: [IOCase]
    let pasted: [IOCase]
    let soundcloud: [SoundcloudCase]
    let source_of: [SourceCase]
}

private struct SplitTagCase: Decodable { let tag: String; let key: String; let value: String }

private struct DecadeCase: Decodable { let year: Int?; let tag: String? }

private struct RankCase: Decodable { let tag: String; let rank: Int }

private struct SplitInputCase: Decodable { let input: String; let tags: [String]; let rest: String }

private struct TagCases: Decodable {
    let split_tag: [SplitTagCase]
    let decade_tag: [DecadeCase]
    let decade_rank: [RankCase]
    let complete_tag: [IOCase]
    let split_input: [SplitInputCase]
}

private func trimmed(_ s: String) -> String {
    let isSpace: (Unicode.Scalar) -> Bool = { $0.properties.isWhitespace || $0 == "\u{FEFF}" }
    var scalars = Substring(s).unicodeScalars
    while let f = scalars.first, isSpace(f) { scalars.removeFirst() }
    while let l = scalars.last, isSpace(l) { scalars.removeLast() }
    return String(scalars)
}

final class TokenCasesTests: XCTestCase {
    func testTheSharedCasesMatchTheWebTokenizer() throws {
        let cases = try fixture("token_cases", as: [TokenCase].self)
        XCTAssertGreaterThanOrEqual(cases.count, 60)
        for c in cases {
            let toks = Tokens.tokenize(c.input)
            XCTAssertEqual(toks.map { TokenCase.Piece(text: $0.text, sep: $0.sep) }, c.tokenize, c.input)
            let split = toks.map { trimmed($0.text) }.filter { !$0.isEmpty }
            XCTAssertEqual(split, c.split, c.input)
            XCTAssertEqual(c.split.map(trimmed).filter { !$0.isEmpty }.joined(separator: " - "), c.join, c.input)
            XCTAssertEqual(Tokens.compose(toks), c.input, c.input)
        }
    }
}

final class UrlCleanCasesTests: XCTestCase {
    private func cases() throws -> UrlCases { try fixture("url_clean_cases", as: UrlCases.self) }

    func testCleanUrlMatchesTheSharedCases() throws {
        for c in try cases().clean { XCTAssertEqual(cleanUrl(c.input), c.output, c.input) }
    }

    func testCleanPastedMatchesTheSharedCases() throws {
        for c in try cases().pasted { XCTAssertEqual(cleanPasted(c.input), c.output, c.input) }
    }

    func testClassifySoundcloudMatchesTheSharedCases() throws {
        for c in try cases().soundcloud {
            let got: (String, String)?
            switch classifySoundcloud(c.input) {
            case .track(let url)?: got = ("track", url)
            case .short(let url)?: got = ("short", url)
            case .unsupported?: got = ("unsupported", "")
            case nil: got = nil
            }
            if let kind = c.kind {
                XCTAssertEqual(got?.0, kind, c.input)
                XCTAssertEqual(got?.1, c.url, c.input)
            } else {
                XCTAssertNil(got, c.input)
            }
        }
    }

    func testSourceOfMatchesTheSharedCases() throws {
        for c in try cases().source_of { XCTAssertEqual(sourceOf(id: c.id), c.source, c.id) }
    }

    func testLibraryMatchFindsASongByAPastedLink() {
        let song = Track(id: "QCuUAClm-hQ", title: "T", artist: "A")
        XCTAssertEqual(libraryMatch(link: "QCuUAClm-hQ", in: [song])?.id, "QCuUAClm-hQ")
        XCTAssertEqual(libraryMatch(link: "https://youtu.be/QCuUAClm-hQ", in: [song])?.id, "QCuUAClm-hQ")
        XCTAssertNil(libraryMatch(link: "QCuUAClm-h", in: [song]))
    }
}

final class TagCasesTests: XCTestCase {
    private func cases() throws -> TagCases { try fixture("tag_cases", as: TagCases.self) }

    func testSplitTagMatchesTheSharedCases() throws {
        for c in try cases().split_tag {
            let got = splitTag(c.tag)
            XCTAssertEqual(got.key, c.key, c.tag)
            XCTAssertEqual(got.value, c.value, c.tag)
        }
    }

    func testDecadeTagMatchesTheSharedCases() throws {
        for c in try cases().decade_tag { XCTAssertEqual(decadeTag(c.year), c.tag, String(describing: c.year)) }
    }

    func testDecadeTagFollowsTheCurrentYearPlusOneLikeTheWeb() {
        func at(_ year: Int) -> Date { DateComponents(calendar: .current, year: year, month: 6, day: 1).date! }
        XCTAssertNil(decadeTag(2030, now: at(2026)))
        XCTAssertEqual(decadeTag(2027, now: at(2026)), "decade:20s")
        XCTAssertEqual(decadeTag(2030, now: at(2029)), "decade:30s")
        XCTAssertNil(decadeTag(1949, now: at(2029)))
        XCTAssertEqual(decadeTag(2170, now: at(2169)), "decade:70s")
        XCTAssertEqual(maxReleaseYear(at(2026)), 2027)
    }

    func testWithDecadeReplacesTheDerivedTagAndStopsAtTheLimit() {
        let now = DateComponents(calendar: .current, year: 2030, month: 6, day: 1).date!
        XCTAssertEqual(withDecade(["genre:house", "decade:20s"], 2031, now: now), ["genre:house", "decade:30s"])
        XCTAssertEqual(withDecade(["genre:house"], 2032, now: now), ["genre:house"])
    }

    func testDecadeRankMatchesTheSharedCases() throws {
        for c in try cases().decade_rank { XCTAssertEqual(decadeRank(c.tag), c.rank, c.tag) }
    }

    func testCompleteTagMatchesTheSharedCases() throws {
        for c in try cases().complete_tag { XCTAssertEqual(completeTag(c.input), c.output, c.input) }
    }

    func testSplitTagInputMatchesTheSharedCases() throws {
        for c in try cases().split_input {
            let got = splitTagInput(c.input)
            XCTAssertEqual(got.tags, c.tags, c.input)
            XCTAssertEqual(got.rest, c.rest, c.input)
        }
    }
}
